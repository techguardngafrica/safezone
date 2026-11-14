import { Injectable, Logger } from '@nestjs/common';
import { BUILT_IN_ROLES } from '@safezone/permissions';
import {
  DEFAULT_MAINTENANCE_CATEGORIES,
  type addMaterialSchema,
  type createCommentSchema,
  type createMaintenanceCategorySchema,
  type createMaintenanceRequestSchema,
  type createRecurringMaintenanceSchema,
  type createWorkOrderSchema,
  type maintenanceReportQuerySchema,
  type maintenanceRequestListQuerySchema,
  type putSlaPoliciesSchema,
  type updateMaintenanceCategorySchema,
  type updateWorkOrderSchema,
  type workOrderAssigneeSchema,
  type workOrderListQuerySchema,
} from '@safezone/schemas';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import type { EstateAccess } from '../../common/auth/auth.decorators';
import { DatabaseService } from '../../common/database/database.service';
import type { Tx } from '../../common/database/tenant-context';
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
} from '../../common/errors/domain-error';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { AuthzService } from '../authz/authz.service';
import { addDays, sum, todayInLagos, toKobo } from '../billing/domain/billing';
import { InvoicesService } from '../billing/invoices.service';
import { FilesService } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { isStaffWith, OccupancyService } from '../occupancy/occupancy.service';
import { PropertyService } from '../property/property.service';
import { PassesService } from '../visitor/passes.service';
import {
  breachLevel,
  canMoveWorkOrder,
  canReopen,
  DEFAULT_SLA,
  formatNumber,
  type Frequency,
  nextRequestStatus,
  nextRunDate,
  OPEN_REQUEST_STATUSES,
  PAUSED_STATUSES,
  pausedFor,
  type Priority,
  type RequestAction,
  type RequestStatus,
  REOPEN_WINDOW_MS,
  slaDueAt,
  type WorkOrderStatus,
} from './domain/maintenance';

type RequestRow = Prisma.MaintenanceRequestGetPayload<object>;
type WorkOrderRow = Prisma.WorkOrderGetPayload<{ include: { materials: true } }>;
type Assignee = z.infer<typeof workOrderAssigneeSchema>;
const requestCursorSchema = z.object({ createdAt: z.iso.datetime(), id: z.uuid() });

/** Staff roles that triage maintenance (first SLA level) and estate managers (second level). */
const ASSIGNER_ROLES = BUILT_IN_ROLES.filter(
  (role) =>
    role.level === 'estate' &&
    role.permissions.includes('maintenance.assign') &&
    role.key !== 'homeowner',
).map((role) => role.key);
const ESCALATION_ROLES = ['estate_manager', 'estate_administrator', 'estate_owner'];

/** Who is acting on a request. */
type Actor = 'staff' | 'requester' | 'assignee' | 'household';

