import { Injectable, Optional } from '@nestjs/common';
import type {
  createRestrictedVisitorSchema,
  createWalkinSchema,
  gateEventInputSchema,
  gateEventListQuerySchema,
  updateRestrictedVisitorSchema,
  verifyCredentialSchema,
  walkinListQuerySchema,
} from '@safezone/schemas';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import type { EstateAccess } from '../../common/auth/auth.decorators';
import { DatabaseService } from '../../common/database/database.service';
import type { TenantContext, Tx } from '../../common/database/tenant-context';
import { ConflictError, DomainError, NotFoundError } from '../../common/errors/domain-error';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { RealtimePublisherService } from '../../common/realtime/realtime-publisher.service';
import { NotificationsService } from '../notifications/notifications.service';
import { normalisePlate } from '../occupancy/domain/occupancy';
import { isStaffWith, OccupancyService } from '../occupancy/occupancy.service';
import { PropertyService } from '../property/property.service';
import { GatesService } from '../security/gates.service';
import { TenancyService } from '../tenancy/tenancy.service';
import { decideEntry, type DecisionResult } from './domain/validity';
import { PassKeysService } from './pass-keys.service';
import { passFacts, type PassRow } from './passes.service';

const CLOCK_SKEW_MS = 5 * 60_000;
const eventCursorSchema = z.object({ occurredAt: z.iso.datetime(), id: z.uuid() });
const walkinCursorSchema = z.object({ createdAt: z.iso.datetime(), id: z.uuid() });
type GateEventRow = Prisma.GateEventGetPayload<object>;
type WalkinRow = Prisma.WalkinRequestGetPayload<object>;

function toEvent(row: GateEventRow, created: boolean) {
  return {
    id: row.id,
    gateId: row.gateId,
    passId: row.passId,
    walkinId: row.walkinId,
    direction: row.direction as 'in' | 'out',
    visitorName: row.visitorName,
    vehiclePlate: row.vehiclePlate,
    decision: row.decision as 'allow',
    decisionReason: row.decisionReason,
    guardUserId: row.guardUserId,
    occurredAt: row.occurredAt.toISOString(),
    clockSkewed: row.clockSkewed,
    offline: row.offline,
    offlineSignin: row.offlineSignin,
    created,
  };
}

/** Gate operations (visitor.md §6, §8): verification, entry/exit records, offline support, walk-ins. */
@Injectable()
export class GateService {
  constructor(
    private readonly db: DatabaseService,
    private readonly keys: PassKeysService,
    private readonly gates: GatesService,
    private readonly occupancy: OccupancyService,
    private readonly property: PropertyService,
    private readonly tenancy: TenancyService,
    private readonly notifications: NotificationsService,
    @Optional() private readonly realtime?: RealtimePublisherService,
  ) {}

  // ---- Verification --------------------------------------------------------------------------

  /** Online verify (p95 target 300 ms). Does not record anything: the device then posts the event. */
  async verify(context: TenantContext, input: z.infer<typeof verifyCredentialSchema>) {
    return this.db.withTenant(context, async (tx) => {
      await this.gates.activeGate(tx, context.estateId, input.gateId);
      let rows: PassRow[] = [];
      if (input.qr) {
        const claims = await this.keys.verify(tx, context.estateId, input.qr);
        if (!claims) return { decision: 'deny' as const, reasons: ['invalid_qr'], pass: null };
        rows = await tx.visitorPass.findMany({
          where: { id: claims.passId, estateId: context.estateId },
          include: { invitation: true },
        });
      } else if (input.pin) {
        rows = await tx.visitorPass.findMany({
          where: {
            estateId: context.estateId,
            pinLookup: this.keys.pinLookup(context.estateId, input.pin),
            revokedAt: null,
            validTo: { gte: new Date(Date.now() - 86_400_000) },
          },
          include: { invitation: true },
          take: 3,
        });
      }
      const row = rows[0];
      if (!row) return { decision: 'deny' as const, reasons: ['unknown_pass'], pass: null };

      let result: DecisionResult =
        input.direction === 'out'
          ? { decision: 'allow', reasons: [] }
          : decideEntry(passFacts(row), {
              now: new Date(),
              gateId: input.gateId,
              restricted: await this.isRestricted(
                tx,
                context.estateId,
                row.visitorPhone,
                row.vehiclePlate,
                row.visitorName,
              ),
            });
      if (rows.length > 1 && result.decision === 'allow')
        result = { decision: 'check', reasons: ['ambiguous_pin'] };
      const [unit] = row.invitation.spaceId
        ? await this.property.spacesByIds(tx, context.estateId, [row.invitation.spaceId])
        : [];
      return {
        decision: result.decision,
        reasons: result.reasons,
        pass: {
          id: row.id,
          type: row.invitation.type as 'one_time',
          visitorName: row.visitorName,
          vehiclePlate: row.vehiclePlate,
          unitCode: unit?.code ?? null,
          usesLeft: row.maxUses === null ? null : Math.max(0, row.maxUses - row.usesCount),
          validTo: row.validTo.toISOString(),
        },
      };
    });
  }

