import { Injectable } from '@nestjs/common';
import {
  type AmountRule,
  amountRuleSchema,
  billingRunStatusSchema,
  chargeAppliesToSchema,
  penaltyRuleSchema,
  type billingRunItemsQuerySchema,
  type chargeListQuerySchema,
  type createBillingRunSchema,
  type createChargeSchema,
  type updateChargeSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client';
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
import { OccupancyService } from '../occupancy/occupancy.service';
import { PropertyService } from '../property/property.service';
import { TenancyService } from '../tenancy/tenancy.service';
import {
  type BillingRunAction,
  computeCharge,
  dateOnly,
  nextRunStatus,
  parseDateOnly,
  prorate,
  runNeedsApproval,
  sum,
  todayInLagos,
  toKobo,
} from './domain/billing';
import { UtilitiesService } from '../utilities/utilities.service';
import { InvoicesService, type NewInvoice } from './invoices.service';

type ChargeRow = Prisma.ChargeGetPayload<object>;
type RunRow = Prisma.BillingRunGetPayload<object>;
interface ItemLine {
  chargeId: string;
  chargeType: string;
  description: string;
  quantity: number;
  unitAmount: number;
  amount: number;
}
const itemCursorSchema = z.object({ unitCode: z.string(), id: z.uuid() });
/** Above this many units a run must be split (ADR-0012: issue runs in one transaction for now). */
const MAX_RUN_UNITS = 5000;

/** Charges and billing runs (billing.md §2.1–2.3): preview → submit → approve → issue. */
@Injectable()
export class BillingRunsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly property: PropertyService,
    private readonly occupancy: OccupancyService,
    private readonly tenancy: TenancyService,
    private readonly invoices: InvoicesService,
    private readonly utilities: UtilitiesService,
  ) {}

  // ---- Charges -------------------------------------------------------------------------------

  async createCharge(access: EstateAccess, input: z.infer<typeof createChargeSchema>) {
    return this.db.withTenant(access, async (tx) => {
      if (input.appliesTo.spaceIds.length > 0)
        await this.property.unitIdsWithin(tx, access.estateId, input.appliesTo.spaceIds);
      const row = await tx.charge.create({
        data: {
          estateId: access.estateId,
          type: input.type,
          name: input.name,
          description: input.description ?? null,
          amountRule: input.amountRule,
          frequency: input.frequency,
          payer: input.payer,
          appliesTo: input.appliesTo,
          ...(input.penaltyRule ? { penaltyRule: input.penaltyRule } : {}),
          startsOn: parseDateOnly(input.startsOn),
          endsOn: input.endsOn ? parseDateOnly(input.endsOn) : null,
          createdBy: access.userId,
        },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'billing.charge.created',
          estateId: access.estateId,
          aggregateType: 'charge',
          aggregateId: row.id,
          payload: { chargeId: row.id },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'billing.charge.create',
            resourceType: 'charge',
            resourceId: row.id,
            after: { name: input.name, type: input.type, amountRule: input.amountRule },
          },
        },
      ]);
      return this.chargeView(row);
    });
  }

  async charges(access: EstateAccess, query: z.infer<typeof chargeListQuerySchema>) {
    return this.db.withTenant(access, async (tx) =>
      (
        await tx.charge.findMany({
          where: { estateId: access.estateId, ...(query.status ? { status: query.status } : {}) },
          orderBy: [{ status: 'asc' }, { name: 'asc' }],
          take: 500,
        })
      ).map((row) => this.chargeView(row)),
    );
  }

  async charge(access: EstateAccess, chargeId: string) {
    return this.db.withTenant(access, async (tx) =>
      this.chargeView(await this.loadCharge(tx, access.estateId, chargeId)),
    );
  }

  /** Charges change only for future runs; issued invoices keep their lines (rule 1). */
  async updateCharge(
    access: EstateAccess,
    chargeId: string,
    input: z.infer<typeof updateChargeSchema>,
    expectedVersion: number | null,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const row = await this.loadCharge(tx, access.estateId, chargeId);
      if (expectedVersion !== null && expectedVersion !== row.version)
        throw new ConflictError('VERSION_MISMATCH', 'This charge was changed by someone else');
      if (input.appliesTo && input.appliesTo.spaceIds.length > 0)
        await this.property.unitIdsWithin(tx, access.estateId, input.appliesTo.spaceIds);
      if (input.endsOn && input.endsOn < dateOnly(row.startsOn))
        throw new DomainError('CHARGE_DATES_INVALID', 'The end date is before the start date', 422);
      const updated = await tx.charge.update({
        where: { id: row.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.amountRule ? { amountRule: input.amountRule } : {}),
          ...(input.appliesTo ? { appliesTo: input.appliesTo } : {}),
          ...(input.penaltyRule !== undefined
            ? { penaltyRule: input.penaltyRule === null ? Prisma.DbNull : input.penaltyRule }
            : {}),
          ...(input.endsOn !== undefined
            ? { endsOn: input.endsOn ? parseDateOnly(input.endsOn) : null }
            : {}),
          ...(input.status ? { status: input.status } : {}),
          version: { increment: 1 },
        },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'billing.charge.updated',
          estateId: access.estateId,
          aggregateType: 'charge',
          aggregateId: row.id,
          payload: { chargeId: row.id, version: updated.version },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'billing.charge.update',
            resourceType: 'charge',
            resourceId: row.id,
            before: { amountRule: row.amountRule as Prisma.InputJsonValue, status: row.status },
            after: input as Prisma.InputJsonValue,
          },
        },
      ]);
      return this.chargeView(updated);
    });
  }

  private async loadCharge(tx: Tx, estateId: string, chargeId: string): Promise<ChargeRow> {
    const row = await tx.charge.findFirst({ where: { id: chargeId, estateId } });
    if (!row) throw new NotFoundError('Charge not found', 'CHARGE_NOT_FOUND');
    return row;
  }

  private chargeView(row: ChargeRow) {
    return {
      id: row.id,
      type: row.type as z.infer<typeof createChargeSchema>['type'],
      name: row.name,
      description: row.description,
      amountRule: amountRuleSchema.parse(row.amountRule),
      frequency: row.frequency as z.infer<typeof createChargeSchema>['frequency'],
      payer: row.payer as 'occupant' | 'owner',
      appliesTo: chargeAppliesToSchema.parse(row.appliesTo),
      startsOn: dateOnly(row.startsOn),
      endsOn: row.endsOn ? dateOnly(row.endsOn) : null,
      penaltyRule: row.penaltyRule ? penaltyRuleSchema.parse(row.penaltyRule) : null,
      status: row.status as 'active' | 'archived',
      currency: 'NGN' as const,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
    };
  }

  // ---- Runs ----------------------------------------------------------------------------------

  async createRun(access: EstateAccess, input: z.infer<typeof createBillingRunSchema>) {
    return this.db.withTenant(access, async (tx) => {
      await this.activeCharges(tx, access.estateId, input.chargeIds, input);
      const row = await tx.billingRun.create({
        data: {
          estateId: access.estateId,
          label: input.label,
          periodStart: parseDateOnly(input.periodStart),
          periodEnd: parseDateOnly(input.periodEnd),
          dueDate: parseDateOnly(input.dueDate),
          chargeIds: [...new Set(input.chargeIds)],
          createdBy: access.userId,
        },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'billing.run.created',
          estateId: access.estateId,
          aggregateType: 'billing_run',
          aggregateId: row.id,
          payload: { billingRunId: row.id },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'billing.run.create',
            resourceType: 'billing_run',
            resourceId: row.id,
            after: { label: input.label, chargeIds: input.chargeIds },
          },
        },
      ]);
      return this.runView(row);
    });
  }

  async runs(access: EstateAccess) {
    return this.db.withTenant(access, async (tx) =>
      (
        await tx.billingRun.findMany({
          where: { estateId: access.estateId },
          orderBy: { createdAt: 'desc' },
          take: 100,
        })
      ).map((row) => this.runView(row)),
    );
  }

  async run(access: EstateAccess, runId: string) {
    return this.db.withTenant(access, async (tx) =>
      this.runView(await this.loadRun(tx, access.estateId, runId)),
    );
  }

  async items(
    access: EstateAccess,
    runId: string,
    query: z.infer<typeof billingRunItemsQuerySchema>,
  ) {
    const after = query.cursor
      ? decodeCursor(
          query.cursor,
          (value): value is z.infer<typeof itemCursorSchema> =>
            itemCursorSchema.safeParse(value).success,
        )
      : undefined;
    return this.db.withTenant(access, async (tx) => {
      await this.loadRun(tx, access.estateId, runId);
      const rows = await tx.billingRunItem.findMany({
        where: {
          billingRunId: runId,
          estateId: access.estateId,
          ...(query.skipped === undefined
            ? {}
            : query.skipped
              ? { skipReason: { not: null } }
              : { skipReason: null }),
          ...(after
            ? {
                OR: [
                  { unitCode: { gt: after.unitCode } },
                  { unitCode: after.unitCode, id: { gt: after.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ unitCode: 'asc' }, { id: 'asc' }],
        take: query.limit + 1,
      });
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        items: page.map((row) => ({
          spaceId: row.spaceId,
          unitCode: row.unitCode,
          payerName: row.payerName,
          amount: toKobo(row.amount),
          lines: (row.lines as unknown as ItemLine[]).map((line) => ({
            chargeId: line.chargeId,
            description: line.description,
            quantity: line.quantity,
            unitAmount: line.unitAmount,
            amount: line.amount,
          })),
          payerType: row.payerType as 'occupant' | 'owner',
          skipReason: row.skipReason as
            'vacant' | 'no_owner' | 'not_applicable' | 'payer_changed' | null,
          invoiceId: row.invoiceId,
        })),
        nextCursor:
          rows.length > query.limit && last
            ? encodeCursor({ unitCode: last.unitCode, id: last.id })
            : null,
      };
    });
  }

  /** Computes every unit's bill and stores it as the run's items (replacing an earlier preview). */
  async preview(access: EstateAccess, runId: string) {
    const billOwnerWhenVacant = (await this.tenancy.getSettings(access))[
      'billing.bill_owner_when_vacant'
    ];
    return this.db.withTenant(
      access,
      async (tx) => {
        const run = await this.loadRun(tx, access.estateId, runId);
        this.transition(run, 'preview');
        const period = { start: dateOnly(run.periodStart), end: dateOnly(run.periodEnd) };
        const charges = await this.activeCharges(tx, access.estateId, run.chargeIds, {
          periodStart: period.start,
          periodEnd: period.end,
        });

        const units = new Map<
          string,
          {
            id: string;
            code: string;
            unitType: string | null;
            bedrooms: number | null;
            sizeSqm: number | null;
          }
        >();
        const applicable = new Map<string, Set<string>>();
        for (const charge of charges) {
          const filter = chargeAppliesToSchema.parse(charge.appliesTo);
          for (const unit of await this.property.billableUnits(tx, access.estateId, filter)) {
            units.set(unit.id, unit);
            const set = applicable.get(unit.id) ?? new Set<string>();
            set.add(charge.id);
            applicable.set(unit.id, set);
          }
        }
        if (units.size > MAX_RUN_UNITS)
          throw new DomainError(
            'BILLING_RUN_TOO_LARGE',
            `A run can bill at most ${MAX_RUN_UNITS} units. Split it by block or zone.`,
            422,
          );
        const unitIds = [...units.keys()];
        const occupants = await this.occupancy.billingOccupants(tx, access.estateId, unitIds);
        const owners = await this.property.activeOwners(tx, access.estateId, unitIds);
        // Metered charges (estate-run supply): consumption per unit for each utility billed in this run.
        const consumption = new Map<
          string,
          Partial<Record<'electricity' | 'water' | 'gas', number>>
        >();
        for (const utility of new Set(
          charges.flatMap((charge) => {
            const rule = amountRuleSchema.parse(charge.amountRule);
            return rule.kind === 'metered' ? [rule.utility] : [];
          }),
        )) {
          const used = await this.utilities.consumption(
            tx,
            access.estateId,
            unitIds,
            utility,
            period,
          );
          for (const [spaceId, value] of used)
            consumption.set(spaceId, { ...consumption.get(spaceId), [utility]: value });
        }

        const lineFor = (
          charge: ChargeRow,
          unit: {
            id: string;
            unitType: string | null;
            bedrooms: number | null;
            sizeSqm: number | null;
          },
          from: string | null,
        ): ItemLine | null => {
          const rule = amountRuleSchema.parse(charge.amountRule) as AmountRule;
          const computed = computeCharge(rule, {
            ...unit,
            consumption: consumption.get(unit.id) ?? {},
          });
          if (!computed) return null;
          if (rule.kind === 'metered') {
            // Consumption is already for the period: never prorated.
            return {
              chargeId: charge.id,
              chargeType: charge.type,
              description: `${charge.name} (${computed.quantity} ${rule.utility === 'electricity' ? 'kWh' : 'm³'})`,
              quantity: computed.quantity,
              unitAmount: computed.unitAmount,
              amount: computed.amount,
            };
          }
          // Recurring charges are prorated when the payer started during the period, and when the charge
          // itself starts or ends inside it.
          const billable = {
            from: [from ?? period.start, dateOnly(charge.startsOn)].sort().at(-1) as string,
            to: charge.endsOn ? dateOnly(charge.endsOn) : null,
          };
          const prorated =
            charge.frequency === 'one_off'
              ? { amount: computed.amount, days: 1, periodDays: 1 }
              : prorate(computed.amount, period, billable);
          if (prorated.amount <= 0) return null;
          const partial = prorated.days < prorated.periodDays;
          return {
            chargeId: charge.id,
            chargeType: charge.type,
            description: partial
              ? `${charge.name} (${prorated.days} of ${prorated.periodDays} days)`
              : charge.name,
            quantity: computed.quantity,
            unitAmount: computed.unitAmount,
            amount: prorated.amount,
          };
        };

        const items: Prisma.BillingRunItemCreateManyInput[] = [];
        for (const unit of units.values()) {
          const occupant = occupants.get(unit.id);
          const owner = owners.get(unit.id)?.[0];
          const occupantLines: ItemLine[] = [];
          const ownerLines: ItemLine[] = [];
          let missing: 'vacant' | 'no_owner' | null = null;
          for (const charge of charges) {
            if (!applicable.get(unit.id)?.has(charge.id)) continue;
            // billing.md rules 7–8: owner charges go to the primary owner; occupant charges on a vacant
            // unit go to the owner when the estate says so.
            const toOwner =
              charge.payer === 'owner' || (!occupant && billOwnerWhenVacant && Boolean(owner));
            if (toOwner && !owner) {
              missing = 'no_owner';
              continue;
            }
            if (!toOwner && !occupant) {
              missing = 'vacant';
              continue;
            }
            const line = lineFor(charge, unit, toOwner ? null : (occupant?.startsOn ?? null));
            if (line) (toOwner ? ownerLines : occupantLines).push(line);
          }
          const base = {
            estateId: access.estateId,
            billingRunId: run.id,
            spaceId: unit.id,
            unitCode: unit.code,
          };
          if (occupantLines.length > 0 && occupant) {
            items.push({
              ...base,
              payerType: 'occupant',
              householdId: occupant.householdId,
              payerUserId: occupant.payerUserId,
              payerName: occupant.payerName,
              amount: BigInt(sum(occupantLines.map((line) => line.amount))),
              lines: occupantLines as unknown as Prisma.InputJsonValue,
              skipReason: null,
            });
          }
          if (ownerLines.length > 0 && owner) {
            items.push({
              ...base,
              payerType: 'owner',
              householdId: null,
              payerUserId: owner.userId,
              payerName: owner.name,
              amount: BigInt(sum(ownerLines.map((line) => line.amount))),
              lines: ownerLines as unknown as Prisma.InputJsonValue,
              skipReason: null,
            });
          }
          if (occupantLines.length === 0 && ownerLines.length === 0) {
            items.push({
              ...base,
              payerType: 'occupant',
              householdId: null,
              payerUserId: null,
              payerName: null,
              amount: 0n,
              lines: [],
              skipReason: missing ?? 'not_applicable',
            });
          }
        }

        await tx.billingRunItem.deleteMany({ where: { billingRunId: run.id } });
        if (items.length > 0) await tx.billingRunItem.createMany({ data: items });
        const billed = items.filter((item) => item.skipReason === null);
        const total = sum(billed.map((item) => Number(item.amount)));
        const billedUnits = new Set(billed.map((item) => item.spaceId));
        const updated = await this.update(tx, run, 'previewed', {
          previewedAt: new Date(),
          chargeVersions: Object.fromEntries(charges.map((charge) => [charge.id, charge.version])),
          invoiceCount: billed.length,
          totalAmount: BigInt(total),
          skippedUnits: units.size - billedUnits.size,
        });
        return this.runView(updated);
      },
      { timeout: 60_000 },
    );
  }

  async submit(access: EstateAccess, runId: string) {
    const settings = await this.tenancy.getSettings(access);
    return this.db.withTenant(access, async (tx) => {
      const run = await this.loadRun(tx, access.estateId, runId);
      this.transition(run, 'submit');
      if ((run.invoiceCount ?? 0) === 0)
        throw new DomainError('BILLING_RUN_EMPTY', 'This run has nothing to bill', 422);
      const approvalRequired = runNeedsApproval(
        {
          twoLevel: settings['billing.two_level_approval'],
          thresholdKobo: settings['billing.approval_threshold_kobo'],
        },
        toKobo(run.totalAmount ?? 0n),
      );
      const to = this.transition(run, 'submit', { approvalRequired });
      const updated = await this.update(tx, run, to, {
        approvalRequired,
        submittedBy: access.userId,
        submittedAt: new Date(),
        ...(to === 'approved' ? { approvedBy: access.userId, approvedAt: new Date() } : {}),
      });
      await this.event(tx, access, updated, to === 'approved' ? 'approved' : 'submitted');
      return this.runView(updated);
    });
  }

  /** billing.md rule 4: the approver cannot be the creator (or whoever submitted it). */
  async approve(access: EstateAccess, runId: string) {
    return this.db.withTenant(access, async (tx) => {
      const run = await this.loadRun(tx, access.estateId, runId);
      const to = this.transition(run, 'approve');
      if (run.createdBy === access.userId || run.submittedBy === access.userId)
        throw new ForbiddenError(
          'Someone other than the person who prepared this run must approve it',
          'BILLING_RUN_SELF_APPROVAL',
        );
      const updated = await this.update(tx, run, to, {
        approvedBy: access.userId,
        approvedAt: new Date(),
      });
      await this.event(tx, access, updated, 'approved');
      return this.runView(updated);
    });
  }

  async cancel(access: EstateAccess, runId: string, reason: string) {
    return this.db.withTenant(access, async (tx) => {
      const run = await this.loadRun(tx, access.estateId, runId);
      const to = this.transition(run, 'cancel');
      const updated = await this.update(tx, run, to, {
        cancelledBy: access.userId,
        cancelledAt: new Date(),
        cancelReason: reason,
      });
      await this.event(tx, access, updated, 'cancelled', reason);
      return this.runView(updated);
    });
  }

  /**
   * Issues the approved preview. Charges must be unchanged since the preview; payers are re-checked at
   * issue time (rule 7) and units whose household changed are skipped as `payer_changed`.
   */
  async issue(access: EstateAccess, runId: string) {
    return this.db.withTenant(
      access,
      async (tx) => {
        const run = await this.loadRun(tx, access.estateId, runId);
        const to = this.transition(run, 'issue');
        const versions = (run.chargeVersions ?? {}) as Record<string, number>;
        const charges = await tx.charge.findMany({
          where: { estateId: access.estateId, id: { in: run.chargeIds } },
          select: { id: true, version: true, status: true },
        });
        if (
          charges.some(
            (charge) => versions[charge.id] !== charge.version || charge.status !== 'active',
          )
        )
          throw new ConflictError(
            'BILLING_RUN_STALE',
            'A charge changed after this run was previewed. Cancel it and prepare a new run.',
          );
        const items = await tx.billingRunItem.findMany({
          where: { billingRunId: run.id, skipReason: null },
          orderBy: { unitCode: 'asc' },
        });
        const current = await this.occupancy.billingOccupants(
          tx,
          access.estateId,
          items.map((item) => item.spaceId),
        );
        const currentOwners = await this.property.activeOwners(
          tx,
          access.estateId,
          items.map((item) => item.spaceId),
        );
        const changed = items.filter((item) =>
          item.payerType === 'owner'
            ? currentOwners.get(item.spaceId)?.[0]?.userId !== item.payerUserId
            : current.get(item.spaceId)?.householdId !== item.householdId ||
              current.get(item.spaceId)?.payerUserId !== item.payerUserId,
        );
        if (changed.length > 0) {
          await tx.billingRunItem.updateMany({
            where: { id: { in: changed.map((item) => item.id) } },
            data: { skipReason: 'payer_changed' },
          });
        }
        const toIssue = items.filter((item) => !changed.includes(item));
        const issueDate = todayInLagos();
        const dueDate = [dateOnly(run.dueDate), issueDate].sort().at(-1) as string;
        const invoices: NewInvoice[] = toIssue.map((item) => ({
          spaceId: item.spaceId,
          unitCode: item.unitCode,
          householdId: item.householdId,
          payerUserId: item.payerUserId as string,
          payerType: item.payerType as 'occupant' | 'owner',
          billingRunId: run.id,
          penaltyForInvoiceId: null,
          description: run.label,
          issueDate,
          dueDate,
          createdBy: access.userId,
          lines: (item.lines as unknown as ItemLine[]).map((line) => ({ ...line })),
        }));
        const ids = await this.invoices.issue(tx, access.estateId, invoices);
        for (const [index, item] of toIssue.entries()) {
          await tx.billingRunItem.update({
            where: { id: item.id },
            data: { invoiceId: ids[index] as string },
          });
        }
        const total = sum(toIssue.map((item) => toKobo(item.amount)));
        const updated = await this.update(tx, run, to, {
          issuedBy: access.userId,
          issuedAt: new Date(),
          invoiceCount: ids.length,
          totalAmount: BigInt(total),
          skippedUnits: (run.skippedUnits ?? 0) + changed.length,
        });
        await this.event(tx, access, updated, 'issued');
        return this.runView(updated);
      },
      { timeout: 120_000 },
    );
  }

  private async activeCharges(
    tx: Tx,
    estateId: string,
    chargeIds: readonly string[],
    period: { periodStart: string; periodEnd: string },
  ) {
    const unique = [...new Set(chargeIds)];
    const rows = await tx.charge.findMany({ where: { estateId, id: { in: unique } } });
    if (rows.length !== unique.length)
      throw new NotFoundError('Charge not found', 'CHARGE_NOT_FOUND');
    for (const row of rows) {
      const ended = row.endsOn && dateOnly(row.endsOn) < period.periodStart;
      if (row.status !== 'active' || ended || dateOnly(row.startsOn) > period.periodEnd)
        throw new DomainError(
          'BILLING_CHARGE_INACTIVE',
          `The charge "${row.name}" is not active for this period`,
          422,
        );
    }
    return rows;
  }

  private async loadRun(tx: Tx, estateId: string, runId: string): Promise<RunRow> {
    const row = await tx.billingRun.findFirst({ where: { id: runId, estateId } });
    if (!row) throw new NotFoundError('Billing run not found', 'BILLING_RUN_NOT_FOUND');
    return row;
  }

  private transition(
    run: RunRow,
    action: BillingRunAction,
    options?: { approvalRequired?: boolean },
  ) {
    const to = nextRunStatus(run.status, action, options);
    if (!to)
      throw new ConflictError(
        'BILLING_RUN_INVALID_TRANSITION',
        `A ${run.status.replaceAll('_', ' ')} run cannot be ${action === 'issue' ? 'issued' : `${action}d`}`,
      );
    return to;
  }

  /** Optimistic update: fails if someone else moved the run on in the meantime. */
  private async update(
    tx: Tx,
    run: RunRow,
    status: string,
    data: Prisma.BillingRunUpdateManyMutationInput,
  ): Promise<RunRow> {
    const result = await tx.billingRun.updateMany({
      where: { id: run.id, version: run.version },
      data: { ...data, status, version: { increment: 1 } },
    });
    if (result.count === 0)
      throw new ConflictError('VERSION_MISMATCH', 'This run was changed by someone else');
    return tx.billingRun.findFirstOrThrow({ where: { id: run.id } });
  }

  private async event(
    tx: Tx,
    access: EstateAccess,
    run: RunRow,
    verb: 'submitted' | 'approved' | 'issued' | 'cancelled',
    reason?: string,
  ) {
    await appendOutboxEvents(tx, [
      {
        type: `billing.run.${verb}`,
        estateId: access.estateId,
        aggregateType: 'billing_run',
        aggregateId: run.id,
        payload: {
          billingRunId: run.id,
          invoices: run.invoiceCount ?? 0,
          total: toKobo(run.totalAmount ?? 0n),
        },
        audit: {
          actorType: 'user',
          actorId: access.userId,
          action: `billing.run.${verb === 'submitted' ? 'submit' : verb === 'approved' ? 'approve' : verb === 'issued' ? 'issue' : 'cancel'}`,
          resourceType: 'billing_run',
          resourceId: run.id,
          after: { status: run.status, total: toKobo(run.totalAmount ?? 0n) },
          ...(reason ? { reason } : {}),
        },
      },
    ]);
  }

  private runView(row: RunRow) {
    return {
      id: row.id,
      label: row.label,
      periodStart: dateOnly(row.periodStart),
      periodEnd: dateOnly(row.periodEnd),
      dueDate: dateOnly(row.dueDate),
      chargeIds: row.chargeIds,
      status: row.status as z.infer<typeof billingRunStatusSchema>,
      totals:
        row.invoiceCount === null
          ? null
          : {
              invoices: row.invoiceCount,
              amount: toKobo(row.totalAmount ?? 0n),
              skippedUnits: row.skippedUnits ?? 0,
            },
      currency: 'NGN' as const,
      createdBy: row.createdBy,
      approvedBy: row.approvedBy,
      approvalRequired: row.approvalRequired,
      cancelReason: row.cancelReason,
      createdAt: row.createdAt.toISOString(),
      issuedAt: row.issuedAt?.toISOString() ?? null,
    };
  }
}
