import { Injectable } from '@nestjs/common';
import type { createMoveSchema, moveChecklistSchema, moveListQuerySchema } from '@safezone/schemas';
import type { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client';
import type { EstateAccess } from '../../../common/auth/auth.decorators';
import { DatabaseService } from '../../../common/database/database.service';
import type { Tx } from '../../../common/database/tenant-context';
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
} from '../../../common/errors/domain-error';
import { appendOutboxEvents } from '../../../common/outbox/outbox-writer';
import { AuthzService } from '../../authz/authz.service';
import { addDays, todayInLagos } from '../../billing/domain/billing';
import { InvoicesService } from '../../billing/invoices.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { PropertyService } from '../../property/property.service';
import { TenancyService } from '../../tenancy/tenancy.service';
import { isStaffWith, OccupancyService } from '../occupancy.service';

type MoveRow = Prisma.MoveEventGetPayload<object>;
const DEFAULT_MOVE_OUT_CHECKLIST = [
  'Access tags returned',
  'Gate remote returned',
  'Final meter reading',
  'Unit inspected',
];
const LEASE_REMINDER_DAYS = [60, 30, 7] as const;
const SECURITY_ROLES = ['security_supervisor', 'security_officer'];
const MANAGER_ROLES = ['estate_manager', 'estate_administrator', 'estate_owner'];

/**
 * Move-in and move-out (occupancy.md §5) and lease expiry reminders. On the move-out date the occupancy
 * ends through OccupancyService.endOccupancy (passes revoked, vehicles off, unit vacant, owner told).
 */