/**
 * Maintenance requests, complaints and work orders (maintenance.md). Residents see their household's
 * requests (complaints about a neighbour only to the requester and management); assignees see their work.
 */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger('Maintenance');

  constructor(
    private readonly db: DatabaseService,
    private readonly property: PropertyService,
    private readonly occupancy: OccupancyService,
    private readonly files: FilesService,
    private readonly authz: AuthzService,
    private readonly notifications: NotificationsService,
    private readonly invoices: InvoicesService,
    private readonly passes: PassesService,
  ) {}

  // ---- Categories and SLA policies ----------------------------------------------------------

  /** Categories, seeding the defaults on first use (maintenance.md §2.2). */
  async categories(access: EstateAccess) {
    return this.db.withTenant(access, async (tx) => {
      await this.seedCategories(tx, access.estateId);
      const rows = await tx.maintenanceCategory.findMany({
        where: { estateId: access.estateId },
        orderBy: [{ kind: 'asc' }, { name: 'asc' }],
      });
      return rows.map((row) => this.categoryView(row));
    });
  }

  private async seedCategories(tx: Tx, estateId: string) {
    const count = await tx.maintenanceCategory.count({ where: { estateId } });
    if (count > 0) return;
    const complaints = new Set(['Noise', 'Neighbour', 'Service quality']);
    await tx.maintenanceCategory.createMany({
      data: DEFAULT_MAINTENANCE_CATEGORIES.map((name) => ({
        estateId,
        name,
        kind: complaints.has(name) ? 'complaint' : 'maintenance',
        defaultPriority: name === 'Security equipment' || name === 'Water' ? 'high' : 'normal',
      })),
      skipDuplicates: true,
    });
  }

  async createCategory(
    access: EstateAccess,
    input: z.infer<typeof createMaintenanceCategorySchema>,
  ) {
    return this.db.withTenant(access, async (tx) => {
      await this.seedCategories(tx, access.estateId);
      const existing = await tx.maintenanceCategory.count({
        where: { estateId: access.estateId, name: input.name },
      });
      if (existing > 0)
        throw new ConflictError('CATEGORY_EXISTS', 'A category with this name already exists');
      const row = await tx.maintenanceCategory.create({
        data: { estateId: access.estateId, ...input },
      });
      return this.categoryView(row);
    });
  }

  async updateCategory(
    access: EstateAccess,
    id: string,
    input: z.infer<typeof updateMaintenanceCategorySchema>,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const row = await tx.maintenanceCategory.findFirst({
        where: { id, estateId: access.estateId },
      });
      if (!row) throw new NotFoundError('Category not found', 'CATEGORY_NOT_FOUND');
      return this.categoryView(await tx.maintenanceCategory.update({ where: { id }, data: input }));
    });
  }

  private categoryView(row: Prisma.MaintenanceCategoryGetPayload<object>) {
    return {
      id: row.id,
      name: row.name,
      kind: row.kind as 'maintenance' | 'complaint',
      defaultPriority: row.defaultPriority as Priority,
      active: row.active,
    };
  }

  async slaPolicies(access: EstateAccess) {
    return this.db.withTenant(access, async (tx) => {
      const rows = await tx.slaPolicy.findMany({ where: { estateId: access.estateId } });
      const byPriority = new Map(rows.map((row) => [row.priority, row]));
      return (['urgent', 'high', 'normal', 'low'] as const).map((priority) => ({
        priority,
        responseMinutes:
          byPriority.get(priority)?.responseMinutes ?? DEFAULT_SLA[priority].responseMinutes,
        resolutionHours:
          byPriority.get(priority)?.resolutionHours ?? DEFAULT_SLA[priority].resolutionHours,
      }));
    });
  }

  async putSlaPolicies(access: EstateAccess, input: z.infer<typeof putSlaPoliciesSchema>) {
    await this.db.withTenant(access, async (tx) => {
      for (const policy of input.policies) {
        await tx.slaPolicy.upsert({
          where: { estateId_priority: { estateId: access.estateId, priority: policy.priority } },
          create: { estateId: access.estateId, ...policy, updatedBy: access.userId },
          update: { ...policy, updatedBy: access.userId, updatedAt: new Date() },
        });
      }
      await appendOutboxEvents(tx, [
        {
          type: 'maintenance.sla_policy.updated',
          estateId: access.estateId,
          aggregateType: 'estate',
          aggregateId: access.estateId,
          payload: { priorities: input.policies.map((policy) => policy.priority) },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'maintenance.sla_policy.update',
            resourceType: 'estate',
            resourceId: access.estateId,
            after: input.policies,
          },
        },
      ]);
    });
    return this.slaPolicies(access);
  }

  private async resolutionHours(tx: Tx, estateId: string, priority: Priority): Promise<number> {
    const row = await tx.slaPolicy.findUnique({
      where: { estateId_priority: { estateId, priority } },
    });
    return row?.resolutionHours ?? DEFAULT_SLA[priority].resolutionHours;
  }

  // ---- Requests ------------------------------------------------------------------------------

  async submit(access: EstateAccess, input: z.infer<typeof createMaintenanceRequestSchema>) {
    const staff = isStaffWith(access, 'maintenance.assign');
    const households = await this.occupancy.householdsOf(access.estateId, access.userId);
    const attachments = await this.files.estateFilesOf(
      access.estateId,
      access.userId,
      input.attachmentFileIds,
      'maintenance',
    );
    if (attachments.length !== new Set(input.attachmentFileIds).size)
      throw new DomainError(
        'ATTACHMENT_INVALID',
        'Upload the photos or videos for this request first',
        422,
      );
    const created = await this.db.withTenant(access, async (tx) => {
      await this.seedCategories(tx, access.estateId);
      const category = await tx.maintenanceCategory.findFirst({
        where: { id: input.categoryId, estateId: access.estateId, active: true },
      });
      if (!category) throw new NotFoundError('Category not found', 'CATEGORY_NOT_FOUND');
      let householdId: string | null = null;
      if (input.spaceId) {
        const [space] = await this.property.spacesByIds(tx, access.estateId, [input.spaceId]);
        if (!space) throw new NotFoundError('Space not found', 'SPACE_NOT_FOUND');
        const unit = await this.property.unit(tx, access.estateId, input.spaceId);
        if (unit) {
          const household = households.find((item) => item.spaceId === unit.id);
          if (!household && !staff)
            throw new ForbiddenError(
              'You can only report problems in your own unit or common areas',
            );
          householdId = household?.householdId ?? null;
        }
      } else if (households.length > 0) {
        householdId = households[0]?.householdId ?? null;
      }
      const priority = (input.priority ?? category.defaultPriority) as Priority;
      const hours = await this.resolutionHours(tx, access.estateId, priority);
      const createdAt = new Date();
      const row = await tx.maintenanceRequest.create({
        data: {
          estateId: access.estateId,
          number: formatNumber('MR', await this.nextNumber(tx, access.estateId, 'MR')),
          kind: input.kind,
          categoryId: category.id,
          priority,
          spaceId: input.spaceId ?? null,
          householdId,
          title: input.title,
          description: input.description,
          preferredTimes: input.preferredTimes ?? null,
          aboutNeighbour: input.kind === 'complaint' && input.aboutNeighbour,
          attachmentFileIds: attachments,
          requestedBy: access.userId,
          slaDueAt: slaDueAt(createdAt, hours, 0),
          resolutionHours: hours,
          createdAt,
        },
      });
      await this.event(tx, access.estateId, row, 'submitted', access.userId);
      return row;
    });
    if (created.priority === 'urgent' || created.priority === 'high') {
      const staffIds = await this.authz.holdersOf(access.estateId, ASSIGNER_ROLES);
      if (staffIds.length > 0) {
        await this.db.withTenant(access, (tx) =>
          this.notifications.request(tx, {
            intent: 'maintenance.request_urgent',
            userIds: staffIds,
            estateId: access.estateId,
            data: { number: created.number, title: created.title, requestId: created.id },
            dedupeKey: `maintenance:${created.id}:urgent`,
          }),
        );
      }
    }
    return this.detail(access, created.id);
  }

  private async nextNumber(tx: Tx, estateId: string, kind: 'MR' | 'WO'): Promise<number> {
    const rows = await tx.$queryRaw<{ next: number }[]>`
      insert into tenant.maintenance_counters (estate_id, kind, next) values (${estateId}::uuid, ${kind}, 2)
      on conflict (estate_id, kind) do update set next = tenant.maintenance_counters.next + 1
      returning next`;
    return (rows[0]?.next ?? 2) - 1;
  }

  /** Visibility (rules 1–2): management all; others their household's (not others' neighbour complaints). */
  private async visibleWhere(
    access: EstateAccess,
  ): Promise<Prisma.MaintenanceRequestWhereInput | null> {
    if (isStaffWith(access, 'maintenance.assign')) return null;
    const households = (await this.occupancy.householdsOf(access.estateId, access.userId)).map(
      (h) => h.householdId,
    );
    const assigned = await this.db.withTenant(access, (tx) =>
      tx.workOrder.findMany({
        where: {
          estateId: access.estateId,
          assigneeUserId: access.userId,
          requestId: { not: null },
        },
        select: { requestId: true },
      }),
    );
    return {
      OR: [
        { requestedBy: access.userId },
        ...(households.length > 0
          ? [{ householdId: { in: households }, aboutNeighbour: false }]
          : []),
        ...(assigned.length > 0
          ? [{ id: { in: assigned.map((row) => row.requestId as string) }, aboutNeighbour: false }]
          : []),
      ],
    };
  }

  async list(access: EstateAccess, query: z.infer<typeof maintenanceRequestListQuerySchema>) {
    const after = query.cursor
      ? decodeCursor(
          query.cursor,
          (value): value is z.infer<typeof requestCursorSchema> =>
            requestCursorSchema.safeParse(value).success,
        )
      : undefined;
    const visible = await this.visibleWhere(access);
    return this.db.withTenant(access, async (tx) => {
      const rows = await tx.maintenanceRequest.findMany({
        where: {
          estateId: access.estateId,
          ...(query.status ? { status: query.status } : {}),
          ...(query.kind ? { kind: query.kind } : {}),
          ...(query.mine ? { requestedBy: access.userId } : {}),
          AND: [
            ...(visible ? [visible] : []),
            ...(after
              ? [
                  {
                    OR: [
                      { createdAt: { lt: new Date(after.createdAt) } },
                      { createdAt: new Date(after.createdAt), id: { lt: after.id } },
                    ],
                  },
                ]
              : []),
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      });
      const page = rows.slice(0, query.limit);
      const lookups = await this.lookups(tx, access.estateId, page);
      const last = page.at(-1);
      return {
        items: page.map((row) => this.view(row, lookups)),
        nextCursor:
          rows.length > query.limit && last
            ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
            : null,
      };
    });
  }

  async detail(access: EstateAccess, requestId: string) {
    const visible = await this.visibleWhere(access);
    const staff = isStaffWith(access, 'maintenance.assign');
    return this.db.withTenant(access, async (tx) => {
      const row = await tx.maintenanceRequest.findFirst({
        where: { id: requestId, estateId: access.estateId, ...(visible ? { AND: [visible] } : {}) },
        include: { comments: { orderBy: { createdAt: 'asc' } } },
      });
      if (!row) throw new NotFoundError('Request not found', 'MAINTENANCE_REQUEST_NOT_FOUND');
      const workOrders = await tx.workOrder.findMany({
        where: { estateId: access.estateId, requestId: row.id },
        select: { id: true },
      });
      const lookups = await this.lookups(tx, access.estateId, [row]);
      return {
        ...this.view(row, lookups),
        comments: row.comments
          .filter((comment) => staff || !comment.internal)
          .map((comment) => ({
            id: comment.id,
            authorId: comment.authorId,
            body: comment.body,
            internal: comment.internal,
            createdAt: comment.createdAt.toISOString(),
          })),
        workOrderIds: workOrders.map((order) => order.id),
      };
    });
  }

  /** Who may take which action (maintenance.md §3, rules 3 and 9). */
  private allowed(action: RequestAction, actor: Actor): boolean {
    switch (action) {
      case 'respond':
      case 'cancel':
      case 'reopen':
        return actor === 'requester' || actor === 'household' || actor === 'staff';
      case 'close':
        return actor === 'requester' || actor === 'household' || actor === 'staff';
      case 'start':
      case 'await_materials':
      case 'resume':
      case 'resolve':
        return actor === 'staff' || actor === 'assignee';
      default:
        return actor === 'staff';
    }
  }

  async transition(
    access: EstateAccess,
    requestId: string,
    action: Exclude<RequestAction, 'assign'>,
    input: { reason?: string; note?: string },
  ) {
    const visible = await this.visibleWhere(access);
    await this.db.withTenant(access, async (tx) => {
      const row = await tx.maintenanceRequest.findFirst({
        where: { id: requestId, estateId: access.estateId, ...(visible ? { AND: [visible] } : {}) },
      });
      if (!row) throw new NotFoundError('Request not found', 'MAINTENANCE_REQUEST_NOT_FOUND');
      const actor = await this.actorFor(tx, access, row);
      if (!this.allowed(action, actor))
        throw new ForbiddenError('You cannot do this on this request');
      if (action === 'reopen' && !canReopen(row.resolvedAt, new Date()))
        throw new ConflictError(
          'MAINTENANCE_REOPEN_EXPIRED',
          'This request was resolved more than 7 days ago',
        );
      const to = nextRequestStatus(row.status, action);
      if (!to)
        throw new ConflictError(
          'MAINTENANCE_INVALID_TRANSITION',
          `A ${row.status.replaceAll('_', ' ')} request cannot do that`,
        );
      await this.move(tx, access, row, to, {
        ...(action === 'reject' ? { rejectionReason: input.reason ?? null } : {}),
      });
      const note = input.reason ?? input.note;
      if (note) {
        await tx.maintenanceComment.create({
          data: {
            estateId: access.estateId,
            requestId: row.id,
            authorId: access.userId,
            body: `${action.replaceAll('_', ' ')}: ${note}`,
            internal: false,
          },
        });
      }
    });
    return this.detail(access, requestId);
  }

  private async actorFor(tx: Tx, access: EstateAccess, row: RequestRow): Promise<Actor> {
    if (isStaffWith(access, 'maintenance.assign')) return 'staff';
    if (row.requestedBy === access.userId) return 'requester';
    const assigned = await tx.workOrder.count({
      where: { requestId: row.id, assigneeUserId: access.userId, status: { notIn: ['cancelled'] } },
    });
    if (assigned > 0) return 'assignee';
    return 'household';
  }

  /** Applies a status change with SLA pause/resume bookkeeping and the matching event. */
  private async move(
    tx: Tx,
    access: EstateAccess | { estateId: string; userId: string | null },
    row: RequestRow,
    to: RequestStatus,
    extra: Prisma.MaintenanceRequestUpdateManyMutationInput = {},
  ) {
    const now = new Date();
    const wasPaused = PAUSED_STATUSES.includes(row.status as RequestStatus);
    const nowPaused = PAUSED_STATUSES.includes(to);
    let pausedMs = Number(row.slaPausedMs);
    let pausedAt = row.slaPausedAt;
    if (wasPaused && !nowPaused) {
      pausedMs += pausedFor(row.slaPausedAt, now);
      pausedAt = null;
    } else if (!wasPaused && nowPaused) pausedAt = now;
    const result = await tx.maintenanceRequest.updateMany({
      where: { id: row.id, version: row.version },
      data: {
        ...extra,
        status: to,
        slaPausedAt: pausedAt,
        slaPausedMs: BigInt(pausedMs),
        slaDueAt: slaDueAt(row.createdAt, row.resolutionHours, pausedMs),
        ...(row.respondedAt === null && to !== 'submitted' ? { respondedAt: now } : {}),
        ...(to === 'resolved' ? { resolvedAt: now } : {}),
        ...(to === 'in_progress' && row.status === 'resolved' ? { resolvedAt: null } : {}),
        ...(to === 'closed' ? { closedAt: now } : {}),
        version: { increment: 1 },
      },
    });
    if (result.count === 0)
      throw new ConflictError('VERSION_MISMATCH', 'This request was changed by someone else');
    const verb =
      to === 'under_review' ||
      to === 'info_requested' ||
      to === 'assigned' ||
      to === 'in_progress' ||
      to === 'awaiting_materials'
        ? 'updated'
        : to;
    await this.event(tx, access.estateId, { ...row, status: to }, verb, access.userId);
    if (row.requestedBy !== access.userId) {
      await this.notifications.request(tx, {
        intent: 'maintenance.request_updated',
        userIds: [row.requestedBy],
        estateId: access.estateId,
        data: {
          number: row.number,
          title: row.title,
          status: to.replaceAll('_', ' '),
          requestId: row.id,
        },
        dedupeKey: `maintenance:${row.id}:${to}:${row.version}`,
      });
    }
  }

  async rate(
    access: EstateAccess,
    requestId: string,
    rating: number,
    feedback: string | undefined,
  ) {
    await this.db.withTenant(access, async (tx) => {
      const row = await tx.maintenanceRequest.findFirst({
        where: { id: requestId, estateId: access.estateId },
      });
      if (!row || row.requestedBy !== access.userId)
        throw new NotFoundError('Request not found', 'MAINTENANCE_REQUEST_NOT_FOUND');
      if (row.status !== 'resolved' && row.status !== 'closed')
        throw new ConflictError(
          'MAINTENANCE_NOT_RESOLVED',
          'You can rate a request once it is resolved',
        );
      await tx.maintenanceRequest.update({
        where: { id: row.id },
        data: {
          rating,
          feedback: feedback ?? null,
          ...(row.status === 'resolved' ? { status: 'closed', closedAt: new Date() } : {}),
        },
      });
      if (row.status === 'resolved')
        await this.event(
          tx,
          access.estateId,
          { ...row, status: 'closed' },
          'closed',
          access.userId,
        );
    });
    return this.detail(access, requestId);
  }

  async comment(
    access: EstateAccess,
    requestId: string,
    input: z.infer<typeof createCommentSchema>,
  ) {
    const visible = await this.visibleWhere(access);
    const staff = isStaffWith(access, 'maintenance.assign');
    if (input.internal && !staff) throw new ForbiddenError('Only staff can add internal notes');
    await this.db.withTenant(access, async (tx) => {
      const row = await tx.maintenanceRequest.findFirst({
        where: { id: requestId, estateId: access.estateId, ...(visible ? { AND: [visible] } : {}) },
      });
      if (!row) throw new NotFoundError('Request not found', 'MAINTENANCE_REQUEST_NOT_FOUND');
      await tx.maintenanceComment.create({
        data: {
          estateId: access.estateId,
          requestId,
          authorId: access.userId,
          body: input.body,
          internal: input.internal,
        },
      });
      if (!input.internal && row.requestedBy !== access.userId) {
        await this.notifications.request(tx, {
          intent: 'maintenance.request_updated',
          userIds: [row.requestedBy],
          estateId: access.estateId,
          data: { number: row.number, title: row.title, status: 'new comment', requestId: row.id },
          dedupeKey: `maintenance:${row.id}:comment:${Date.now()}`,
        });
      }
    });
    return this.detail(access, requestId);
  }

  // ---- Work orders ---------------------------------------------------------------------------

  async createWorkOrder(access: EstateAccess, input: z.infer<typeof createWorkOrderSchema>) {
    const id = await this.db.withTenant(access, async (tx) => {
      let request: RequestRow | null = null;
      if (input.requestId) {
        request = await tx.maintenanceRequest.findFirst({
          where: { id: input.requestId, estateId: access.estateId },
        });
        if (!request) throw new NotFoundError('Request not found', 'MAINTENANCE_REQUEST_NOT_FOUND');
        if (!OPEN_REQUEST_STATUSES.includes(request.status as RequestStatus))
          throw new ConflictError(
            'MAINTENANCE_INVALID_TRANSITION',
            'This request is no longer open',
          );
      }
      if (input.assignee?.type === 'staff')
        await this.assertStaff(tx, access.estateId, input.assignee.userId);
      const row = await tx.workOrder.create({
        data: {
          estateId: access.estateId,
          number: formatNumber('WO', await this.nextNumber(tx, access.estateId, 'WO')),
          requestId: request?.id ?? null,
          title: input.title,
          scope: input.scope ?? null,
          spaceId: input.spaceId ?? request?.spaceId ?? null,
          ...this.assigneeData(input.assignee),
          scheduledStart: input.scheduledStart ? new Date(input.scheduledStart) : null,
          scheduledEnd: input.scheduledEnd ? new Date(input.scheduledEnd) : null,
          status: input.scheduledStart && input.scheduledEnd ? 'scheduled' : 'open',
          createdBy: access.userId,
        },
      });
      if (request && input.assignee) {
        const to = nextRequestStatus(request.status, 'assign');
        if (to && to !== request.status) await this.move(tx, access, request, to);
      }
      await this.workOrderEvent(tx, access, row, input.assignee ? 'assigned' : 'created');
      if (input.assignee?.type === 'staff')
        await this.notifyAssignee(tx, access, row, input.assignee.userId);
      return row.id;
    });
    await this.ensureContractorPass(access, id);
    return this.workOrder(access, id);
  }

  async workOrders(access: EstateAccess, query: z.infer<typeof workOrderListQuerySchema>) {
    const staff = isStaffWith(access, 'maintenance.assign');
    return this.db.withTenant(access, async (tx) => {
      const rows = await tx.workOrder.findMany({
        where: {
          estateId: access.estateId,
          ...(query.status ? { status: query.status } : {}),
          ...(query.requestId ? { requestId: query.requestId } : {}),
          // Rule 3: assignees see only their work orders.
          ...(!staff || query.assignee === 'me' ? { assigneeUserId: access.userId } : {}),
        },
        include: { materials: { orderBy: { createdAt: 'asc' } } },
        orderBy: [{ createdAt: 'desc' }],
        take: 200,
      });
      return rows.map((row) => this.workOrderView(row));
    });
  }

  async workOrder(access: EstateAccess, id: string) {
    return this.db.withTenant(access, async (tx) =>
      this.workOrderView(await this.loadWorkOrder(tx, access, id)),
    );
  }

  private async loadWorkOrder(tx: Tx, access: EstateAccess, id: string): Promise<WorkOrderRow> {
    const staff = isStaffWith(access, 'maintenance.assign');
    const row = await tx.workOrder.findFirst({
      where: { id, estateId: access.estateId, ...(staff ? {} : { assigneeUserId: access.userId }) },
      include: { materials: { orderBy: { createdAt: 'asc' } } },
    });
    if (!row) throw new NotFoundError('Work order not found', 'WORK_ORDER_NOT_FOUND');
    return row;
  }

  /**
   * Updates a work order. Assigning, scheduling, costs and recharge need maintenance.assign; the assignee may
   * only move status and add resolution notes.
   */
  async updateWorkOrder(
    access: EstateAccess,
    id: string,
    input: z.infer<typeof updateWorkOrderSchema>,
  ) {
    const staff = isStaffWith(access, 'maintenance.assign');
    const managerOnly =
      input.assignee !== undefined ||
      input.scheduledStart !== undefined ||
      input.scheduledEnd !== undefined ||
      input.labourCost !== undefined ||
      input.rechargeToResident !== undefined ||
      input.status === 'cancelled';
    if (managerOnly && !staff)
      throw new ForbiddenError('Only maintenance managers can change this');
    await this.db.withTenant(access, async (tx) => {
      const row = await this.loadWorkOrder(tx, access, id);
      if (row.status === 'verified' || row.status === 'closed' || row.status === 'cancelled')
        throw new ConflictError('WORK_ORDER_CLOSED', 'This work order is finished');
      if (input.assignee?.type === 'staff')
        await this.assertStaff(tx, access.estateId, input.assignee.userId);
      const start = input.scheduledStart ? new Date(input.scheduledStart) : row.scheduledStart;
      const end = input.scheduledEnd ? new Date(input.scheduledEnd) : row.scheduledEnd;
      if (start && end && end <= start)
        throw new DomainError(
          'WORK_ORDER_SCHEDULE_INVALID',
          'The visit must end after it starts',
          422,
        );
      let status = row.status;
      if (input.status) {
        if (!canMoveWorkOrder(row.status, input.status as WorkOrderStatus))
          throw new ConflictError(
            'WORK_ORDER_INVALID_TRANSITION',
            `A ${row.status.replaceAll('_', ' ')} work order cannot do that`,
          );
        status = input.status;
      } else if (
        (input.scheduledStart || input.scheduledEnd) &&
        start &&
        end &&
        row.status === 'open'
      ) {
        status = 'scheduled';
      }
      const result = await tx.workOrder.updateMany({
        where: { id: row.id, version: row.version },
        data: {
          ...(input.assignee ? this.assigneeData(input.assignee) : {}),
          ...(input.assignee ? { visitorPassId: null } : {}),
          scheduledStart: start,
          scheduledEnd: end,
          status,
          ...(input.labourCost !== undefined ? { labourCost: BigInt(input.labourCost) } : {}),
          ...(input.resolutionNotes !== undefined
            ? { resolutionNotes: input.resolutionNotes }
            : {}),
          ...(input.resolutionFileIds !== undefined
            ? { resolutionFileIds: input.resolutionFileIds }
            : {}),
          ...(input.rechargeToResident !== undefined
            ? { rechargeToResident: input.rechargeToResident }
            : {}),
          ...(status === 'completed' ? { completedAt: new Date() } : {}),
          version: { increment: 1 },
        },
      });
      if (result.count === 0)
        throw new ConflictError('VERSION_MISMATCH', 'This work order was changed by someone else');
      const updated = await tx.workOrder.findFirstOrThrow({ where: { id: row.id } });
      // Keep the request in step with its work.
      if (row.requestId && status !== row.status) {
        const request = await tx.maintenanceRequest.findFirstOrThrow({
          where: { id: row.requestId },
        });
        const action: RequestAction | null =
          status === 'in_progress'
            ? request.status === 'awaiting_materials'
              ? 'resume'
              : 'start'
            : status === 'on_hold'
              ? 'await_materials'
              : status === 'completed'
                ? 'resolve'
                : null;
        const to = action ? nextRequestStatus(request.status, action) : null;
        if (to) await this.move(tx, access, request, to);
      }
      if (input.assignee) {
        await this.workOrderEvent(tx, access, updated, 'assigned');
        if (input.assignee.type === 'staff')
          await this.notifyAssignee(tx, access, updated, input.assignee.userId);
      }
      if (status === 'completed' && row.status !== 'completed')
        await this.workOrderEvent(tx, access, updated, 'completed');
    });
    await this.ensureContractorPass(access, id);
    return this.workOrder(access, id);
  }

  async addMaterial(access: EstateAccess, id: string, input: z.infer<typeof addMaterialSchema>) {
    await this.db.withTenant(access, async (tx) => {
      const row = await this.loadWorkOrder(tx, access, id);
      if (row.status === 'verified' || row.status === 'closed' || row.status === 'cancelled')
        throw new ConflictError('WORK_ORDER_CLOSED', 'This work order is finished');
      const amount = Math.round(input.quantity * input.unitCost);
      await tx.workOrderMaterial.create({
        data: {
          estateId: access.estateId,
          workOrderId: id,
          item: input.item,
          quantity: input.quantity,
          unitCost: BigInt(input.unitCost),
          amount: BigInt(amount),
          createdBy: access.userId,
        },
      });
      await tx.workOrder.update({
        where: { id },
        data: { materialsCost: { increment: BigInt(amount) }, version: { increment: 1 } },
      });
    });
    return this.workOrder(access, id);
  }

  /**
   * Manager verifies completed work (maintenance.md §2.11). With recharge on, the labour and materials are
   * invoiced to the unit's household (rule 7) in the same transaction.
   */
  async verifyWorkOrder(access: EstateAccess, id: string) {
    await this.db.withTenant(access, async (tx) => {
      const row = await this.loadWorkOrder(tx, access, id);
      if (!canMoveWorkOrder(row.status, 'verified'))
        throw new ConflictError(
          'WORK_ORDER_INVALID_TRANSITION',
          'Only completed work can be verified',
        );
      let invoiceId: string | null = null;
      const total = toKobo(row.labourCost) + toKobo(row.materialsCost);
      if (row.rechargeToResident && total > 0) {
        if (!row.spaceId)
          throw new DomainError('RECHARGE_NEEDS_UNIT', 'Recharges need a unit to bill', 422);
        const unit = await this.property.unit(tx, access.estateId, row.spaceId);
        const occupant = unit
          ? (await this.occupancy.billingOccupants(tx, access.estateId, [unit.id])).get(unit.id)
          : undefined;
        if (!unit || !occupant)
          throw new DomainError(
            'INVOICE_NO_PAYER',
            'This unit has no active household to bill',
            422,
          );
        const today = todayInLagos();
        [invoiceId] = (await this.invoices.issue(tx, access.estateId, [
          {
            spaceId: unit.id,
            unitCode: unit.code,
            householdId: occupant.householdId,
            payerUserId: occupant.payerUserId,
            payerType: 'occupant',
            billingRunId: null,
            description: `Repair ${row.number}: ${row.title}`,
            issueDate: today,
            dueDate: addDays(today, 14),
            createdBy: access.userId,
            lines: [
              ...(toKobo(row.labourCost) > 0
                ? [
                    {
                      chargeId: null,
                      chargeType: 'maintenance_charge',
                      description: `Labour: ${row.title}`,
                      quantity: 1,
                      unitAmount: toKobo(row.labourCost),
                      amount: toKobo(row.labourCost),
                    },
                  ]
                : []),
              ...row.materials.map((material) => ({
                chargeId: null,
                chargeType: 'maintenance_charge',
                description: material.item,
                quantity: material.quantity,
                unitAmount: toKobo(material.unitCost),
                amount: toKobo(material.amount),
              })),
            ],
          },
        ])) as [string];
      }
      await tx.workOrder.update({
        where: { id },
        data: {
          status: 'verified',
          verifiedBy: access.userId,
          verifiedAt: new Date(),
          invoiceId,
          version: { increment: 1 },
        },
      });
      await this.workOrderEvent(tx, access, { ...row, status: 'verified' }, 'verified', {
        invoiceId,
        recharged: invoiceId ? total : 0,
      });
    });
    return this.workOrder(access, id);
  }

  private async assertStaff(tx: Tx, estateId: string, userId: string) {
    const roles = await this.authz.countEstateRoles(tx, userId, estateId);
    if (roles === 0)
      throw new DomainError('ASSIGNEE_NOT_STAFF', 'Assign this to a member of estate staff', 422);
  }

  private assigneeData(assignee: Assignee | undefined) {
    if (!assignee) return {};
    return assignee.type === 'staff'
      ? {
          assigneeType: 'staff',
          assigneeUserId: assignee.userId,
          vendorName: null,
          vendorPhone: null,
          vendorCompany: null,
        }
      : {
          assigneeType: 'vendor',
          assigneeUserId: null,
          vendorName: assignee.name,
          vendorPhone: assignee.phone,
          vendorCompany: assignee.company ?? null,
        };
  }

  /**
   * Rule 4: a vendor scheduled for in-unit work gets a contractor pass for the visit window, issued by the
   * manager who assigned it. Failure to issue the pass does not undo the work order; it is logged.
   */
  private async ensureContractorPass(access: EstateAccess, workOrderId: string) {
    const row = await this.db.withTenant(access, (tx) =>
      tx.workOrder.findFirstOrThrow({ where: { id: workOrderId } }),
    );
    if (
      row.assigneeType !== 'vendor' ||
      row.visitorPassId ||
      !row.scheduledStart ||
      !row.scheduledEnd ||
      !row.spaceId
    )
      return;
    if (row.scheduledEnd <= new Date()) return;
    const isUnit = await this.db.withTenant(access, (tx) =>
      this.property.unit(tx, access.estateId, row.spaceId as string),
    );
    if (!isUnit) return;
    try {
      const [pass] = await this.passes.create(access, {
        type: 'multi_entry',
        maxUses: 10,
        purpose: `Contractor for ${row.number}`,
        validFrom: row.scheduledStart.toISOString(),
        validTo: row.scheduledEnd.toISOString(),
        gateIds: [],
        visitors: [
          {
            name: row.vendorName ?? 'Contractor',
            ...(row.vendorPhone ? { phone: row.vendorPhone } : {}),
          },
        ],
      });
      const passId = pass?.id ?? null;
      if (passId) {
        await this.db.withTenant(access, (tx) =>
          tx.workOrder.update({ where: { id: workOrderId }, data: { visitorPassId: passId } }),
        );
      }
    } catch (error) {
      this.logger.warn({
        msg: 'contractor pass not issued',
        workOrderId,
        error: (error as Error).name,
      });
    }
  }

  private async notifyAssignee(
    tx: Tx,
    access: EstateAccess,
    row: { id: string; number: string; title: string },
    userId: string,
  ) {
    await this.notifications.request(tx, {
      intent: 'maintenance.work_order_assigned',
      userIds: [userId],
      estateId: access.estateId,
      data: { number: row.number, title: row.title, workOrderId: row.id },
      dedupeKey: `work-order:${row.id}:assigned:${userId}`,
    });
  }

  // ---- Planned work --------------------------------------------------------------------------

  async createRecurring(
    access: EstateAccess,
    input: z.infer<typeof createRecurringMaintenanceSchema>,
  ) {
    return this.db.withTenant(access, async (tx) => {
      if (input.assignee?.type === 'staff')
        await this.assertStaff(tx, access.estateId, input.assignee.userId);
      const row = await tx.recurringMaintenance.create({
        data: {
          estateId: access.estateId,
          title: input.title,
          scope: input.scope ?? null,
          spaceId: input.spaceId ?? null,
          frequency: input.frequency,
          nextRunOn: new Date(`${input.startsOn}T00:00:00.000Z`),
          assignee: input.assignee ?? undefined,
          createdBy: access.userId,
        },
      });
      return this.recurringView(row);
    });
  }

  async recurring(access: EstateAccess) {
    return this.db.withTenant(access, async (tx) =>
      (
        await tx.recurringMaintenance.findMany({
          where: { estateId: access.estateId },
          orderBy: { nextRunOn: 'asc' },
        })
      ).map((row) => this.recurringView(row)),
    );
  }

  private recurringView(row: Prisma.RecurringMaintenanceGetPayload<object>) {
    return {
      id: row.id,
      title: row.title,
      scope: row.scope,
      spaceId: row.spaceId,
      frequency: row.frequency as Frequency,
      nextRunOn: row.nextRunOn.toISOString().slice(0, 10),
      active: row.active,
      lastWorkOrderId: row.lastWorkOrderId,
    };
  }

  // ---- Jobs (worker) -------------------------------------------------------------------------

  /** Every few minutes: notify on SLA breaches, level 1 then level 2 (rule 6). */
  async checkSla(estateId: string, now: Date = new Date()): Promise<number> {
    const rows = await this.db.withTenant({ estateId, userId: null }, (tx) =>
      tx.maintenanceRequest.findMany({
        where: {
          estateId,
          status: {
            in: OPEN_REQUEST_STATUSES.filter(
              (status) => !PAUSED_STATUSES.includes(status),
            ) as string[],
          },
          slaDueAt: { lt: now },
          slaBreachLevel: { lt: 2 },
        },
        take: 1000,
      }),
    );
    let notified = 0;
    for (const row of rows) {
      const level = breachLevel(row.slaDueAt, row.resolutionHours, now, false);
      if (level <= row.slaBreachLevel) continue;
      const recipients = await this.authz.holdersOf(
        estateId,
        level === 1 ? ASSIGNER_ROLES : ESCALATION_ROLES,
      );
      await this.db.withTenant({ estateId, userId: null }, async (tx) => {
        const updated = await tx.maintenanceRequest.updateMany({
          where: { id: row.id, slaBreachLevel: { lt: level } },
          data: { slaBreachLevel: level },
        });
        if (updated.count === 0) return;
        await appendOutboxEvents(tx, [
          {
            type: 'maintenance.sla.breached',
            estateId,
            aggregateType: 'maintenance_request',
            aggregateId: row.id,
            payload: { requestId: row.id, level, priority: row.priority },
          },
        ]);
        if (recipients.length > 0) {
          await this.notifications.request(tx, {
            intent: 'maintenance.sla_breached',
            userIds: recipients,
            estateId,
            data: { number: row.number, title: row.title, level: String(level), requestId: row.id },
            dedupeKey: `maintenance:${row.id}:sla:${level}`,
          });
        }
        notified += 1;
      });
    }
    return notified;
  }

  /** Daily: close requests resolved over 7 days ago (rule 8) and create due planned work orders. */
  async daily(
    estateId: string,
    today: string,
    now: Date = new Date(),
  ): Promise<{ closed: number; planned: number }> {
    const system = { estateId, userId: null };
    const closed = await this.db.withTenant(system, async (tx) => {
      const rows = await tx.maintenanceRequest.findMany({
        where: {
          estateId,
          status: 'resolved',
          resolvedAt: { lt: new Date(now.getTime() - REOPEN_WINDOW_MS) },
        },
        take: 2000,
      });
      for (const row of rows) await this.move(tx, system, row, 'closed');
      return rows.length;
    });
    const planned = await this.db.withTenant(system, async (tx) => {
      const due = await tx.recurringMaintenance.findMany({
        where: { estateId, active: true, nextRunOn: { lte: new Date(`${today}T00:00:00.000Z`) } },
        take: 500,
      });
      for (const plan of due) {
        const assignee = (plan.assignee ?? undefined) as Assignee | undefined;
        const order = await tx.workOrder.create({
          data: {
            estateId,
            number: formatNumber('WO', await this.nextNumber(tx, estateId, 'WO')),
            recurringId: plan.id,
            title: plan.title,
            scope: plan.scope,
            spaceId: plan.spaceId,
            ...this.assigneeData(assignee),
            createdBy: plan.createdBy,
          },
        });
        let next = plan.nextRunOn.toISOString().slice(0, 10);
        while (next <= today) next = nextRunDate(next, plan.frequency as Frequency);
        await tx.recurringMaintenance.update({
          where: { id: plan.id },
          data: { nextRunOn: new Date(`${next}T00:00:00.000Z`), lastWorkOrderId: order.id },
        });
        await this.workOrderEvent(
          tx,
          { estateId, userId: plan.createdBy } as EstateAccess,
          order,
          'created',
        );
      }
      return due.length;
    });
    return { closed, planned };
  }

  // ---- Reports -------------------------------------------------------------------------------

  async report(access: EstateAccess, query: z.infer<typeof maintenanceReportQuerySchema>) {
    const from = new Date(`${query.from}T00:00:00.000+01:00`);
    const to = new Date(new Date(`${query.to}T00:00:00.000+01:00`).getTime() + 86_400_000);
    return this.db.withTenant(access, async (tx) => {
      const rows = await tx.maintenanceRequest.findMany({
        where: { estateId: access.estateId, createdAt: { gte: from, lt: to } },
        select: {
          status: true,
          categoryId: true,
          createdAt: true,
          resolvedAt: true,
          slaDueAt: true,
          slaBreachLevel: true,
          rating: true,
        },
      });
      const categories = new Map(
        (await tx.maintenanceCategory.findMany({ where: { estateId: access.estateId } })).map(
          (c) => [c.id, c.name],
        ),
      );
      const resolved = rows.filter((row) => row.resolvedAt);
      const resolutionHours = resolved.map(
        (row) => ((row.resolvedAt as Date).getTime() - row.createdAt.getTime()) / 3_600_000,
      );
      const onTime = resolved.filter(
        (row) =>
          row.slaBreachLevel === 0 && row.slaDueAt && (row.resolvedAt as Date) <= row.slaDueAt,
      );
      const ratings = rows.flatMap((row) => (row.rating ? [row.rating] : []));
      const count = <K extends string>(values: K[]) => {
        const map = new Map<K, number>();
        for (const value of values) map.set(value, (map.get(value) ?? 0) + 1);
        return [...map.entries()];
      };
      const orders = await tx.workOrder.findMany({
        where: { estateId: access.estateId, createdAt: { gte: from, lt: to } },
        select: { labourCost: true, materialsCost: true, invoiceId: true },
      });
      const round = (value: number) => Math.round(value * 10) / 10;
      return {
        from: query.from,
        to: query.to,
        submitted: rows.length,
        resolved: resolved.length,
        open: rows.filter((row) => OPEN_REQUEST_STATUSES.includes(row.status as RequestStatus))
          .length,
        averageResolutionHours: resolutionHours.length
          ? round(sum(resolutionHours) / resolutionHours.length)
          : null,
        slaCompliancePercent: resolved.length
          ? round((onTime.length / resolved.length) * 100)
          : null,
        averageRating: ratings.length ? round(sum(ratings) / ratings.length) : null,
        byCategory: count(rows.map((row) => categories.get(row.categoryId) ?? 'Other')).map(
          ([category, value]) => ({ category, count: value }),
        ),
        byStatus: count(rows.map((row) => row.status as RequestStatus)).map(([status, value]) => ({
          status,
          count: value,
        })),
        costs: {
          labour: sum(orders.map((order) => toKobo(order.labourCost))),
          materials: sum(orders.map((order) => toKobo(order.materialsCost))),
          recharged: sum(
            orders
              .filter((order) => order.invoiceId)
              .map((order) => toKobo(order.labourCost) + toKobo(order.materialsCost)),
          ),
        },
      };
    });
  }

  // ---- Views and events ----------------------------------------------------------------------

  private async lookups(tx: Tx, estateId: string, rows: readonly RequestRow[]) {
    const categories = new Map(
      (
        await tx.maintenanceCategory.findMany({
          where: { estateId, id: { in: rows.map((row) => row.categoryId) } },
          select: { id: true, name: true },
        })
      ).map((row) => [row.id, row.name]),
    );
    const spaces = new Map(
      (
        await this.property.spacesByIds(
          tx,
          estateId,
          rows.flatMap((row) => (row.spaceId ? [row.spaceId] : [])),
        )
      ).map((space) => [space.id, space.code]),
    );
    return { categories, spaces };
  }

  private view(
    row: RequestRow,
    lookups: { categories: Map<string, string>; spaces: Map<string, string> },
  ) {
    return {
      id: row.id,
      number: row.number,
      kind: row.kind as 'maintenance' | 'complaint',
      categoryId: row.categoryId,
      categoryName: lookups.categories.get(row.categoryId) ?? '',
      priority: row.priority as Priority,
      spaceId: row.spaceId,
      unitCode: row.spaceId ? (lookups.spaces.get(row.spaceId) ?? null) : null,
      title: row.title,
      description: row.description,
      preferredTimes: row.preferredTimes,
      aboutNeighbour: row.aboutNeighbour,
      requestedBy: row.requestedBy,
      status: row.status as RequestStatus,
      slaDueAt: row.slaDueAt?.toISOString() ?? null,
      slaBreached: row.slaBreachLevel > 0,
      rejectionReason: row.rejectionReason,
      rating: row.rating,
      feedback: row.feedback,
      attachmentFileIds: row.attachmentFileIds,
      createdAt: row.createdAt.toISOString(),
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      closedAt: row.closedAt?.toISOString() ?? null,
    };
  }

  private workOrderView(
    row: WorkOrderRow | (Prisma.WorkOrderGetPayload<object> & { materials?: never[] }),
  ) {
    const materials = 'materials' in row && row.materials ? row.materials : [];
    return {
      id: row.id,
      number: row.number,
      requestId: row.requestId,
      title: row.title,
      scope: row.scope,
      spaceId: row.spaceId,
      assigneeType: row.assigneeType as 'staff' | 'vendor' | null,
      assigneeUserId: row.assigneeUserId,
      vendorName: row.vendorName,
      scheduledStart: row.scheduledStart?.toISOString() ?? null,
      scheduledEnd: row.scheduledEnd?.toISOString() ?? null,
      status: row.status as WorkOrderStatus,
      visitorPassId: row.visitorPassId,
      labourCost: toKobo(row.labourCost),
      materialsCost: toKobo(row.materialsCost),
      rechargeToResident: row.rechargeToResident,
      invoiceId: row.invoiceId,
      resolutionNotes: row.resolutionNotes,
      materials: materials.map((material) => ({
        id: material.id,
        item: material.item,
        quantity: material.quantity,
        unitCost: toKobo(material.unitCost),
        amount: toKobo(material.amount),
      })),
      completedAt: row.completedAt?.toISOString() ?? null,
      verifiedBy: row.verifiedBy,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async event(
    tx: Tx,
    estateId: string,
    row: Pick<RequestRow, 'id' | 'status' | 'priority' | 'kind'>,
    verb: string,
    actorId: string | null,
  ) {
    await appendOutboxEvents(tx, [
      {
        type: `maintenance.request.${verb}`,
        estateId,
        aggregateType: 'maintenance_request',
        aggregateId: row.id,
        payload: { requestId: row.id, status: row.status, priority: row.priority, kind: row.kind },
        audit: {
          actorType: actorId ? 'user' : 'system',
          actorId,
          action: `maintenance.request.${verb}`,
          resourceType: 'maintenance_request',
          resourceId: row.id,
          after: { status: row.status },
        },
      },
    ]);
  }

  private async workOrderEvent(
    tx: Tx,
    access: { estateId: string; userId: string | null },
    row: Pick<Prisma.WorkOrderGetPayload<object>, 'id' | 'status' | 'assigneeType'>,
    verb: 'created' | 'assigned' | 'completed' | 'verified',
    extra: Record<string, string | number | null> = {},
  ) {
    await appendOutboxEvents(tx, [
      {
        type: `maintenance.workorder.${verb}`,
        estateId: access.estateId,
        aggregateType: 'work_order',
        aggregateId: row.id,
        payload: {
          workOrderId: row.id,
          status: row.status,
          assigneeType: row.assigneeType,
          ...extra,
        },
        audit: {
          actorType: access.userId ? 'user' : 'system',
          actorId: access.userId,
          action: `maintenance.workorder.${verb === 'created' ? 'create' : verb === 'assigned' ? 'assign' : verb === 'completed' ? 'complete' : 'verify'}`,
          resourceType: 'work_order',
          resourceId: row.id,
          after: { status: row.status, ...extra },
        },
      },
    ]);
  }
}
