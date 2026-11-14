import { Injectable } from '@nestjs/common';
import type {
  createMeterSchema,
  createOutageSchema,
  meterListQuerySchema,
  meterLookupSchema,
  meterReadingsSchema,
  outageListQuerySchema,
  updateOutageSchema,
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
import { BillsProvider, BillsProviderError } from '../../integrations/bills/bills-provider';
import { NotificationsService } from '../notifications/notifications.service';
import { isStaffWith, OccupancyService } from '../occupancy/occupancy.service';
import { PropertyService } from '../property/property.service';
import { TenancyService } from '../tenancy/tenancy.service';

type Utility = 'electricity' | 'water' | 'gas';
type MeterRow = Prisma.MeterGetPayload<object>;
type OutageRow = Prisma.UtilityOutageGetPayload<object>;

/** Public providers residents can register meters with (Nigerian DisCos), plus the estate's own supply. */
export const UTILITY_PROVIDERS = [
  { code: 'IKEDC', name: 'Ikeja Electric', type: 'electricity', supply: 'public' },
  { code: 'EKEDC', name: 'Eko Electricity Distribution', type: 'electricity', supply: 'public' },
  { code: 'AEDC', name: 'Abuja Electricity Distribution', type: 'electricity', supply: 'public' },
  { code: 'IBEDC', name: 'Ibadan Electricity Distribution', type: 'electricity', supply: 'public' },
  { code: 'EEDC', name: 'Enugu Electricity Distribution', type: 'electricity', supply: 'public' },
  {
    code: 'PHED',
    name: 'Port Harcourt Electricity Distribution',
    type: 'electricity',
    supply: 'public',
  },
  { code: 'KEDCO', name: 'Kano Electricity Distribution', type: 'electricity', supply: 'public' },
  { code: 'BEDC', name: 'Benin Electricity Distribution', type: 'electricity', supply: 'public' },
  { code: 'JED', name: 'Jos Electricity Distribution', type: 'electricity', supply: 'public' },
  { code: 'KAEDCO', name: 'Kaduna Electric', type: 'electricity', supply: 'public' },
  { code: 'YEDC', name: 'Yola Electricity Distribution', type: 'electricity', supply: 'public' },
  { code: 'ESTATE', name: 'Estate supply (sub-meter)', type: 'electricity', supply: 'estate' },
  { code: 'ESTATE_WATER', name: 'Estate water supply', type: 'water', supply: 'estate' },
  { code: 'ESTATE_GAS', name: 'Estate gas supply', type: 'gas', supply: 'estate' },
] as const;

function canManageUtilities(access: EstateAccess): boolean {
  return (
    isStaffWith(access, 'charge.manage') ||
    isStaffWith(access, 'space.manage') ||
    isStaffWith(access, 'maintenance.assign')
  );
}

/**
 * Utilities (utilities.md): meter registration and validation, readings, consumption for estate-run
 * metered charges (used by billing runs), and outage announcements to affected residents only.
 */
@Injectable()
export class UtilitiesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly bills: BillsProvider,
    private readonly property: PropertyService,
    private readonly occupancy: OccupancyService,
    private readonly tenancy: TenancyService,
    private readonly notifications: NotificationsService,
  ) {}

  providers() {
    return UTILITY_PROVIDERS.map((provider) => ({ ...provider }));
  }

  private provider(code: string) {
    const provider = UTILITY_PROVIDERS.find((item) => item.code === code);
    if (!provider) throw new NotFoundError('Unknown provider', 'UTILITY_PROVIDER_NOT_FOUND');
    return provider;
  }

  /** Rule 3: public meters are validated with the provider before use. */
  async lookup(input: z.infer<typeof meterLookupSchema>) {
    const provider = this.provider(input.providerCode);
    if (provider.supply === 'estate')
      throw new DomainError(
        'METER_LOOKUP_NOT_NEEDED',
        'Estate sub-meters are registered by management',
        422,
      );
    try {
      const result = await this.bills.lookupMeter(provider.code, input.meterNumber);
      return { providerCode: provider.code, meterNumber: input.meterNumber, ...result };
    } catch (error) {
      if (error instanceof BillsProviderError)
        throw error.retryable
          ? new DomainError(
              'BILLS_PROVIDER_UNAVAILABLE',
              'Meter validation is not available right now',
              502,
            )
          : new DomainError('METER_NOT_FOUND', 'The provider could not find this meter', 422);
      throw error;
    }
  }

  async createMeter(access: EstateAccess, input: z.infer<typeof createMeterSchema>) {
    const provider = this.provider(input.providerCode);
    if (provider.type !== input.type || provider.supply !== input.supply)
      throw new DomainError(
        'METER_PROVIDER_MISMATCH',
        'This provider does not supply that utility',
        422,
      );
    const staff = canManageUtilities(access);
    if (input.supply === 'estate' && !staff)
      throw new ForbiddenError('Estate sub-meters are registered by management');
    if (!staff) {
      const households = await this.occupancy.householdsOf(access.estateId, access.userId);
      if (!households.some((household) => household.spaceId === input.spaceId))
        throw new ForbiddenError('You can only add meters for your own unit');
    }
    const verified = input.supply === 'public' ? await this.lookup(input) : null;
    return this.db.withTenant(access, async (tx) => {
      const unit = await this.property.unit(tx, access.estateId, input.spaceId);
      if (!unit) throw new NotFoundError('Unit not found', 'SPACE_NOT_FOUND');
      const existing = await tx.meter.count({
        where: {
          estateId: access.estateId,
          providerCode: provider.code,
          meterNumber: input.meterNumber,
          status: 'active',
        },
      });
      if (existing > 0)
        throw new ConflictError('METER_EXISTS', 'This meter is already registered in the estate');
      const row = await tx.meter.create({
        data: {
          estateId: access.estateId,
          spaceId: unit.id,
          type: input.type,
          supply: input.supply,
          providerCode: provider.code,
          meterNumber: input.meterNumber,
          accountName: verified?.accountName ?? null,
          prepaid: verified?.prepaid ?? false,
          verifiedAt: verified ? new Date() : null,
          createdBy: access.userId,
        },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'utilities.meter.registered',
          estateId: access.estateId,
          aggregateType: 'meter',
          aggregateId: row.id,
          payload: { meterId: row.id, spaceId: row.spaceId, type: row.type, supply: row.supply },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'utilities.meter.register',
            resourceType: 'meter',
            resourceId: row.id,
            after: { spaceId: row.spaceId, providerCode: row.providerCode },
          },
        },
      ]);
      return this.meterView(row, unit.code, null);
    });
  }

  async meters(access: EstateAccess, query: z.infer<typeof meterListQuerySchema>) {
    const staff = canManageUtilities(access);
    const units = staff
      ? null
      : (await this.occupancy.householdsOf(access.estateId, access.userId)).map(
          (household) => household.spaceId,
        );
    return this.db.withTenant(access, async (tx) => {
      const rows = await tx.meter.findMany({
        where: {
          estateId: access.estateId,
          status: 'active',
          ...(query.type ? { type: query.type } : {}),
          ...(query.spaceId ? { spaceId: query.spaceId } : {}),
          ...(units
            ? {
                spaceId: { in: query.spaceId ? units.filter((id) => id === query.spaceId) : units },
              }
            : {}),
        },
        include: { readings: { orderBy: { readAt: 'desc' }, take: 1 } },
        orderBy: { createdAt: 'asc' },
        take: 2000,
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
      return rows.map((row) =>
        this.meterView(row, codes.get(row.spaceId) ?? '', row.readings[0] ?? null),
      );
    });
  }

  async removeMeter(access: EstateAccess, meterId: string) {
    const staff = canManageUtilities(access);
    const units = staff
      ? null
      : (await this.occupancy.householdsOf(access.estateId, access.userId)).map((h) => h.spaceId);
    await this.db.withTenant(access, async (tx) => {
      const row = await tx.meter.findFirst({
        where: { id: meterId, estateId: access.estateId, status: 'active' },
      });
      if (!row || (units && !units.includes(row.spaceId)))
        throw new NotFoundError('Meter not found', 'METER_NOT_FOUND');
      if (row.supply === 'estate' && !staff)
        throw new ForbiddenError('Estate sub-meters are managed by management');
      await tx.meter.update({
        where: { id: meterId },
        data: { status: 'removed', removedAt: new Date() },
      });
    });
  }

  /** Bulk readings (utilities.md §2.6). A reading lower than an earlier one on the same meter is rejected. */
  async recordReadings(access: EstateAccess, input: z.infer<typeof meterReadingsSchema>) {
    if (!canManageUtilities(access))
      throw new ForbiddenError('Only management records meter readings');
    return this.db.withTenant(access, async (tx) => {
      const meterIds = [...new Set(input.readings.map((reading) => reading.meterId))];
      const meters = new Map(
        (
          await tx.meter.findMany({
            where: { estateId: access.estateId, id: { in: meterIds }, status: 'active' },
          })
        ).map((meter) => [meter.id, meter]),
      );
      const rejected: { meterId: string; reason: string }[] = [];
      const accepted: { meterId: string; reading: number; readAt: Date }[] = [];
      const sorted = [...input.readings].sort((a, b) => a.readAt.localeCompare(b.readAt));
      for (const item of sorted) {
        if (!meters.has(item.meterId)) {
          rejected.push({ meterId: item.meterId, reason: 'meter_not_found' });
          continue;
        }
        const readAt = new Date(item.readAt);
        if (readAt > new Date(Date.now() + 5 * 60_000)) {
          rejected.push({ meterId: item.meterId, reason: 'in_future' });
          continue;
        }
        const earlierAccepted = accepted
          .filter((a) => a.meterId === item.meterId && a.readAt <= readAt)
          .at(-1);
        const earlier =
          earlierAccepted ??
          (await tx.meterReading.findFirst({
            where: { meterId: item.meterId, readAt: { lte: readAt } },
            orderBy: { readAt: 'desc' },
          }));
        if (earlier && item.reading < earlier.reading) {
          rejected.push({ meterId: item.meterId, reason: 'lower_than_previous' });
          continue;
        }
        accepted.push({ meterId: item.meterId, reading: item.reading, readAt });
      }
      if (accepted.length > 0) {
        await tx.meterReading.createMany({
          data: accepted.map((item) => ({
            estateId: access.estateId,
            meterId: item.meterId,
            reading: item.reading,
            readAt: item.readAt,
            source: 'manual',
            recordedBy: access.userId,
          })),
        });
        await appendOutboxEvents(tx, [
          {
            type: 'utilities.reading.recorded',
            estateId: access.estateId,
            aggregateType: 'estate',
            aggregateId: access.estateId,
            payload: { count: accepted.length },
          },
        ]);
      }
      return { recorded: accepted.length, rejected };
    });
  }

  /**
   * Consumption per unit in a period from estate-supply meters (utilities.md §4.2): the last reading at or
   * before the period end minus the last reading before the period start (or the first in the period).
   * Units whose meters lack two readings are left out, so no one is billed on a guess.
   */
  async consumption(
    tx: Tx,
    estateId: string,
    unitIds: readonly string[],
    utility: Utility,
    period: { start: string; end: string },
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (unitIds.length === 0) return result;
    const start = new Date(`${period.start}T00:00:00.000+01:00`);
    const end = new Date(new Date(`${period.end}T00:00:00.000+01:00`).getTime() + 86_400_000);
    const meters = await tx.meter.findMany({
      where: {
        estateId,
        spaceId: { in: [...unitIds] },
        type: utility,
        supply: 'estate',
        status: 'active',
      },
      select: { id: true, spaceId: true },
    });
    for (const meter of meters) {
      const closing = await tx.meterReading.findFirst({
        where: { meterId: meter.id, readAt: { lt: end } },
        orderBy: { readAt: 'desc' },
      });
      const opening =
        (await tx.meterReading.findFirst({
          where: { meterId: meter.id, readAt: { lt: start } },
          orderBy: { readAt: 'desc' },
        })) ??
        (await tx.meterReading.findFirst({
          where: { meterId: meter.id, readAt: { gte: start, lt: end } },
          orderBy: { readAt: 'asc' },
        }));
      if (!closing || !opening || closing.id === opening.id) continue;
      const used = Math.max(0, Math.round((closing.reading - opening.reading) * 1000) / 1000);
      result.set(meter.spaceId, (result.get(meter.spaceId) ?? 0) + used);
    }
    return result;
  }

  private meterView(
    row: MeterRow,
    unitCode: string,
    last: { reading: number; readAt: Date } | null,
  ) {
    return {
      id: row.id,
      spaceId: row.spaceId,
      unitCode,
      type: row.type as Utility,
      supply: row.supply as 'public' | 'estate',
      providerCode: row.providerCode,
      meterNumber: row.meterNumber,
      accountName: row.accountName,
      prepaid: row.prepaid,
      status: row.status as 'active' | 'removed',
      verifiedAt: row.verifiedAt?.toISOString() ?? null,
      lastReading: last?.reading ?? null,
      lastReadAt: last?.readAt.toISOString() ?? null,
    };
  }

  // ---- Outages -------------------------------------------------------------------------------

  /** Announces an outage to residents of the affected units only (acceptance criterion 3). */
  async announceOutage(access: EstateAccess, input: z.infer<typeof createOutageSchema>) {
    const everyone =
      input.spaceIds.length === 0 ? await this.tenancy.activeMemberIds(access.estateId) : [];
    return this.db.withTenant(access, async (tx) => {
      const units =
        input.spaceIds.length > 0
          ? await this.property.unitIdsWithin(tx, access.estateId, input.spaceIds)
          : [];
      const recipients =
        input.spaceIds.length > 0
          ? await this.occupancy.residentUserIdsInUnits(tx, access.estateId, units)
          : everyone;
      const row = await tx.utilityOutage.create({
        data: {
          estateId: access.estateId,
          type: input.type,
          title: input.title,
          details: input.details ?? null,
          startsAt: new Date(input.startsAt),
          expectedEndAt: input.expectedEndAt ? new Date(input.expectedEndAt) : null,
          spaceIds: input.spaceIds,
          notified: recipients.length,
          createdBy: access.userId,
        },
      });
      for (let index = 0; index < recipients.length; index += 5000) {
        await this.notifications.request(tx, {
          intent: 'utilities.outage',
          userIds: recipients.slice(index, index + 5000),
          estateId: access.estateId,
          data: {
            title: input.title,
            details: (input.details ?? '').slice(0, 160),
            outageId: row.id,
          },
          dedupeKey: `outage:${row.id}:${index}`,
        });
      }
      await appendOutboxEvents(tx, [
        {
          type: 'utilities.outage.announced',
          estateId: access.estateId,
          aggregateType: 'utility_outage',
          aggregateId: row.id,
          payload: { outageId: row.id, recipients: recipients.length },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'utilities.outage.announce',
            resourceType: 'utility_outage',
            resourceId: row.id,
            after: {
              title: input.title,
              spaces: input.spaceIds.length,
              recipients: recipients.length,
            },
          },
        },
      ]);
      return this.outageView(row);
    });
  }

  async outages(access: EstateAccess, query: z.infer<typeof outageListQuerySchema>) {
    const staff = isStaffWith(access, 'announcement.publish');
    const myUnits = staff
      ? []
      : (await this.occupancy.householdsOf(access.estateId, access.userId)).map((h) => h.spaceId);
    return this.db.withTenant(access, async (tx) => {
      const rows = await tx.utilityOutage.findMany({
        where: { estateId: access.estateId, ...(query.status ? { status: query.status } : {}) },
        orderBy: { startsAt: 'desc' },
        take: 200,
      });
      if (staff) return rows.map((row) => this.outageView(row));
      const visible: OutageRow[] = [];
      for (const row of rows) {
        if (row.spaceIds.length === 0) visible.push(row);
        else if (myUnits.length > 0) {
          const units = await this.property
            .unitIdsWithin(tx, access.estateId, row.spaceIds)
            .catch(() => []);
          if (units.some((unit) => myUnits.includes(unit))) visible.push(row);
        }
      }
      return visible.map((row) => this.outageView(row));
    });
  }

  async updateOutage(
    access: EstateAccess,
    outageId: string,
    input: z.infer<typeof updateOutageSchema>,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const row = await tx.utilityOutage.findFirst({
        where: { id: outageId, estateId: access.estateId },
      });
      if (!row) throw new NotFoundError('Outage not found', 'OUTAGE_NOT_FOUND');
      if (row.status !== 'announced')
        throw new ConflictError('OUTAGE_CLOSED', 'This outage is already closed');
      const updated = await tx.utilityOutage.update({
        where: { id: outageId },
        data: {
          ...(input.status ? { status: input.status, closedAt: new Date() } : {}),
          ...(input.expectedEndAt ? { expectedEndAt: new Date(input.expectedEndAt) } : {}),
          ...(input.details !== undefined ? { details: input.details } : {}),
        },
      });
      if (input.status === 'resolved') {
        await appendOutboxEvents(tx, [
          {
            type: 'utilities.outage.resolved',
            estateId: access.estateId,
            aggregateType: 'utility_outage',
            aggregateId: row.id,
            payload: { outageId: row.id },
          },
        ]);
      }
      return this.outageView(updated);
    });
  }

  private outageView(row: OutageRow) {
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      details: row.details,
      startsAt: row.startsAt.toISOString(),
      expectedEndAt: row.expectedEndAt?.toISOString() ?? null,
      spaceIds: row.spaceIds,
      status: row.status as 'announced' | 'resolved' | 'cancelled',
      notified: row.notified,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