  // ---- Events --------------------------------------------------------------------------------

  async recordEvent(access: EstateAccess, input: z.infer<typeof gateEventInputSchema>) {
    const event = await this.db.withTenant(access, (tx) =>
      this.insertEvent(tx, access, input, { offline: false, skewed: false }),
    );
    if (event.created && this.realtime) {
      const data = {
        gateEventId: event.id,
        gateId: event.gateId,
        direction: event.direction,
        decision: event.decision,
        occurredAt: event.occurredAt,
      };
      await this.realtime.publishMany([
        { room: `estate:${access.estateId}:security`, event: 'gate:update', data },
        { room: `estate:${access.estateId}:gate:${event.gateId}`, event: 'gate:update', data },
      ]);
    }
    return event;
  }

  /**
   * Offline batch (visitor.md §7.8, §13): idempotent on client_uuid, flagged when the device clock is off by
   * more than 5 minutes. Each event is its own transaction so one bad event does not drop the batch.
   */
  async sync(
    access: EstateAccess,
    deviceNow: string,
    events: z.infer<typeof gateEventInputSchema>[],
    options: { offlineSignin?: boolean } = {},
  ) {
    const skewed = Math.abs(new Date(deviceNow).getTime() - Date.now()) > CLOCK_SKEW_MS;
    let accepted = 0;
    let duplicates = 0;
    const rejected: { clientUuid: string; code: string }[] = [];
    for (const event of events) {
      try {
        const result = await this.db.withTenant(access, (tx) =>
          this.insertEvent(tx, access, event, {
            offline: true,
            skewed,
            offlineSignin: options.offlineSignin ?? false,
          }),
        );
        if (result.created) accepted += 1;
        else duplicates += 1;
      } catch (error) {
        rejected.push({
          clientUuid: event.clientUuid,
          code: error instanceof DomainError ? error.code : 'INTERNAL_ERROR',
        });
      }
    }
    return { accepted, duplicates, rejected };
  }