@Injectable()
export class MovesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly occupancy: OccupancyService,
    private readonly property: PropertyService,
    private readonly invoices: InvoicesService,
    private readonly tenancy: TenancyService,
    private readonly authz: AuthzService,
    private readonly notifications: NotificationsService,
  ) {}

  /** The household head, an owner of the unit, or a manager (resident.approve) may schedule. */
  private async assertMayManage(
    tx: Tx,
    access: EstateAccess,
    occupancy: { spaceId: string; householdId: string },
  ) {
    if (isStaffWith(access, 'resident.approve')) return;
    const head = await tx.household.count({
      where: { id: occupancy.householdId, headUserId: access.userId, status: 'active' },
    });
    if (head > 0) return;
    const owners =
      (await this.property.activeOwners(tx, access.estateId, [occupancy.spaceId])).get(
        occupancy.spaceId,
      ) ?? [];
    if (owners.some((owner) => owner.userId === access.userId)) return;
    throw new ForbiddenError(
      'Only the household head, the owner or management can schedule this move',
    );
  }

  async schedule(access: EstateAccess, input: z.infer<typeof createMoveSchema>) {
    if (input.scheduledOn < todayInLagos())
      throw new DomainError('MOVE_DATE_PAST', 'Choose today or a later date', 422);
    const created = await this.db.withTenant(access, async (tx) => {
      const occupancy = await tx.occupancy.findFirst({
        where: { id: input.occupancyId, estateId: access.estateId, status: 'active' },
      });
      if (!occupancy) throw new NotFoundError('Occupancy not found', 'OCCUPANCY_NOT_FOUND');
      await this.assertMayManage(tx, access, occupancy);
      const open = await tx.moveEvent.count({
        where: { occupancyId: occupancy.id, type: input.type, status: 'scheduled' },
      });
      if (open > 0)
        throw new ConflictError('MOVE_ALREADY_SCHEDULED', 'This move is already scheduled');
      const outstanding =
        input.type === 'move_out'
          ? await this.invoices.unitOutstanding(tx, access.estateId, occupancy.spaceId)
          : 0;
      const row = await tx.moveEvent.create({
        data: {
          estateId: access.estateId,
          occupancyId: occupancy.id,
          spaceId: occupancy.spaceId,
          householdId: occupancy.householdId,
          type: input.type,
          scheduledOn: new Date(`${input.scheduledOn}T00:00:00.000Z`),
          gateNotice: input.gateNotice,
          checklist:
            input.type === 'move_out'
              ? DEFAULT_MOVE_OUT_CHECKLIST.map((item) => ({ item, done: false }))
              : [],
          outstandingBalance: BigInt(outstanding),
          createdBy: access.userId,
        },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'occupancy.move.scheduled',
          estateId: access.estateId,
          aggregateType: 'move_event',
          aggregateId: row.id,
          payload: {
            moveId: row.id,
            type: row.type,
            spaceId: row.spaceId,
            scheduledOn: input.scheduledOn,
          },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'occupancy.move.schedule',
            resourceType: 'occupancy',
            resourceId: occupancy.id,
            after: { type: row.type, scheduledOn: input.scheduledOn, outstanding },
          },
        },
      ]);
      return row;
    });
    const recipients = [
      ...(await this.authz.holdersOf(access.estateId, SECURITY_ROLES)),
      ...(created.type === 'move_out'
        ? await this.authz.holdersOf(access.estateId, MANAGER_ROLES)
        : []),
    ];
    await this.db.withTenant(access, async (tx) => {
      const unitCode = await this.unitCode(tx, access.estateId, created.spaceId);
      const owners =
        (await this.property.activeOwners(tx, access.estateId, [created.spaceId])).get(
          created.spaceId,
        ) ?? [];
      const userIds = [...new Set([...recipients, ...owners.map((owner) => owner.userId)])].filter(
        (id) => id !== access.userId,
      );
      if (userIds.length > 0) {
        await this.notifications.request(tx, {
          intent: 'occupancy.move_scheduled',
          userIds,
          estateId: access.estateId,
          data: {
            unitCode,
            kind: created.type === 'move_in' ? 'Move-in' : 'Move-out',
            date: created.scheduledOn.toISOString().slice(0, 10),
            moveId: created.id,
          },
          dedupeKey: `move:${created.id}:scheduled`,
        });
      }
    });
    return this.get(access, created.id);
  }

  async list(access: EstateAccess, query: z.infer<typeof moveListQuerySchema>) {
    const staff = isStaffWith(access, 'resident.approve') || isStaffWith(access, 'gate.verify');
    const households = staff
      ? []
      : (await this.occupancy.householdsOf(access.estateId, access.userId)).map(
          (h) => h.householdId,
        );
    return this.db.withTenant(access, async (tx) => {
      const owned = staff
        ? []
        : (await this.property.ownedUnits(tx, access.estateId, access.userId)).map(
            (o) => o.ownership.spaceId,
          );
      const rows = await tx.moveEvent.findMany({
        where: {
          estateId: access.estateId,
          ...(query.status ? { status: query.status } : {}),
          ...(query.on ? { scheduledOn: new Date(`${query.on}T00:00:00.000Z`) } : {}),
          ...(staff
            ? {}
            : { OR: [{ householdId: { in: households } }, { spaceId: { in: owned } }] }),
        },
        orderBy: [{ scheduledOn: 'asc' }, { createdAt: 'asc' }],
        take: 500,
      });
      const codes = new Map(
        (
          await this.property.spacesByIds(
            tx,
            access.estateId,
            rows.map((row) => row.spaceId),
          )
        ).map((s) => [s.id, s.code]),
      );
      // Guards see the gate notice, never balances.
      const showBalance = isStaffWith(access, 'resident.approve') || !staff;
      return rows.map((row) => this.view(row, codes.get(row.spaceId) ?? '', showBalance));
    });
  }

  async get(access: EstateAccess, id: string) {
    return this.db.withTenant(access, async (tx) => {
      const row = await tx.moveEvent.findFirst({ where: { id, estateId: access.estateId } });
      if (!row) throw new NotFoundError('Move not found', 'MOVE_NOT_FOUND');
      return this.view(row, await this.unitCode(tx, access.estateId, row.spaceId), true);
    });
  }

  async updateChecklist(
    access: EstateAccess,
    id: string,
    input: z.infer<typeof moveChecklistSchema>,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const row = await tx.moveEvent.findFirst({
        where: { id, estateId: access.estateId, status: 'scheduled' },
      });
      if (!row) throw new NotFoundError('Move not found', 'MOVE_NOT_FOUND');
      const updated = await tx.moveEvent.update({
        where: { id },
        data: { checklist: input.items },
      });
      return this.view(updated, await this.unitCode(tx, access.estateId, row.spaceId), true);
    });
  }

  async cancel(access: EstateAccess, id: string, reason: string) {
    await this.db.withTenant(access, async (tx) => {
      const row = await tx.moveEvent.findFirst({ where: { id, estateId: access.estateId } });
      if (!row) throw new NotFoundError('Move not found', 'MOVE_NOT_FOUND');
      if (row.status !== 'scheduled')
        throw new ConflictError('MOVE_NOT_SCHEDULED', 'This move is already closed');
      await this.assertMayManage(tx, access, row);
      await tx.moveEvent.update({
        where: { id },
        data: { status: 'cancelled', cancelReason: reason },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'occupancy.move.cancelled',
          estateId: access.estateId,
          aggregateType: 'move_event',
          aggregateId: id,
          payload: { moveId: id },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'occupancy.move.cancel',
            resourceType: 'move_event',
            resourceId: id,
            reason,
          },
        },
      ]);
    });
    return this.get(access, id);
  }

  /** Manager completes a move now; the daily job completes due move-outs (occupancy.md §5 step 3). */
  async complete(access: EstateAccess, id: string) {
    await this.completeMove({ estateId: access.estateId, userId: access.userId }, id);
    return this.get(access, id);
  }

  private async completeMove(
    actor: { estateId: string; userId: string | null },
    id: string,
  ): Promise<boolean> {
    const settings = await this.tenancy.getSettings(actor);
    const row = await this.db.withTenant(actor, (tx) =>
      tx.moveEvent.findFirst({ where: { id, estateId: actor.estateId } }),
    );
    if (!row) throw new NotFoundError('Move not found', 'MOVE_NOT_FOUND');
    if (row.status !== 'scheduled')
      throw new ConflictError('MOVE_NOT_SCHEDULED', 'This move is already closed');
    if (row.type === 'move_out') {
      if (settings['occupancy.block_move_out_with_balance']) {
        const outstanding = await this.db.withTenant(actor, (tx) =>
          this.invoices.unitOutstanding(tx, actor.estateId, row.spaceId),
        );
        if (outstanding > 0)
          throw new DomainError(
            'MOVE_OUT_BALANCE_OUTSTANDING',
            'The unit has unpaid invoices. Settle them before moving out.',
            422,
          );
      }
      await this.occupancy.endOccupancy(actor, row.occupancyId, 'Moved out');
      const owners = await this.db.withTenant(actor, (tx) =>
        this.property.activeOwners(tx, actor.estateId, [row.spaceId]),
      );
      await this.db.withTenant(actor, async (tx) => {
        const recipients = (owners.get(row.spaceId) ?? []).map((owner) => owner.userId);
        if (recipients.length > 0) {
          await this.notifications.request(tx, {
            intent: 'occupancy.move_completed',
            userIds: recipients,
            estateId: actor.estateId,
            data: {
              unitCode: await this.unitCode(tx, actor.estateId, row.spaceId),
              moveId: row.id,
            },
            dedupeKey: `move:${row.id}:completed`,
          });
        }
      });
    }
    await this.db.withTenant(actor, async (tx) => {
      await tx.moveEvent.update({
        where: { id },
        data: { status: 'completed', completedAt: new Date(), completedBy: actor.userId },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'occupancy.move.completed',
          estateId: actor.estateId,
          aggregateType: 'move_event',
          aggregateId: id,
          payload: { moveId: id, type: row.type, spaceId: row.spaceId },
          audit: {
            actorType: actor.userId ? 'user' : 'system',
            actorId: actor.userId,
            action: 'occupancy.move.complete',
            resourceType: 'move_event',
            resourceId: id,
          },
        },
      ]);
    });
    return true;
  }

  /**
   * Daily (occupancy.md §5): completes move-outs due today or earlier, completes due move-ins, and sends
   * lease expiry reminders at 60, 30 and 7 days, then on expiry asks managers to renew or move out.
   */
  async daily(
    estateId: string,
    today: string,
  ): Promise<{ completed: number; failed: number; reminders: number }> {
    const system = { estateId, userId: null };
    const due = await this.db.withTenant(system, (tx) =>
      tx.moveEvent.findMany({
        where: {
          estateId,
          status: 'scheduled',
          scheduledOn: { lte: new Date(`${today}T00:00:00.000Z`) },
        },
        select: { id: true },
        take: 500,
      }),
    );
    let completed = 0;
    let failed = 0;
    for (const move of due) {
      try {
        await this.completeMove(system, move.id);
        completed += 1;
      } catch {
        // Blocked by balance or already ended: left scheduled for management to resolve.
        failed += 1;
      }
    }
    let reminders = 0;
    const managers = await this.authz.holdersOf(estateId, MANAGER_ROLES);
    await this.db.withTenant(system, async (tx) => {
      for (const days of [...LEASE_REMINDER_DAYS, 0]) {
        const endsOn = new Date(`${addDays(today, days)}T00:00:00.000Z`);
        const rows = await tx.occupancy.findMany({
          where: { estateId, status: 'active', type: 'tenant', endsOn },
          include: { household: { select: { headUserId: true } } },
        });
        for (const row of rows) {
          const unitCode = await this.unitCode(tx, estateId, row.spaceId);
          await this.notifications.request(tx, {
            intent: days === 0 ? 'occupancy.lease_expired' : 'occupancy.lease_expiring',
            userIds: days === 0 ? managers : [row.household.headUserId, ...managers],
            estateId,
            data: {
              unitCode,
              days: String(days),
              endsOn: addDays(today, days),
              occupancyId: row.id,
            },
            dedupeKey: `lease:${row.id}:${days}`,
          });
          reminders += 1;
        }
      }
    });
    return { completed, failed, reminders };
  }

  private async unitCode(tx: Tx, estateId: string, spaceId: string): Promise<string> {
    const [space] = await this.property.spacesByIds(tx, estateId, [spaceId]);
    return space?.code ?? '';
  }

  private view(row: MoveRow, unitCode: string, showBalance: boolean) {
    const notice = row.gateNotice as { items?: string; vehicles?: string[]; notes?: string };
    return {
      id: row.id,
      type: row.type as 'move_in' | 'move_out',
      occupancyId: row.occupancyId,
      spaceId: row.spaceId,
      unitCode,
      scheduledOn: row.scheduledOn.toISOString().slice(0, 10),
      gateNotice: { ...notice, vehicles: notice.vehicles ?? [] },
      checklist: row.checklist as { item: string; done: boolean }[],
      status: row.status as 'scheduled' | 'completed' | 'cancelled',
      outstandingBalance: showBalance ? Number(row.outstandingBalance) : 0,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    };
  }
}
