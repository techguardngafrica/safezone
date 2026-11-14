import { Injectable } from '@nestjs/common';
import {
  type createBlackoutSchema,
  type createBookingSchema,
  type createDamageReportSchema,
  type createFacilitySchema,
  type facilitiesReportQuerySchema,
  type FacilityPolicy,
  facilityPolicySchema,
  type FacilityPricing,
  facilityPricingSchema,
  type bookingListQuerySchema,
  openingHoursSchema,
  type updateFacilitySchema,
} from '@safezone/schemas';
import type { z } from 'zod';
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
import { addDays, sum, todayInLagos, toKobo } from '../billing/domain/billing';
import { InvoicesService } from '../billing/invoices.service';
import { NotificationsService } from '../notifications/notifications.service';
import { isStaffWith, OccupancyService } from '../occupancy/occupancy.service';
import { PropertyService } from '../property/property.service';
import { TenancyService } from '../tenancy/tenancy.service';
import {
  bookingPrice,
  cancellationRefund,
  checkPolicy,
  HOLD_MINUTES,
  type OpeningSlot,
  openWindows,
  type PolicyViolation,
  usageWindows,
  watInstant,
} from './domain/facilities';

type FacilityRow = Prisma.FacilityGetPayload<object>;
type BookingRow = Prisma.BookingGetPayload<object>;
const LIVE = ['pending_approval', 'pending_payment', 'confirmed'];

const VIOLATION_MESSAGES: Record<PolicyViolation, string> = {
  too_short: 'This booking is shorter than the facility allows',
  too_long: 'This booking is longer than the facility allows',
  too_far_ahead: 'You cannot book this far ahead',
  in_past: 'Choose a time in the future',
  outside_hours: 'The facility is closed at that time',
  too_many_guests: 'Too many guests for this facility',
  weekly_limit: 'Your household has reached this week’s booking limit',
  monthly_limit: 'Your household has reached this month’s booking limit',
};

function isOverlap(error: unknown): boolean {
  const text = `${(error as { message?: unknown }).message ?? ''} ${JSON.stringify((error as { meta?: unknown }).meta ?? '')}`;
  return /exclusion_violation|23P01|overlaps another booking/.test(text);
}

/**
 * Facilities and bookings (facilities.md). Overlaps are refused by the database (facility row lock plus
 * range check); paid bookings get a billing invoice and a 30-minute hold, confirmed when it is paid.
 */
