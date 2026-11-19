import { Injectable } from '@nestjs/common';
import { BUILT_IN_ROLES } from '@safezone/permissions';
import type {
  createIncidentSchema,
  incidentListQuerySchema,
  incidentTransitionSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import type { EstateAccess } from '../../common/auth/auth.decorators';
import { DatabaseService } from '../../common/database/database.service';
import type { Tx } from '../../common/database/tenant-context';
import { ConflictError, DomainError, NotFoundError } from '../../common/errors/domain-error';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { AuthzService } from '../authz/authz.service';
import { FilesService } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { isStaffWith } from '../occupancy/occupancy.service';
import { PropertyService } from '../property/property.service';
import {
  acceptsAdditions,
  nextIncidentStatus,
  notifiesImmediately,
  occurredAtValid,
  OPEN_INCIDENT_STATUSES,
  reporterTypeOf,
  type IncidentAction,
} from './domain/incidents';
import { GatesService } from './gates.service';

type IncidentRow = Prisma.IncidentGetPayload<{
  include: { _count: { select: { evidence: true } } };
}>;

const cursorSchema = z.object({ createdAt: z.iso.datetime(), id: z.uuid() });

/** Estate roles that triage incidents (they get critical alerts). */
const MANAGER_ROLE_KEYS = BUILT_IN_ROLES.filter(
  (role) => role.level === 'estate' && role.permissions.includes('incident.manage'),
).map((role) => role.key);
/** Roles an incident can be assigned to: managers and gate staff. */
const ASSIGNABLE_ROLE_KEYS = BUILT_IN_ROLES.filter(
  (role) =>
    role.level === 'estate' &&
    (role.permissions.includes('incident.manage') || role.permissions.includes('gate.verify')),
).map((role) => role.key);

const PAST_TENSE: Record<IncidentAction, string> = {
  review: 'reviewed',
  assign: 'assigned',
  resolve: 'resolved',
  reopen: 'reopened',
  close: 'closed',
};

/**
 * Incidents (security.md §2.8, §4). Managers (incident.manage) see every incident; everyone else sees the
 * incidents they reported or were assigned (rule 7). Incidents are never deleted; the timeline and the
 * evidence list are append-only.
 */
@Injectable()
export class IncidentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly files: FilesService,
    private readonly gates: GatesService,
    private readonly property: PropertyService,
    private readonly authz: AuthzService,
    private readonly notifications: NotificationsService,
  ) {}

  private isManager(access: EstateAccess): boolean {
    return isStaffWith(access, 'incident.manage');
  }

  private visibleWhere(access: EstateAccess): Prisma.IncidentWhereInput {
    if (this.isManager(access)) return {};
    return { OR: [{ reportedBy: access.userId }, { assignedTo: access.userId }] };
  }

  async report(access: EstateAccess, input: z.infer<typeof createIncidentSchema>) {
    const occurredAt = new Date(input.occurredAt);
    if (!occurredAtValid(occurredAt))
      throw new DomainError('INCIDENT_IN_FUTURE', 'The time cannot be in the future', 422);
    const fileIds = [...new Set(input.evidenceFileIds)];
    const evidence = await this.files.evidenceFilesOf(access.estateId, access.userId, fileIds);
    if (evidence.length !== fileIds.length)
      throw new DomainError(
        'EVIDENCE_INVALID',
        'Upload the photos or videos for this incident first',
        422,
      );
    const isStaff = isStaffWith(access, 'incident.report') || this.isManager(access);
    const reporterType = reporterTypeOf(access.permissions, isStaff);

    const created = await this.db.withTenant(access, async (tx) => {
      if (input.gateId) await this.gates.activeGate(tx, access.estateId, input.gateId);
      if (input.spaceId) {
        const [space] = await this.property.spacesByIds(tx, access.estateId, [input.spaceId]);
        if (!space) throw new NotFoundError('Unit not found', 'SPACE_NOT_FOUND');
      }
      const row = await tx.incident.create({
        data: {
          estateId: access.estateId,
          category: input.category,
          severity: input.severity,
          title: input.title,
          description: input.description,
          locationKind: input.locationKind,
          gateId: input.gateId ?? null,
          locationSpaceId: input.spaceId ?? null,
          locationText: input.locationText ?? null,
          occurredAt,
          peopleInvolved: input.peopleInvolved ?? null,
          reportedBy: access.userId,
          reporterType,
        },
      });
      if (evidence.length > 0) await this.addEvidenceRows(tx, access, row.id, evidence);
      await this.event(
        tx,
        access,
        row.id,
        'security.incident.reported',
        'security.incident.report',
        {
          category: row.category,
          severity: row.severity,
          reporterType,
          evidence: evidence.length,
        },
      );
      if (notifiesImmediately(row.severity)) {
        const managers = (await this.authz.holdersOf(access.estateId, MANAGER_ROLE_KEYS)).filter(
          (id) => id !== access.userId,
        );
        if (managers.length > 0)
          await this.notifications.request(tx, {
            intent: 'security.incident_critical',
            userIds: managers,
            estateId: access.estateId,
            data: { title: row.title, incidentId: row.id },
            dedupeKey: `incident:${row.id}:critical`,
          });
      }
      return row;
    });
    return this.detail(access, created.id);
  }

  async list(access: EstateAccess, query: z.infer<typeof incidentListQuerySchema>) {
    const after = query.cursor
      ? decodeCursor(
          query.cursor,
          (value): value is z.infer<typeof cursorSchema> => cursorSchema.safeParse(value).success,
        )
      : undefined;
    return this.db.withTenant(access, async (tx) => {
      const rows = await tx.incident.findMany({
        where: {
          estateId: access.estateId,
          ...(query.status ? { status: query.status } : {}),
          ...(query.open ? { status: { in: [...OPEN_INCIDENT_STATUSES] } } : {}),
          ...(query.severity ? { severity: query.severity } : {}),
          ...(query.mine ? { reportedBy: access.userId } : {}),
          AND: [
            this.visibleWhere(access),
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
        include: { _count: { select: { evidence: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      });
      const page = rows.slice(0, query.limit);
      const names = await this.locationNames(tx, access.estateId, page);
      const last = page.at(-1);
      return {
        items: page.map((row) => this.view(row, names)),
        nextCursor:
          rows.length > query.limit && last
            ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
            : null,
      };
    });
  }

  async detail(access: EstateAccess, incidentId: string) {
    return this.db.withTenant(access, async (tx) => {
      const row = await this.findVisible(tx, access, incidentId);
      const [names, evidence, notes] = await Promise.all([
        this.locationNames(tx, access.estateId, [row]),
        tx.incidentEvidence.findMany({
          where: { incidentId: row.id, estateId: access.estateId },
          orderBy: { createdAt: 'asc' },
        }),
        tx.incidentNote.findMany({
          where: { incidentId: row.id, estateId: access.estateId },
          orderBy: { createdAt: 'asc' },
        }),
      ]);
      return {
        ...this.view(row, names),
        evidence: evidence.map((item) => ({
          id: item.id,
          fileId: item.fileId,
          sha256: item.sha256,
          uploadedBy: item.uploadedBy,
          uploadedAt: item.uploadedAt?.toISOString() ?? null,
          addedBy: item.addedBy,
          createdAt: item.createdAt.toISOString(),
        })),
        notes: notes.map((note) => ({
          id: note.id,
          authorId: note.authorId,
          kind: note.kind as 'note' | 'status',
          body: note.body,
          fromStatus: note.fromStatus as 'reported' | null,
          toStatus: note.toStatus as 'reported' | null,
          createdAt: note.createdAt.toISOString(),
        })),
      };
    });
  }

  async addNote(access: EstateAccess, incidentId: string, body: string) {
    await this.db.withTenant(access, async (tx) => {
      const row = await this.findVisible(tx, access, incidentId);
      if (!acceptsAdditions(row.status))
        throw new ConflictError('INCIDENT_CLOSED', 'This incident is closed');
      await tx.incidentNote.create({
        data: {
          estateId: access.estateId,
          incidentId: row.id,
          authorId: access.userId,
          kind: 'note',
          body,
        },
      });
      await this.event(tx, access, row.id, 'security.incident.noted', 'security.incident.note', {});
    });
    return this.detail(access, incidentId);
  }

  async addEvidence(access: EstateAccess, incidentId: string, fileIds: readonly string[]) {
    const unique = [...new Set(fileIds)];
    const evidence = await this.files.evidenceFilesOf(access.estateId, access.userId, unique);
    if (evidence.length !== unique.length)
      throw new DomainError(
        'EVIDENCE_INVALID',
        'Upload the photos or videos for this incident first',
        422,
      );
    await this.db.withTenant(access, async (tx) => {
      const row = await this.findVisible(tx, access, incidentId);
      if (!acceptsAdditions(row.status))
        throw new ConflictError('INCIDENT_CLOSED', 'This incident is closed');
      const existing = await tx.incidentEvidence.count({
        where: { incidentId: row.id, estateId: access.estateId },
      });
      if (existing + evidence.length > 30)
        throw new DomainError('EVIDENCE_LIMIT', 'An incident can hold up to 30 files', 422);
      await this.addEvidenceRows(tx, access, row.id, evidence);
      await this.event(
        tx,
        access,
        row.id,
        'security.incident.evidence_added',
        'security.incident.evidence',
        { files: evidence.map((item) => ({ fileId: item.id, sha256: item.sha256 })) },
      );
    });
    return this.detail(access, incidentId);
  }

  async transition(
    access: EstateAccess,
    incidentId: string,
    input: z.infer<typeof incidentTransitionSchema>,
  ) {
    await this.db.withTenant(access, async (tx) => {
      const row = await this.findVisible(tx, access, incidentId);
      if (row.version !== input.version)
        throw new ConflictError(
          'VERSION_CONFLICT',
          'Someone else changed this incident. Reload it.',
        );
      const next = nextIncidentStatus(row.status, input.action);
      if (!next)
        throw new ConflictError(
          'INCIDENT_TRANSITION_INVALID',
          `An incident that is ${row.status.replace('_', ' ')} cannot be moved that way`,
        );
      if (input.action === 'assign') {
        const assignable = await this.authz.holdersOf(access.estateId, ASSIGNABLE_ROLE_KEYS);
        if (!input.assigneeId || !assignable.includes(input.assigneeId))
          throw new DomainError(
            'ASSIGNEE_INVALID',
            'Assign the incident to a guard or manager of this estate',
            422,
          );
      }
      const now = new Date();
      const updated = await tx.incident.updateMany({
        where: { id: row.id, estateId: access.estateId, version: row.version },
        data: {
          status: next,
          version: { increment: 1 },
          ...(input.action === 'assign' ? { assignedTo: input.assigneeId } : {}),
          ...(input.action === 'resolve' ? { resolution: input.resolution, resolvedAt: now } : {}),
          ...(input.action === 'reopen' ? { resolvedAt: null } : {}),
          ...(input.action === 'close' ? { closedAt: now } : {}),
          ...(input.policeReportRef !== undefined
            ? { policeReportRef: input.policeReportRef }
            : {}),
        },
      });
      if (updated.count !== 1)
        throw new ConflictError(
          'VERSION_CONFLICT',
          'Someone else changed this incident. Reload it.',
        );
      await tx.incidentNote.create({
        data: {
          estateId: access.estateId,
          incidentId: row.id,
          authorId: access.userId,
          kind: 'status',
          body: input.note ?? (input.action === 'resolve' ? (input.resolution ?? null) : null),
          fromStatus: row.status,
          toStatus: next,
        },
      });
      await this.event(
        tx,
        access,
        row.id,
        `security.incident.${PAST_TENSE[input.action]}`,
        `security.incident.${input.action}`,
        {
          from: row.status,
          to: next,
          ...(input.assigneeId ? { assigneeId: input.assigneeId } : {}),
        },
      );
      const recipients = [
        ...new Set(
          [row.reportedBy, input.action === 'assign' ? input.assigneeId : null].filter(
            (id): id is string => Boolean(id) && id !== access.userId,
          ),
        ),
      ];
      if (recipients.length > 0)
        await this.notifications.request(tx, {
          intent: 'security.incident_updated',
          userIds: recipients,
          estateId: access.estateId,
          data: { title: row.title, status: next.replaceAll('_', ' '), incidentId: row.id },
          dedupeKey: `incident:${row.id}:v${row.version + 1}`,
        });
    });
    return this.detail(access, incidentId);
  }

  // ---- helpers -------------------------------------------------------------------------------

  private async findVisible(
    tx: Tx,
    access: EstateAccess,
    incidentId: string,
  ): Promise<IncidentRow> {
    const row = await tx.incident.findFirst({
      where: { id: incidentId, estateId: access.estateId, AND: [this.visibleWhere(access)] },
      include: { _count: { select: { evidence: true } } },
    });
    if (!row) throw new NotFoundError('Incident not found', 'INCIDENT_NOT_FOUND');
    return row;
  }

  private async addEvidenceRows(
    tx: Tx,
    access: EstateAccess,
    incidentId: string,
    files: readonly {
      id: string;
      sha256: string | null;
      uploadedBy: string;
      uploadedAt: Date | null;
    }[],
  ) {
    await tx.incidentEvidence.createMany({
      data: files.map((file) => ({
        estateId: access.estateId,
        incidentId,
        fileId: file.id,
        sha256: file.sha256,
        uploadedBy: file.uploadedBy,
        uploadedAt: file.uploadedAt,
        addedBy: access.userId,
      })),
      skipDuplicates: true,
    });
  }

  private async locationNames(tx: Tx, estateId: string, rows: readonly IncidentRow[]) {
    const gateIds = [...new Set(rows.map((row) => row.gateId).filter((id): id is string => !!id))];
    const spaceIds = rows.map((row) => row.locationSpaceId).filter((id): id is string => !!id);
    const [gates, spaces] = await Promise.all([
      gateIds.length > 0
        ? tx.gate.findMany({
            where: { estateId, id: { in: gateIds } },
            select: { id: true, name: true },
          })
        : [],
      this.property.spacesByIds(tx, estateId, spaceIds),
    ]);
    return {
      gates: new Map(gates.map((gate) => [gate.id, gate.name])),
      spaces: new Map(spaces.map((space) => [space.id, space.code])),
    };
  }

  private view(
    row: IncidentRow,
    names: { gates: Map<string, string>; spaces: Map<string, string> },
  ) {
    return {
      id: row.id,
      category: row.category as 'other',
      severity: row.severity as 'low',
      title: row.title,
      description: row.description,
      locationKind: row.locationKind as 'other',
      gateId: row.gateId,
      gateName: row.gateId ? (names.gates.get(row.gateId) ?? null) : null,
      spaceId: row.locationSpaceId,
      unitCode: row.locationSpaceId ? (names.spaces.get(row.locationSpaceId) ?? null) : null,
      locationText: row.locationText,
      occurredAt: row.occurredAt.toISOString(),
      peopleInvolved: row.peopleInvolved,
      reportedBy: row.reportedBy,
      reporterType: row.reporterType as 'guard',
      status: row.status as 'reported',
      assignedTo: row.assignedTo,
      resolution: row.resolution,
      linkedSosId: row.linkedSosId,
      policeReportRef: row.policeReportRef,
      evidenceCount: row._count.evidence,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      closedAt: row.closedAt?.toISOString() ?? null,
    };
  }

  private async event(
    tx: Tx,
    access: EstateAccess,
    incidentId: string,
    type: string,
    action: string,
    details: Record<string, unknown>,
  ) {
    await appendOutboxEvents(tx, [
      {
        type,
        estateId: access.estateId,
        aggregateType: 'incident',
        aggregateId: incidentId,
        payload: { incidentId, ...details } as Prisma.InputJsonValue,
        audit: {
          actorType: 'user',
          actorId: access.userId,
          action,
          resourceType: 'incident',
          resourceId: incidentId,
          after: details as Prisma.InputJsonValue,
        },
      },
    ]);
  }
}
