import { Injectable } from '@nestjs/common';
import type { createDeliverySchema, deliveryListQuerySchema } from '@safezone/schemas';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import type { EstateAccess } from '../../common/auth/auth.decorators';
import { DatabaseService } from '../../common/database/database.service';
import type { Tx } from '../../common/database/tenant-context';
import { ConflictError, DomainError, NotFoundError } from '../../common/errors/domain-error';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { NotificationsService } from '../notifications/notifications.service';
import { isStaffWith, OccupancyService } from '../occupancy/occupancy.service';
import { normalisePlate } from '../occupancy/domain/occupancy';
import { PropertyService } from '../property/property.service';
import { GatesService } from '../security/gates.service';
import { decideEntry } from './domain/validity';
import { GateService } from './gate.service';
import { passFacts, PassesService } from './passes.service';

type DeliveryRow = Prisma.GateDeliveryGetPayload<object>;

const cursorSchema = z.object({ createdAt: z.iso.datetime(), id: z.uuid() });
/** Events shown to the gate start this long before and end this long after their window. */
const EVENT_WINDOW_MS = 12 * 60 * 60_000;

/**
 * Arrivals that are neither a scanned pass nor a walk-in (security-mobile.md §7.4): parcels dropped at the
 * gate, and event guests checked off a guest list.
 */