@Injectable()
export class FacilitiesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly invoices: InvoicesService,
    private readonly occupancy: OccupancyService,
    private readonly property: PropertyService,
    private readonly tenancy: TenancyService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---- Facilities ----------------------------------------------------------------------------

  async create(access: EstateAccess, input: z.infer<typeof createFacilitySchema>) {
    return this.db.withTenant(access, async (tx) => {
      const row = await tx.facility.create({
        data: {
          estateId: access.estateId,
          spaceId: input.spaceId ?? null,
          name: input.name,
          type: input.type,
          capacity: input.capacity ?? null,
          description: input.description ?? null,
          rules: input.rules ?? null,
          photoFileIds: input.photoFileIds,
          openingHours: input.openingHours,
          policy: input.policy,
          pricing: input.pricing,
          createdBy: access.userId,
        },
      });
      await this.audit(
        tx,
        access,
        row.id,
        'facilities.facility.created',
        'facilities.facility.create',
        { name: input.name },
      );
      return this.facilityView(row);
    });
  }

  async list(access: EstateAccess) {
    const staff = isStaffWith(access, 'facility.manage');
    return this.db.withTenant(access, async (tx) =>
      (
        await tx.facility.findMany({
          where: { estateId: access.estateId, ...(staff ? {} : { status: 'active' }) },
          orderBy: { name: 'asc' },
        })
      ).map((row) => this.facilityView(row)),
    );
  }

  async get(access: EstateAccess, id: string) {
    return this.db.withTenant(access, async (tx) =>
      this.facilityView(await this.loadFacility(tx, access.estateId, id)),
    );
  }

  async update(access: EstateAccess, id: string, input: z.infer<typeof updateFacilitySchema>) {
    return this.db.withTenant(access, async (tx) => {
      const row = await this.loadFacility(tx, access.estateId, id);
      const updated = await tx.facility.update({
        where: { id: row.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.rules !== undefined ? { rules: input.rules } : {}),
          ...(input.status ? { status: input.status } : {}),
          ...(input.openingHours ? { openingHours: input.openingHours } : {}),
          ...(input.policy ? { policy: input.policy } : {}),
          ...(input.pricing ? { pricing: input.pricing } : {}),
          version: { increment: 1 },
        },
      });
      await this.audit(
        tx,
        access,
        row.id,
        'facilities.facility.updated',
        'facilities.facility.update',
        input as Prisma.InputJsonValue,
      );
      return this.facilityView(updated);
    });
  }

  /** Maintenance blackout (rule 6): live bookings in the window are cancelled with a full refund and told. */
  async addBlackout(
    access: EstateAccess,
    facilityId: string,
    input: z.infer<typeof createBlackoutSchema>,
  ) {
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    const result = await this.db.withTenant(access, async (tx) => {
      const facility = await this.loadFacility(tx, access.estateId, facilityId);
      const blackout = await tx.facilityBlackout.create({
        data: {
          estateId: access.estateId,
          facilityId,
          startsAt,
          endsAt,
          reason: input.reason,
          createdBy: access.userId,
        },
      });
      const affected = await tx.booking.findMany({
        where: {
          facilityId,
          status: { in: LIVE },
          startsAt: { lt: endsAt },
          blockedUntil: { gt: startsAt },
        },
      });
      for (const booking of affected) {
        await this.cancelInside(
          tx,
          access,
          facility,
          booking,
          `Facility unavailable: ${input.reason}`,
          true,
        );
      }
      return { blackout, affected: affected.length };
    });
    return {
      id: result.blackout.id,
      startsAt: result.blackout.startsAt.toISOString(),
      endsAt: result.blackout.endsAt.toISOString(),
      reason: result.blackout.reason,
      affectedBookings: result.affected,
    };
  }

  async availability(access: EstateAccess, facilityId: string, date: string) {
    return this.db.withTenant(access, async (tx) => {
      const facility = await this.loadFacility(tx, access.estateId, facilityId);
      const from = watInstant(date, '00:00');
      const to = watInstant(addDays(date, 1), '00:00');
      const [bookings, blackouts] = await Promise.all([
        tx.booking.findMany({
          where: {
            facilityId,
            status: { in: LIVE },
            startsAt: { lt: to },
            blockedUntil: { gt: from },
          },
          select: { startsAt: true, blockedUntil: true },
          orderBy: { startsAt: 'asc' },
        }),
        tx.facilityBlackout.findMany({
          where: { facilityId, startsAt: { lt: to }, endsAt: { gt: from } },
          select: { startsAt: true, endsAt: true },
        }),
      ]);
      return {
        date,
        open: openWindows(this.hours(facility), date).map((w) => ({
          from: w.from.toISOString(),
          to: w.to.toISOString(),
        })),
        busy: [
          ...bookings.map((b) => ({
            from: b.startsAt.toISOString(),
            to: b.blockedUntil.toISOString(),
            kind: 'booking' as const,
          })),
          ...blackouts.map((b) => ({
            from: b.startsAt.toISOString(),
            to: b.endsAt.toISOString(),
            kind: 'blackout' as const,
          })),
        ].sort((a, b) => a.from.localeCompare(b.from)),
      };
    });
  }

  // ---- Bookings ------------------------------------------------------------------------------

  async book(access: EstateAccess, input: z.infer<typeof createBookingSchema>) {
    const staff = isStaffWith(access, 'facility.manage');
    if (input.overrideReason && !staff)
      throw new ForbiddenError('Only facility managers can book outside the rules');
    const settings = await this.tenancy.getSettings(access);
    const households = await this.occupancy.householdsOf(access.estateId, access.userId);
    const start = new Date(input.startsAt);
    const end = new Date(input.endsAt);
    try {
      const id = await this.db.withTenant(access, async (tx) => {
        const facility = await this.loadFacility(tx, access.estateId, input.facilityId);
        if (facility.status !== 'active')
          throw new ConflictError('FACILITY_CLOSED', 'This facility is closed');
        const policy = this.policy(facility);
        const pricing = this.pricing(facility);
        const owned = await this.property.ownedUnits(tx, access.estateId, access.userId);
        const household = households[0] ?? null;
        const eligible =
          policy.whoCanBook === 'residents'
            ? Boolean(household)
            : policy.whoCanBook === 'owners'
              ? owned.length > 0
              : Boolean(household) || owned.length > 0;
        if (!eligible && !staff)
          throw new ForbiddenError('You are not allowed to book this facility');

        const blackout = await tx.facilityBlackout.count({
          where: { facilityId: facility.id, startsAt: { lt: end }, endsAt: { gt: start } },
        });
        if (blackout > 0)
          throw new ConflictError(
            'FACILITY_UNAVAILABLE',
            'The facility is closed for maintenance then',
          );

        if (!input.overrideReason) {
          const windows = usageWindows(start);
          const scope = household
            ? { householdId: household.householdId }
            : { bookedBy: access.userId };
          const [thisWeek, thisMonth] = await Promise.all([
            tx.booking.count({
              where: {
                facilityId: facility.id,
                ...scope,
                status: { in: [...LIVE, 'completed'] },
                startsAt: { gte: windows.weekStart, lt: windows.weekEnd },
              },
            }),
            tx.booking.count({
              where: {
                facilityId: facility.id,
                ...scope,
                status: { in: [...LIVE, 'completed'] },
                startsAt: { gte: windows.monthStart, lt: windows.monthEnd },
              },
            }),
          ]);
          const violation = checkPolicy(
            policy,
            this.hours(facility),
            { start, end, guests: input.guests },
            { thisWeek, thisMonth },
            new Date(),
          );
          if (violation)
            throw new DomainError(
              `BOOKING_${violation.toUpperCase()}`,
              VIOLATION_MESSAGES[violation],
              422,
            );
        }

        const price = bookingPrice(pricing, start, end);
        if (price > 0 && settings['facilities.block_with_arrears_kobo'] > 0 && household) {
          const owed = await this.invoices.unitOutstanding(tx, access.estateId, household.spaceId);
          if (owed > settings['facilities.block_with_arrears_kobo'])
            throw new DomainError(
              'BOOKING_ARREARS',
              'Settle your outstanding dues to book paid facilities',
              422,
            );
        }
        const status =
          policy.requiresApproval && !input.overrideReason
            ? 'pending_approval'
            : price > 0
              ? 'pending_payment'
              : 'confirmed';
        const row = await tx.booking.create({
          data: {
            estateId: access.estateId,
            facilityId: facility.id,
            bookedBy: access.userId,
            householdId: household?.householdId ?? null,
            spaceId: household?.spaceId ?? null,
            startsAt: start,
            endsAt: end,
            blockedUntil: new Date(end.getTime() + policy.bufferMinutes * 60_000),
            guests: input.guests,
            purpose: input.purpose ?? null,
            status,
            price: BigInt(price),
            overrideReason: input.overrideReason ?? null,
          },
        });
        if (status === 'pending_payment') await this.invoiceFor(tx, access, facility, row);
        await this.bookingEvent(
          tx,
          access,
          row,
          status === 'confirmed' ? 'confirmed' : 'created',
          input.overrideReason ?? null,
        );
        return row.id;
      });
      return this.booking(access, id);
    } catch (error) {
      if (isOverlap(error))
        throw new ConflictError(
          'BOOKING_CONFLICT',
          'Someone has just booked this time. Choose another slot.',
        );
      throw error;
    }
  }

  /** Invoice for a priced booking, payable through normal checkout; the hold lasts 30 minutes. */
  private async invoiceFor(
    tx: Tx,
    access: { estateId: string; userId: string | null },
    facility: FacilityRow,
    booking: BookingRow,
  ) {
    if (!booking.spaceId)
      throw new DomainError(
        'BOOKING_NEEDS_UNIT',
        'Paid bookings need a household unit to bill',
        422,
      );
    const unit = await this.property.unit(tx, access.estateId, booking.spaceId);
    const today = todayInLagos();
    const [invoiceId] = await this.invoices.issue(tx, access.estateId, [
      {
        spaceId: booking.spaceId,
        unitCode: unit?.code ?? booking.spaceId,
        householdId: booking.householdId,
        payerUserId: booking.bookedBy,
        payerType: 'occupant',
        billingRunId: null,
        description: `${facility.name} booking`,
        issueDate: today,
        dueDate: today,
        createdBy: access.userId,
        lines: [
          {
            chargeId: null,
            chargeType: 'facility_booking',
            description: `${facility.name}, ${booking.startsAt.toISOString()}`,
            quantity: 1,
            unitAmount: toKobo(booking.price),
            amount: toKobo(booking.price),
          },
        ],
      },
    ]);
    await tx.booking.update({
      where: { id: booking.id },
      data: {
        invoiceId: invoiceId as string,
        holdExpiresAt: new Date(Date.now() + HOLD_MINUTES * 60_000),
      },
    });
  }

  async bookings(access: EstateAccess, query: z.infer<typeof bookingListQuerySchema>) {
    const staff = isStaffWith(access, 'facility.manage');
    return this.db.withTenant(access, async (tx) => {
      const day = query.date
        ? { gte: watInstant(query.date, '00:00'), lt: watInstant(addDays(query.date, 1), '00:00') }
        : undefined;
      const rows = await tx.booking.findMany({
        where: {
          estateId: access.estateId,
          ...(!staff || query.mine ? { bookedBy: access.userId } : {}),
          ...(query.facilityId ? { facilityId: query.facilityId } : {}),
          ...(query.status ? { status: query.status } : {}),
          ...(day ? { startsAt: day } : {}),
        },
        orderBy: { startsAt: 'asc' },
        take: 500,
      });
      const names = await this.facilityNames(tx, access.estateId, rows);
      return rows.map((row) => this.bookingView(row, names.get(row.facilityId) ?? ''));
    });
  }

  async booking(access: EstateAccess, id: string) {
    return this.db.withTenant(access, async (tx) => {
      const row = await this.loadBooking(tx, access, id);
      const names = await this.facilityNames(tx, access.estateId, [row]);
      return this.bookingView(row, names.get(row.facilityId) ?? '');
    });
  }

  async approve(access: EstateAccess, id: string) {
    await this.db.withTenant(access, async (tx) => {
      const row = await this.loadBooking(tx, access, id);
      if (row.status !== 'pending_approval')
        throw new ConflictError(
          'BOOKING_INVALID_TRANSITION',
          'This booking is not waiting for approval',
        );
      const facility = await this.loadFacility(tx, access.estateId, row.facilityId);
      const priced = toKobo(row.price) > 0;
      const updated = await this.move(tx, row, priced ? 'pending_payment' : 'confirmed', {
        approvedBy: access.userId,
      });
      if (priced) await this.invoiceFor(tx, access, facility, updated);
      await this.bookingEvent(tx, access, updated, priced ? 'approved' : 'confirmed', null);
      await this.notifyBooker(
        tx,
        access.estateId,
        updated,
        facility.name,
        priced ? 'approved, please pay to confirm' : 'confirmed',
      );
    });
    return this.booking(access, id);
  }

  async reject(access: EstateAccess, id: string, reason: string) {
    await this.db.withTenant(access, async (tx) => {
      const row = await this.loadBooking(tx, access, id);
      if (row.status !== 'pending_approval')
        throw new ConflictError(
          'BOOKING_INVALID_TRANSITION',
          'This booking is not waiting for approval',
        );
      const updated = await this.move(tx, row, 'rejected', {
        rejectionReason: reason,
        approvedBy: access.userId,
      });
      await this.bookingEvent(tx, access, updated, 'rejected', reason);
      const facility = await this.loadFacility(tx, access.estateId, row.facilityId);
      await this.notifyBooker(tx, access.estateId, updated, facility.name, 'declined');
    });
    return this.booking(access, id);
  }

  /** The booker or a manager cancels; refunds follow the policy at cancellation time (rule 3). */
  async cancel(access: EstateAccess, id: string, reason: string) {
    await this.db.withTenant(access, async (tx) => {
      const row = await this.loadBooking(tx, access, id);
      if (!LIVE.includes(row.status))
        throw new ConflictError('BOOKING_INVALID_TRANSITION', 'This booking cannot be cancelled');
      const facility = await this.loadFacility(tx, access.estateId, row.facilityId);
      await this.cancelInside(tx, access, facility, row, reason, false);
    });
    return this.booking(access, id);
  }

  private async cancelInside(
    tx: Tx,
    access: { estateId: string; userId: string | null },
    facility: FacilityRow,
    row: BookingRow,
    reason: string,
    fullRefund: boolean,
  ) {
    let refund = 0;
    if (row.invoiceId) {
      const status = await this.invoices.invoiceStatus(tx, access.estateId, row.invoiceId);
      if (status === 'paid') {
        const paid = toKobo(row.price);
        refund = fullRefund
          ? paid
          : cancellationRefund(this.policy(facility), paid, row.startsAt, new Date());
        if (refund > 0)
          await this.invoices.refundToCredit(
            tx,
            access.estateId,
            row.invoiceId,
            refund,
            `Booking cancelled: ${reason}`,
            access.userId,
          );
      } else {
        await this.invoices.cancelBalance(
          tx,
          access.estateId,
          row.invoiceId,
          `Booking cancelled: ${reason}`,
          access.userId,
        );
      }
    }
    const updated = await this.move(tx, row, 'cancelled', {
      cancelledAt: new Date(),
      cancelReason: reason,
      refundAmount: BigInt(refund),
    });
    await this.bookingEvent(tx, access, updated, 'cancelled', reason);
    if (access.userId !== row.bookedBy)
      await this.notifyBooker(tx, access.estateId, updated, facility.name, 'cancelled');
  }

  async checkIn(access: EstateAccess, id: string, noShow: boolean) {
    await this.db.withTenant(access, async (tx) => {
      const row = await this.loadBooking(tx, access, id);
      if (row.status !== 'confirmed')
        throw new ConflictError(
          'BOOKING_INVALID_TRANSITION',
          'Only confirmed bookings can be checked in',
        );
      if (noShow) {
        if (row.startsAt > new Date())
          throw new ConflictError('BOOKING_NOT_STARTED', 'The booking has not started yet');
        const updated = await this.move(tx, row, 'no_show', {});
        await this.bookingEvent(tx, access, updated, 'no_show', null);
      } else {
        await tx.booking.update({ where: { id }, data: { checkedInAt: new Date() } });
      }
    });
    return this.booking(access, id);
  }

  async reportDamage(
    access: EstateAccess,
    bookingId: string,
    input: z.infer<typeof createDamageReportSchema>,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const booking = await this.loadBooking(tx, access, bookingId);
      if (!['confirmed', 'completed', 'no_show'].includes(booking.status))
        throw new ConflictError(
          'BOOKING_INVALID_TRANSITION',
          'Damage can be reported on confirmed or past bookings',
        );
      let invoiceId: string | null = null;
      if (input.chargeAmount) {
        if (!booking.spaceId)
          throw new DomainError('BOOKING_NEEDS_UNIT', 'The booker has no unit to bill', 422);
        const facility = await this.loadFacility(tx, access.estateId, booking.facilityId);
        const unit = await this.property.unit(tx, access.estateId, booking.spaceId);
        const today = todayInLagos();
        [invoiceId] = (await this.invoices.issue(tx, access.estateId, [
          {
            spaceId: booking.spaceId,
            unitCode: unit?.code ?? booking.spaceId,
            householdId: booking.householdId,
            payerUserId: booking.bookedBy,
            payerType: 'occupant',
            billingRunId: null,
            description: `${facility.name}: damage charge`,
            issueDate: today,
            dueDate: addDays(today, 14),
            createdBy: access.userId,
            lines: [
              {
                chargeId: null,
                chargeType: 'facility_damage',
                description: input.description.slice(0, 200),
                quantity: 1,
                unitAmount: input.chargeAmount,
                amount: input.chargeAmount,
              },
            ],
          },
        ])) as [string];
      }
      const row = await tx.damageReport.create({
        data: {
          estateId: access.estateId,
          facilityId: booking.facilityId,
          bookingId,
          description: input.description,
          photoFileIds: input.photoFileIds,
          chargeAmount: BigInt(input.chargeAmount ?? 0),
          invoiceId,
          reportedBy: access.userId,
        },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'facilities.damage.reported',
          estateId: access.estateId,
          aggregateType: 'booking',
          aggregateId: bookingId,
          payload: { bookingId, damageReportId: row.id, chargeAmount: input.chargeAmount ?? 0 },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'facilities.damage.report',
            resourceType: 'booking',
            resourceId: bookingId,
            after: { chargeAmount: input.chargeAmount ?? 0, invoiceId },
          },
        },
      ]);
      return {
        id: row.id,
        bookingId,
        description: row.description,
        chargeAmount: toKobo(row.chargeAmount),
        invoiceId,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  // ---- Jobs ----------------------------------------------------------------------------------

  /** Payment arrived (billing.invoice.paid): confirm the booking. */
  async invoicePaid(estateId: string, invoiceId: string): Promise<boolean> {
    return this.db.withTenant({ estateId, userId: null }, async (tx) => {
      const row = await tx.booking.findFirst({
        where: { estateId, invoiceId, status: 'pending_payment' },
      });
      if (!row) return false;
      const updated = await this.move(tx, row, 'confirmed', { holdExpiresAt: null });
      await this.bookingEvent(tx, { estateId, userId: null }, updated, 'confirmed', null);
      const facility = await this.loadFacility(tx, estateId, row.facilityId);
      await this.notifyBooker(tx, estateId, updated, facility.name, 'confirmed');
      return true;
    });
  }

  /**
   * Every minute: unpaid holds over 30 minutes are released (rule 2), confirmed bookings that ended are
   * completed, and bookers get a reminder about 24 hours before.
   */
  async sweep(
    estateId: string,
    now: Date = new Date(),
  ): Promise<{ released: number; completed: number; reminded: number }> {
    const system = { estateId, userId: null };
    return this.db.withTenant(system, async (tx) => {
      const expired = await tx.booking.findMany({
        where: { estateId, status: 'pending_payment', holdExpiresAt: { lt: now } },
        take: 500,
      });
      for (const row of expired) {
        const facility = await this.loadFacility(tx, estateId, row.facilityId);
        const status = row.invoiceId
          ? await this.invoices.invoiceStatus(tx, estateId, row.invoiceId)
          : null;
        if (status === 'paid') {
          await this.move(tx, row, 'confirmed', { holdExpiresAt: null });
          continue;
        }
        await this.cancelInside(tx, system, facility, row, 'Payment not received in time', false);
      }
      const ended = await tx.booking.updateMany({
        where: { estateId, status: 'confirmed', endsAt: { lt: now } },
        data: { status: 'completed' },
      });
      const soon = await tx.booking.findMany({
        where: {
          estateId,
          status: 'confirmed',
          remindedAt: null,
          startsAt: { gt: now, lte: new Date(now.getTime() + 24 * 3_600_000) },
        },
        take: 1000,
      });
      for (const row of soon) {
        const facility = await this.loadFacility(tx, estateId, row.facilityId);
        await this.notifications.request(tx, {
          intent: 'facilities.booking_reminder',
          userIds: [row.bookedBy],
          estateId,
          data: {
            facility: facility.name,
            startsAt: row.startsAt.toISOString(),
            bookingId: row.id,
          },
          dedupeKey: `booking:${row.id}:reminder`,
        });
        await tx.booking.update({ where: { id: row.id }, data: { remindedAt: now } });
      }
      return { released: expired.length, completed: ended.count, reminded: soon.length };
    });
  }

  async report(access: EstateAccess, query: z.infer<typeof facilitiesReportQuerySchema>) {
    const from = watInstant(query.from, '00:00');
    const to = watInstant(addDays(query.to, 1), '00:00');
    return this.db.withTenant(access, async (tx) => {
      const facilities = await tx.facility.findMany({
        where: { estateId: access.estateId },
        orderBy: { name: 'asc' },
      });
      const bookings = await tx.booking.findMany({
        where: { estateId: access.estateId, startsAt: { gte: from, lt: to } },
      });
      return {
        facilities: facilities.map((facility) => {
          const mine = bookings.filter((b) => b.facilityId === facility.id);
          const used = mine.filter((b) => b.status === 'confirmed' || b.status === 'completed');
          return {
            facilityId: facility.id,
            name: facility.name,
            bookings: used.length,
            bookedHours:
              Math.round(
                sum(used.map((b) => (b.endsAt.getTime() - b.startsAt.getTime()) / 3_600_000)) * 10,
              ) / 10,
            cancelled: mine.filter((b) => b.status === 'cancelled').length,
            noShows: mine.filter((b) => b.status === 'no_show').length,
            revenue: sum(
              mine.map((b) =>
                b.status === 'confirmed' || b.status === 'completed' || b.status === 'no_show'
                  ? toKobo(b.price) - toKobo(b.refundAmount)
                  : 0,
              ),
            ),
          };
        }),
      };
    });
  }

  // ---- Internals -----------------------------------------------------------------------------

  private async loadFacility(tx: Tx, estateId: string, id: string): Promise<FacilityRow> {
    const row = await tx.facility.findFirst({ where: { id, estateId } });
    if (!row) throw new NotFoundError('Facility not found', 'FACILITY_NOT_FOUND');
    return row;
  }

  private async loadBooking(tx: Tx, access: EstateAccess, id: string): Promise<BookingRow> {
    const staff = isStaffWith(access, 'facility.manage');
    const row = await tx.booking.findFirst({
      where: { id, estateId: access.estateId, ...(staff ? {} : { bookedBy: access.userId }) },
    });
    if (!row) throw new NotFoundError('Booking not found', 'BOOKING_NOT_FOUND');
    return row;
  }

  private async move(
    tx: Tx,
    row: BookingRow,
    status: string,
    data: Prisma.BookingUpdateManyMutationInput,
  ): Promise<BookingRow> {
    const result = await tx.booking.updateMany({
      where: { id: row.id, version: row.version },
      data: { ...data, status, version: { increment: 1 } },
    });
    if (result.count === 0)
      throw new ConflictError('VERSION_MISMATCH', 'This booking was changed by someone else');
    return tx.booking.findFirstOrThrow({ where: { id: row.id } });
  }

  private policy(row: FacilityRow): FacilityPolicy {
    return facilityPolicySchema.parse(row.policy);
  }
  private pricing(row: FacilityRow): FacilityPricing {
    return facilityPricingSchema.parse(row.pricing);
  }
  private hours(row: FacilityRow): OpeningSlot[] {
    return openingHoursSchema.parse(row.openingHours);
  }

  private async facilityNames(tx: Tx, estateId: string, rows: readonly BookingRow[]) {
    return new Map(
      (
        await tx.facility.findMany({
          where: { estateId, id: { in: [...new Set(rows.map((r) => r.facilityId))] } },
          select: { id: true, name: true },
        })
      ).map((f) => [f.id, f.name]),
    );
  }

  private async notifyBooker(
    tx: Tx,
    estateId: string,
    row: BookingRow,
    facility: string,
    outcome: string,
  ) {
    await this.notifications.request(tx, {
      intent: 'facilities.booking_updated',
      userIds: [row.bookedBy],
      estateId,
      data: { facility, outcome, startsAt: row.startsAt.toISOString(), bookingId: row.id },
      dedupeKey: `booking:${row.id}:${row.status}:${row.version}`,
    });
  }

  private async audit(
    tx: Tx,
    access: EstateAccess,
    id: string,
    type: string,
    action: string,
    after: Prisma.InputJsonValue,
  ) {
    await appendOutboxEvents(tx, [
      {
        type,
        estateId: access.estateId,
        aggregateType: 'facility',
        aggregateId: id,
        payload: { facilityId: id },
        audit: {
          actorType: 'user',
          actorId: access.userId,
          action,
          resourceType: 'facility',
          resourceId: id,
          after,
        },
      },
    ]);
  }

  private async bookingEvent(
    tx: Tx,
    access: { estateId: string; userId: string | null },
    row: BookingRow,
    verb: 'created' | 'approved' | 'confirmed' | 'rejected' | 'cancelled' | 'no_show',
    reason: string | null,
  ) {
    await appendOutboxEvents(tx, [
      {
        type: `facilities.booking.${verb}`,
        estateId: access.estateId,
        aggregateType: 'booking',
        aggregateId: row.id,
        payload: { bookingId: row.id, facilityId: row.facilityId, status: row.status },
        audit: {
          actorType: access.userId ? 'user' : 'system',
          actorId: access.userId,
          action: `facilities.booking.${verb}`,
          resourceType: 'booking',
          resourceId: row.id,
          after: {
            status: row.status,
            price: toKobo(row.price),
            override: row.overrideReason !== null,
          },
          ...(reason ? { reason } : {}),
        },
      },
    ]);
  }

  private facilityView(row: FacilityRow) {
    return {
      id: row.id,
      name: row.name,
      type: row.type as 'other',
      spaceId: row.spaceId,
      capacity: row.capacity,
      description: row.description,
      rules: row.rules,
      photoFileIds: row.photoFileIds,
      status: row.status as 'active' | 'closed',
      openingHours: this.hours(row),
      policy: this.policy(row),
      pricing: this.pricing(row),
      version: row.version,
    };
  }

  private bookingView(row: BookingRow, facilityName: string) {
    return {
      id: row.id,
      facilityId: row.facilityId,
      facilityName,
      bookedBy: row.bookedBy,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      guests: row.guests,
      purpose: row.purpose,
      status: row.status as 'confirmed',
      price: toKobo(row.price),
      invoiceId: row.invoiceId,
      holdExpiresAt: row.holdExpiresAt?.toISOString() ?? null,
      refundAmount: toKobo(row.refundAmount),
      rejectionReason: row.rejectionReason,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