  async events(access: EstateAccess, query: z.infer<typeof gateEventListQuerySchema>) {
    const after = query.cursor
      ? decodeCursor(
          query.cursor,
          (value): value is z.infer<typeof eventCursorSchema> =>
            eventCursorSchema.safeParse(value).success,
        )
      : undefined;
    const rows = await this.db.withTenant(access, (tx) =>
      tx.gateEvent.findMany({
        where: {
          estateId: access.estateId,
          ...(query.gateId ? { gateId: query.gateId } : {}),
          ...(query.passId ? { passId: query.passId } : {}),
          ...(query.from || query.to
            ? {
                occurredAt: {
                  ...(query.from ? { gte: new Date(query.from) } : {}),
                  ...(query.to ? { lte: new Date(query.to) } : {}),
                },
              }
            : {}),
          ...(after
            ? {
                OR: [
                  { occurredAt: { lt: new Date(after.occurredAt) } },
                  { occurredAt: new Date(after.occurredAt), id: { lt: after.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      }),
    );
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => toEvent(row, true)),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({ occurredAt: last.occurredAt.toISOString(), id: last.id })
          : null,
    };
  }

  /** People who entered in the last 24 hours and have not exited (by pass, walk-in or plate). */
  async inside(context: TenantContext) {
    const rows = await this.db.withTenant(context, (tx) =>
      tx.gateEvent.findMany({
        where: {
          estateId: context.estateId,
          occurredAt: { gte: new Date(Date.now() - 86_400_000) },
          decision: { in: ['allow', 'check', 'override'] },
        },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        take: 5000,
      }),
    );
    const state = new Map<string, GateEventRow>();
    for (const row of rows) {
      const key =
        row.passId ??
        row.walkinId ??
        (row.vehiclePlate ? `plate:${row.vehiclePlate}` : `event:${row.id}`);
      if (row.direction === 'in') state.set(key, row);
      else state.delete(key);
    }
    return [...state.values()].map((row) => ({
      passId: row.passId,
      walkinId: row.walkinId,
      visitorName: row.visitorName,
      vehiclePlate: row.vehiclePlate,
      gateId: row.gateId,
      enteredAt: row.occurredAt.toISOString(),
    }));
  }

  // ---- Offline support -----------------------------------------------------------------------

  /** Expected list for a gate device (visitor.md §6, §12): passes usable at this gate in the next hours. */
  async expected(context: TenantContext, gateId: string, hours: number) {
    return this.db.withTenant(context, async (tx) => {
      await this.gates.activeGate(tx, context.estateId, gateId);
      const now = new Date();
      const rows = await tx.visitorPass.findMany({
        where: {
          estateId: context.estateId,
          revokedAt: null,
          validTo: { gte: now },
          validFrom: { lte: new Date(now.getTime() + hours * 3600_000) },
          OR: [{ gateIds: { isEmpty: true } }, { gateIds: { has: gateId } }],
        },
        include: { invitation: true },
        take: 10_000,
      });
      const usable = rows.filter((row) => row.maxUses === null || row.usesCount < row.maxUses);
      const units = await this.property.spacesByIds(
        tx,
        context.estateId,
        usable.flatMap((row) => (row.invitation.spaceId ? [row.invitation.spaceId] : [])),
      );
      const unitById = new Map(units.map((unit) => [unit.id, unit.code]));
      const restricted = await this.activeRestricted(tx, context.estateId);
      return {
        generatedAt: now.toISOString(),
        passes: usable.map((row) => ({
          id: row.id,
          type: row.invitation.type as 'one_time',
          visitorName: row.visitorName,
          vehiclePlate: row.vehiclePlate,
          unitCode: row.invitation.spaceId ? (unitById.get(row.invitation.spaceId) ?? null) : null,
          validFrom: row.validFrom.toISOString(),
          validTo: row.validTo.toISOString(),
          recurrence:
            (row.recurrence as { days: number[]; from: string; to: string } | null) ?? null,
          gateIds: row.gateIds,
          maxUses: row.maxUses,
          usesCount: row.usesCount,
          pinDigest: PassKeysService.pinDigest(row.id, this.keys.unwrapPin(row.pinWrapped)),
        })),
        restricted: restricted.map((item) => ({
          phone: item.phone,
          plate: item.plateNormalised,
          name: item.name,
        })),
      };
    });
  }

  async revocations(context: TenantContext, since: string) {
    const rows = await this.db.withTenant(context, (tx) =>
      tx.visitorPass.findMany({
        where: {
          estateId: context.estateId,
          revokedAt: { gte: new Date(since) },
          validTo: { gte: new Date(Date.now() - 86_400_000) },
        },
        select: { id: true, revokedAt: true },
        orderBy: { revokedAt: 'asc' },
        take: 10_000,
      }),
    );
    return {
      generatedAt: new Date().toISOString(),
      revoked: rows.map((row) => ({
        passId: row.id,
        revokedAt: (row.revokedAt as Date).toISOString(),
      })),
    };
  }

  async signingKeys(context: TenantContext) {
    return this.db.withTenant(context, async (tx) => {
      await this.keys.currentKey(tx, context.estateId);
      return this.keys.publicKeys(tx, context.estateId);
    });
  }

  // ---- Walk-ins ------------------------------------------------------------------------------

  /** Guard asks the household to let someone in (visitor.md §7.5). Never auto-allowed. */
  async createWalkin(access: EstateAccess, input: z.infer<typeof createWalkinSchema>) {
    const settings = await this.tenancy.getSettings(access);
    const view = await this.db.withTenant(access, async (tx) => {
      const gate = await this.gates.activeGate(tx, access.estateId, input.gateId);
      const unit = await this.property.unit(tx, access.estateId, input.spaceId);
      if (!unit) throw new NotFoundError('Unit not found', 'SPACE_NOT_FOUND');
      const household = await this.occupancy.activeHouseholdAt(tx, access.estateId, unit.id);
      if (!household) throw new DomainError('NO_HOUSEHOLD', 'Nobody lives in this unit', 422);
      const row = await tx.walkinRequest.create({
        data: {
          estateId: access.estateId,
          gateId: gate.id,
          spaceId: unit.id,
          householdId: household.id,
          visitorName: input.visitorName,
          visitorPhone: input.visitorPhone ?? null,
          purpose: input.purpose ?? null,
          vehiclePlate: input.vehiclePlate ? normalisePlate(input.vehiclePlate) : null,
          expiresAt: new Date(Date.now() + settings['visitor.walkin_timeout_seconds'] * 1000),
          guardUserId: access.userId,
        },
      });
      const recipients = await this.occupancy.householdUserIds(
        tx,
        access.estateId,
        household.id,
        'receiveGateAlerts',
      );
      if (recipients.length > 0) {
        await this.notifications.request(tx, {
          intent: 'visitor.walkin_request',
          userIds: recipients,
          estateId: access.estateId,
          data: { name: input.visitorName, gate: gate.name, unitCode: unit.code, walkinId: row.id },
          dedupeKey: `walkin:${row.id}`,
        });
      }
      await appendOutboxEvents(tx, [
        {
          type: 'visitor.walkin.requested',
          estateId: access.estateId,
          aggregateType: 'walkin_request',
          aggregateId: row.id,
          payload: { walkinId: row.id, householdId: household.id, gateId: gate.id },
        },
      ]);
      return this.walkinView(tx, row);
    });
    if (this.realtime) {
      const data = { walkinId: view.id, gateId: view.gateId, status: view.status };
      await this.realtime.publishMany([
        { room: `estate:${access.estateId}:security`, event: 'gate:update', data },
        { room: `estate:${access.estateId}:gate:${view.gateId}`, event: 'gate:update', data },
      ]);
    }
    return view;
  }

  /** Paginated walk-in list for live gate view and security oversight. */
  async walkins(access: EstateAccess, query: z.infer<typeof walkinListQuerySchema>) {
    const after = query.cursor
      ? decodeCursor(
          query.cursor,
          (value): value is z.infer<typeof walkinCursorSchema> =>
            walkinCursorSchema.safeParse(value).success,
        )
      : undefined;
    return this.db.withTenant(access, async (tx) => {
      const now = new Date();
      // Expire overdue pending walk-ins so the live view stays accurate.
      await tx.walkinRequest.updateMany({
        where: { estateId: access.estateId, status: 'pending', expiresAt: { lte: now } },
        data: { status: 'timed_out' },
      });
      const rows = await tx.walkinRequest.findMany({
        where: {
          estateId: access.estateId,
          ...(query.status ? { status: query.status } : {}),
          ...(query.gateId ? { gateId: query.gateId } : {}),
          ...(after
            ? {
                OR: [
                  { createdAt: { lt: new Date(after.createdAt) } },
                  { createdAt: new Date(after.createdAt), id: { lt: after.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      });
      const page = rows.slice(0, query.limit);
      const units = await this.property.spacesByIds(tx, access.estateId, [
        ...new Set(page.map((row) => row.spaceId)),
      ]);
      const unitById = new Map(units.map((unit) => [unit.id, unit.code]));
      const last = page.at(-1);
      return {
        items: page.map((row) => ({
          id: row.id,
          gateId: row.gateId,
          spaceId: row.spaceId,
          unitCode: unitById.get(row.spaceId) ?? null,
          visitorName: row.visitorName,
          purpose: row.purpose,
          vehiclePlate: row.vehiclePlate,
          status: row.status as 'pending',
          expiresAt: row.expiresAt.toISOString(),
          respondedAt: row.respondedAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
        })),
        nextCursor:
          rows.length > query.limit && last
            ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
            : null,
      };
    });
  }

  /** Guard polls; host views. Expired pending requests read as timed_out (and are marked so). */
  async walkin(access: EstateAccess, walkinId: string) {
    return this.db.withTenant(access, async (tx) => {
      const row = await this.loadWalkin(tx, access, walkinId);
      return this.walkinView(tx, row);
    });
  }

  async respondWalkin(access: EstateAccess, walkinId: string, decision: 'approved' | 'rejected') {
    return this.db.withTenant(access, async (tx) => {
      const row = await this.loadWalkin(tx, access, walkinId);
      const permissions = await this.occupancy.memberPermissions(
        tx,
        access.estateId,
        row.householdId,
        access.userId,
      );
      if (!permissions?.inviteVisitors)
        throw new NotFoundError('Request not found', 'WALKIN_NOT_FOUND');
      const updated = await tx.walkinRequest.updateMany({
        where: { id: row.id, status: 'pending', expiresAt: { gt: new Date() } },
        data: { status: decision, respondedBy: access.userId, respondedAt: new Date() },
      });
      if (updated.count === 0) {
        throw new ConflictError('WALKIN_CLOSED', 'This request was already answered or timed out');
      }
      await appendOutboxEvents(tx, [
        {
          type: `visitor.walkin.${decision}`,
          estateId: access.estateId,
          aggregateType: 'walkin_request',
          aggregateId: row.id,
          payload: { walkinId: row.id, decision },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: `visitor.walkin.${decision === 'approved' ? 'approve' : 'reject'}`,
            resourceType: 'walkin_request',
            resourceId: row.id,
          },
        },
      ]);
      return this.walkinView(
        tx,
        await tx.walkinRequest.findUniqueOrThrow({ where: { id: row.id } }),
      );
    });
  }

  // ---- Restricted visitors -------------------------------------------------------------------

  async restricted(context: TenantContext) {
    const rows = await this.db.withTenant(context, (tx) =>
      this.activeRestricted(tx, context.estateId),
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      phone: row.phone,
      plate: row.plateNormalised,
      reason: row.reason,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async addRestricted(access: EstateAccess, input: z.infer<typeof createRestrictedVisitorSchema>) {
    return this.db.withTenant(access, async (tx) => {
      const row = await tx.restrictedVisitor.create({
        data: {
          estateId: access.estateId,
          name: input.name ?? null,
          phone: input.phone ?? null,
          plateNormalised: input.plate ? normalisePlate(input.plate) : null,
          reason: input.reason,
          addedBy: access.userId,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'visitor.restricted.added',
          estateId: access.estateId,
          aggregateType: 'restricted_visitor',
          aggregateId: row.id,
          payload: { restrictedId: row.id },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'visitor.restricted.add',
            resourceType: 'restricted_visitor',
            resourceId: row.id,
            reason: input.reason,
          },
        },
      ]);
      return {
        id: row.id,
        name: row.name,
        phone: row.phone,
        plate: row.plateNormalised,
        reason: row.reason,
        expiresAt: row.expiresAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  async updateRestricted(
    access: EstateAccess,
    id: string,
    input: z.infer<typeof updateRestrictedVisitorSchema>,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const existing = await tx.restrictedVisitor.findFirst({
        where: { id, estateId: access.estateId, removedAt: null },
      });
      if (!existing) throw new NotFoundError('Entry not found', 'RESTRICTED_NOT_FOUND');
      const row = await tx.restrictedVisitor.update({
        where: { id: existing.id },
        data: {
          ...(input.reason !== undefined ? { reason: input.reason } : {}),
          ...(input.expiresAt !== undefined
            ? { expiresAt: input.expiresAt ? new Date(input.expiresAt) : null }
            : {}),
        },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'visitor.restricted.updated',
          estateId: access.estateId,
          aggregateType: 'restricted_visitor',
          aggregateId: row.id,
          payload: { restrictedId: row.id },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'visitor.restricted.update',
            resourceType: 'restricted_visitor',
            resourceId: row.id,
            reason: input.reason ?? row.reason,
          },
        },
      ]);
      return {
        id: row.id,
        name: row.name,
        phone: row.phone,
        plate: row.plateNormalised,
        reason: row.reason,
        expiresAt: row.expiresAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  async removeRestricted(access: EstateAccess, id: string) {
    await this.db.withTenant(access, async (tx) => {
      const updated = await tx.restrictedVisitor.updateMany({
        where: { id, estateId: access.estateId, removedAt: null },
        data: { removedAt: new Date() },
      });
      if (updated.count === 0) throw new NotFoundError('Entry not found', 'RESTRICTED_NOT_FOUND');
      await appendOutboxEvents(tx, [
        {
          type: 'visitor.restricted.removed',
          estateId: access.estateId,
          aggregateType: 'restricted_visitor',
          aggregateId: id,
          payload: { restrictedId: id },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'visitor.restricted.remove',
            resourceType: 'restricted_visitor',
            resourceId: id,
          },
        },
      ]);
    });
  }

  // ---- Internals -----------------------------------------------------------------------------

  private async insertEvent(
    tx: Tx,
    access: EstateAccess,
    input: z.infer<typeof gateEventInputSchema>,
    flags: { offline: boolean; skewed: boolean; offlineSignin?: boolean },
  ) {
    const existing = await tx.gateEvent.findUnique({
      where: { estateId_clientUuid: { estateId: access.estateId, clientUuid: input.clientUuid } },
    });
    if (existing) return toEvent(existing, false);

    const gate = await this.gates.activeGate(tx, access.estateId, input.gateId);
    if ((input.decision === 'override' || input.decision === 'deny') && !input.reason) {
      throw new DomainError(
        'GATE_REASON_REQUIRED',
        'Give a reason for a denial or an override',
        422,
      );
    }
    const pass = input.passId
      ? await tx.visitorPass.findFirst({
          where: { id: input.passId, estateId: access.estateId },
          include: { invitation: true },
        })
      : null;
    if (input.passId && !pass) throw new NotFoundError('Pass not found', 'PASS_NOT_FOUND');
    const walkin = input.walkinId
      ? await tx.walkinRequest.findFirst({
          where: { id: input.walkinId, estateId: access.estateId },
        })
      : null;
    if (input.walkinId && !walkin) throw new NotFoundError('Request not found', 'WALKIN_NOT_FOUND');
    if (
      walkin &&
      input.direction === 'in' &&
      input.decision === 'allow' &&
      walkin.status !== 'approved'
    ) {
      throw new DomainError(
        'WALKIN_NOT_APPROVED',
        'The household has not approved this visitor',
        422,
      );
    }

    const row = await tx.gateEvent.create({
      data: {
        estateId: access.estateId,
        gateId: gate.id,
        passId: pass?.id ?? null,
        walkinId: walkin?.id ?? null,
        direction: input.direction,
        visitorName: input.visitorName ?? pass?.visitorName ?? walkin?.visitorName ?? null,
        vehiclePlate: input.vehiclePlate
          ? normalisePlate(input.vehiclePlate)
          : (pass?.vehiclePlate ?? walkin?.vehiclePlate ?? null),
        decision: input.decision,
        decisionReason: input.reason ?? null,
        guardUserId: access.userId,
        deviceId: input.deviceId ?? null,
        clientUuid: input.clientUuid,
        occurredAt: new Date(input.occurredAt),
        clockSkewed: flags.skewed,
        offline: flags.offline,
        offlineSignin: flags.offlineSignin ?? false,
      },
    });

    const admitted = input.direction === 'in' && input.decision !== 'deny';
    if (admitted && pass) {
      // Server-authoritative use count; never above max_uses (offline duplicates of one visit included).
      await tx.$executeRaw`
        update tenant.visitor_passes
           set uses_count = uses_count + 1, updated_at = now()
         where id = ${pass.id}::uuid and estate_id = ${access.estateId}::uuid
           and (max_uses is null or uses_count < max_uses)`;
    }
    const type =
      input.decision === 'override'
        ? 'visitor.gate.override'
        : input.decision === 'deny'
          ? 'visitor.gate.denied'
          : input.direction === 'in'
            ? 'visitor.gate.entered'
            : 'visitor.gate.exited';
    await appendOutboxEvents(tx, [
      {
        type,
        estateId: access.estateId,
        aggregateType: 'gate_event',
        aggregateId: row.id,
        payload: {
          gateEventId: row.id,
          gateId: gate.id,
          passId: row.passId,
          walkinId: row.walkinId,
          offline: flags.offline,
        },
        // Overrides are flagged to supervisors and always audited (visitor.md §7.6).
        ...(input.decision === 'override'
          ? {
              audit: {
                actorType: 'user' as const,
                actorId: access.userId,
                action: 'visitor.gate.override',
                resourceType: 'gate_event',
                resourceId: row.id,
                reason: input.reason ?? null,
                deviceId: input.deviceId ?? null,
              },
            }
          : {}),
      },
    ]);
    const householdId = pass?.invitation.hostHouseholdId ?? walkin?.householdId ?? null;
    if (admitted && householdId && !flags.offline) {
      const recipients = await this.occupancy.householdUserIds(
        tx,
        access.estateId,
        householdId,
        'receiveGateAlerts',
      );
      if (recipients.length > 0) {
        await this.notifications.request(tx, {
          intent: 'visitor.arrived',
          userIds: recipients,
          estateId: access.estateId,
          data: { name: row.visitorName ?? '', gate: gate.name },
          dedupeKey: `gate:${row.id}:arrived`,
        });
      }
    }
    return toEvent(row, true);
  }

  private async isRestricted(
    tx: Tx,
    estateId: string,
    phone: string | null,
    plate: string | null,
    name: string | null,
  ): Promise<boolean> {
    const list = await this.activeRestricted(tx, estateId);
    const lowerName = name?.trim().toLowerCase();
    return list.some(
      (item) =>
        (phone && item.phone === phone) ||
        (plate && item.plateNormalised === normalisePlate(plate)) ||
        (lowerName && item.name?.trim().toLowerCase() === lowerName),
    );
  }

  private activeRestricted(tx: Tx, estateId: string) {
    const now = new Date();
    return tx.restrictedVisitor.findMany({
      where: { estateId, removedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      orderBy: { createdAt: 'desc' },
      take: 2000,
    });
  }

  /** Guards (gate.verify) and the target household's members may see a walk-in request. */
  private async loadWalkin(tx: Tx, access: EstateAccess, walkinId: string): Promise<WalkinRow> {
    const row = await tx.walkinRequest.findFirst({
      where: { id: walkinId, estateId: access.estateId },
    });
    if (!row) throw new NotFoundError('Request not found', 'WALKIN_NOT_FOUND');
    const guard = access.permissions.has('gate.verify') || isStaffWith(access, 'visitor.log.read');
    if (!guard) {
      const permissions = await this.occupancy.memberPermissions(
        tx,
        access.estateId,
        row.householdId,
        access.userId,
      );
      if (!permissions) throw new NotFoundError('Request not found', 'WALKIN_NOT_FOUND');
    }
    if (row.status === 'pending' && row.expiresAt <= new Date()) {
      await tx.walkinRequest.updateMany({
        where: { id: row.id, status: 'pending' },
        data: { status: 'timed_out' },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'visitor.walkin.timed_out',
          estateId: access.estateId,
          aggregateType: 'walkin_request',
          aggregateId: row.id,
          payload: { walkinId: row.id },
        },
      ]);
      return { ...row, status: 'timed_out' };
    }
    return row;
  }

  private async walkinView(tx: Tx, row: WalkinRow) {
    const [unit] = await this.property.spacesByIds(tx, row.estateId, [row.spaceId]);
    return {
      id: row.id,
      gateId: row.gateId,
      spaceId: row.spaceId,
      unitCode: unit?.code ?? null,
      visitorName: row.visitorName,
      purpose: row.purpose,
      vehiclePlate: row.vehiclePlate,
      status: row.status as 'pending',
      expiresAt: row.expiresAt.toISOString(),
      respondedAt: row.respondedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