@Injectable()
export class ArrivalsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly gates: GatesService,
    private readonly property: PropertyService,
    private readonly occupancy: OccupancyService,
    private readonly notifications: NotificationsService,
    private readonly gate: GateService,
    private readonly passes: PassesService,
  ) {}

  // ---- Deliveries ----------------------------------------------------------------------------

  /** A courier leaves a parcel at the gate; the household is told it is waiting there. */
  async createDelivery(access: EstateAccess, input: z.infer<typeof createDeliverySchema>) {
    return this.db.withTenant(access, async (tx) => {
      const gate = await this.gates.activeGate(tx, access.estateId, input.gateId);
      const unit = await this.property.unit(tx, access.estateId, input.spaceId);
      if (!unit) throw new NotFoundError('Unit not found', 'SPACE_NOT_FOUND');
      const household = await this.occupancy.activeHouseholdAt(tx, access.estateId, unit.id);
      if (!household) throw new DomainError('NO_HOUSEHOLD', 'Nobody lives in this unit', 422);
      const row = await tx.gateDelivery.create({
        data: {
          estateId: access.estateId,
          gateId: gate.id,
          spaceId: unit.id,
          householdId: household.id,
          company: input.company,
          riderName: input.riderName ?? null,
          vehiclePlate: input.vehiclePlate ? normalisePlate(input.vehiclePlate) : null,
          note: input.note ?? null,
          recordedBy: access.userId,
        },
      });
      const recipients = await this.occupancy.householdUserIds(
        tx,
        access.estateId,
        household.id,
        'receiveGateAlerts',
      );
      if (recipients.length > 0)
        await this.notifications.request(tx, {
          intent: 'visitor.delivery_at_gate',
          userIds: recipients,
          estateId: access.estateId,
          data: { company: input.company, gate: gate.name, deliveryId: row.id },
          dedupeKey: `delivery:${row.id}`,
        });
      await this.deliveryEvent(
        tx,
        access,
        row,
        'visitor.delivery.recorded',
        'visitor.delivery.record',
      );
      return this.deliveryView(
        row,
        new Map([[gate.id, gate.name]]),
        new Map([[unit.id, unit.code]]),
      );
    });
  }

  /** Guards see every parcel; residents see their households' parcels only. */
  async deliveries(access: EstateAccess, query: z.infer<typeof deliveryListQuerySchema>) {
    const after = query.cursor
      ? decodeCursor(
          query.cursor,
          (value): value is z.infer<typeof cursorSchema> => cursorSchema.safeParse(value).success,
        )
      : undefined;
    const staff = isStaffWith(access, 'gate.verify');
    const households = staff
      ? null
      : (await this.occupancy.householdsOf(access.estateId, access.userId)).map(
          (h) => h.householdId,
        );
    return this.db.withTenant(access, async (tx) => {
      const rows = await tx.gateDelivery.findMany({
        where: {
          estateId: access.estateId,
          ...(households ? { householdId: { in: households } } : {}),
          ...(query.status ? { status: query.status } : {}),
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
      const { gates, units } = await this.names(tx, access.estateId, page);
      const last = page.at(-1);
      return {
        items: page.map((row) => this.deliveryView(row, gates, units)),
        nextCursor:
          rows.length > query.limit && last
            ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
            : null,
      };
    });
  }

  async closeDelivery(
    access: EstateAccess,
    deliveryId: string,
    outcome: 'collected' | 'returned',
    note: string,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const row = await tx.gateDelivery.findFirst({
        where: { id: deliveryId, estateId: access.estateId },
      });
      if (!row) throw new NotFoundError('Delivery not found', 'DELIVERY_NOT_FOUND');
      const updated = await tx.gateDelivery.updateMany({
        where: { id: row.id, estateId: access.estateId, status: 'at_gate' },
        data: { status: outcome, closedAt: new Date(), closedBy: access.userId, closedNote: note },
      });
      if (updated.count !== 1)
        throw new ConflictError('DELIVERY_CLOSED', 'This parcel is no longer at the gate');
      const closed = await tx.gateDelivery.findFirstOrThrow({ where: { id: row.id } });
      await this.deliveryEvent(
        tx,
        access,
        closed,
        `visitor.delivery.${outcome}`,
        `visitor.delivery.${outcome === 'collected' ? 'collect' : 'return'}`,
      );
      const { gates, units } = await this.names(tx, access.estateId, [closed]);
      return this.deliveryView(closed, gates, units);
    });
  }

  // ---- Event guest lists ---------------------------------------------------------------------

  /** Event passes that matter at this gate now (from 12 hours before to 12 hours after). */
  async gateEvents(access: EstateAccess, gateId: string) {
    const now = Date.now();
    return this.db.withTenant(access, async (tx) => {
      await this.gates.activeGate(tx, access.estateId, gateId);
      const passes = await tx.visitorPass.findMany({
        where: {
          estateId: access.estateId,
          revokedAt: null,
          invitation: { type: 'event' },
          validFrom: { lte: new Date(now + EVENT_WINDOW_MS) },
          validTo: { gte: new Date(now - EVENT_WINDOW_MS) },
          OR: [{ gateIds: { isEmpty: true } }, { gateIds: { has: gateId } }],
        },
        include: { invitation: true },
        orderBy: { validFrom: 'asc' },
      });
      return this.withGuests(tx, access.estateId, passes);
    });
  }

  /** The host's view of their event guest list. */
  async passGuests(access: EstateAccess, passId: string) {
    await this.passes.get(access, passId);
    return this.db.withTenant(access, async (tx) =>
      (
        await tx.eventGuest.findMany({
          where: { estateId: access.estateId, passId },
          orderBy: { name: 'asc' },
        })
      ).map((guest) => this.guestView(guest)),
    );
  }

  /**
   * A guard checks a guest off: the event pass must be valid at this gate now (same rules as a scan), the
   * guest is marked once, and an entry is recorded against the pass.
   */
  async checkIn(access: EstateAccess, guestId: string, gateId: string, clientUuid: string) {
    const checked = await this.db.withTenant(access, async (tx) => {
      const guest = await tx.eventGuest.findFirst({
        where: { id: guestId, estateId: access.estateId },
      });
      if (!guest) throw new NotFoundError('Guest not found', 'GUEST_NOT_FOUND');
      if (guest.checkedInAt)
        throw new ConflictError('GUEST_ALREADY_IN', 'This guest has already been checked in');
      const pass = await tx.visitorPass.findFirst({
        where: { id: guest.passId, estateId: access.estateId },
        include: { invitation: true },
      });
      if (!pass) throw new NotFoundError('Pass not found', 'PASS_NOT_FOUND');
      const decision = decideEntry(passFacts(pass), {
        now: new Date(),
        gateId,
        restricted: false,
      });
      if (decision.decision === 'deny')
        throw new DomainError(
          'EVENT_PASS_NOT_VALID',
          'The event pass is not valid at this gate now',
          422,
          [{ path: 'reason', message: decision.reasons.join(',') }],
        );
      const marked = await tx.eventGuest.updateMany({
        where: { id: guest.id, checkedInAt: null },
        data: { checkedInAt: new Date(), checkedInBy: access.userId, gateId },
      });
      if (marked.count !== 1)
        throw new ConflictError('GUEST_ALREADY_IN', 'This guest has already been checked in');
      return { guest, pass, decision };
    });
    await this.gate.recordEvent(access, {
      clientUuid,
      gateId,
      direction: 'in',
      passId: checked.pass.id,
      visitorName: checked.guest.name,
      decision: checked.decision.decision,
      ...(checked.decision.decision === 'check'
        ? { reason: `Event guest: ${checked.decision.reasons.join(', ')}` }
        : {}),
      occurredAt: new Date().toISOString(),
    });
    return this.db.withTenant(access, async (tx) => {
      const guest = await tx.eventGuest.findFirstOrThrow({ where: { id: guestId } });
      return this.guestView(guest);
    });
  }

  // ---- helpers -------------------------------------------------------------------------------

  private async withGuests(
    tx: Tx,
    estateId: string,
    passes: Prisma.VisitorPassGetPayload<{ include: { invitation: true } }>[],
  ) {
    if (passes.length === 0) return [];
    const guests = await tx.eventGuest.findMany({
      where: { estateId, passId: { in: passes.map((pass) => pass.id) } },
      orderBy: { name: 'asc' },
    });
    const units = await this.property.spacesByIds(
      tx,
      estateId,
      passes.map((pass) => pass.invitation.spaceId).filter((id): id is string => !!id),
    );
    const unitCode = new Map(units.map((unit) => [unit.id, unit.code]));
    return passes.map((pass) => ({
      passId: pass.id,
      eventName: pass.visitorName,
      unitCode: pass.invitation.spaceId ? (unitCode.get(pass.invitation.spaceId) ?? null) : null,
      validFrom: pass.validFrom.toISOString(),
      validTo: pass.validTo.toISOString(),
      guests: guests.filter((guest) => guest.passId === pass.id).map((g) => this.guestView(g)),
    }));
  }

  private guestView(guest: Prisma.EventGuestGetPayload<object>) {
    return {
      id: guest.id,
      name: guest.name,
      checkedInAt: guest.checkedInAt?.toISOString() ?? null,
    };
  }

  private async names(tx: Tx, estateId: string, rows: readonly DeliveryRow[]) {
    const gateIds = [...new Set(rows.map((row) => row.gateId))];
    const [gates, units] = await Promise.all([
      gateIds.length > 0
        ? tx.gate.findMany({
            where: { estateId, id: { in: gateIds } },
            select: { id: true, name: true },
          })
        : [],
      this.property.spacesByIds(
        tx,
        estateId,
        rows.map((row) => row.spaceId),
      ),
    ]);
    return {
      gates: new Map(gates.map((gate) => [gate.id, gate.name])),
      units: new Map(units.map((unit) => [unit.id, unit.code])),
    };
  }

  private deliveryView(row: DeliveryRow, gates: Map<string, string>, units: Map<string, string>) {
    return {
      id: row.id,
      gateId: row.gateId,
      gateName: gates.get(row.gateId) ?? null,
      spaceId: row.spaceId,
      unitCode: units.get(row.spaceId) ?? null,
      company: row.company,
      riderName: row.riderName,
      vehiclePlate: row.vehiclePlate,
      note: row.note,
      status: row.status as 'at_gate',
      createdAt: row.createdAt.toISOString(),
      closedAt: row.closedAt?.toISOString() ?? null,
      closedNote: row.closedNote,
    };
  }

  private async deliveryEvent(
    tx: Tx,
    access: EstateAccess,
    row: DeliveryRow,
    type: string,
    action: string,
  ) {
    await appendOutboxEvents(tx, [
      {
        type,
        estateId: access.estateId,
        aggregateType: 'gate_delivery',
        aggregateId: row.id,
        payload: { deliveryId: row.id, householdId: row.householdId, status: row.status },
        audit: {
          actorType: 'user',
          actorId: access.userId,
          action,
          resourceType: 'gate_delivery',
          resourceId: row.id,
          after: { status: row.status },
        },
      },
    ]);
  }
}
