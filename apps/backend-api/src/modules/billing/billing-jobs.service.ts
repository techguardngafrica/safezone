import { Injectable, Logger } from '@nestjs/common';
import { penaltyRuleSchema } from '@safezone/schemas';
import { DatabaseService } from '../../common/database/database.service';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';
import { NotificationsService } from '../notifications/notifications.service';
import { PropertyService } from '../property/property.service';
import { TenancyService } from '../tenancy/tenancy.service';
import {
  addDays,
  computePenalty,
  dateOnly,
  parseDateOnly,
  remindersDue,
  sum,
  toKobo,
} from './domain/billing';
import { formatNaira, InvoicesService } from './invoices.service';

export interface DailyResult {
  overdue: number;
  penalties: number;
  reminders: number;
  balanced: boolean;
}

const PENALTY_DUE_DAYS = 7;

/**
 * Daily billing work per estate (billing.md §8): overdue events, late penalties, reminders and the
 * invoice-vs-ledger check. Every step is idempotent for a given day, so retries and re-runs are safe.
 */
@Injectable()
export class BillingJobsService {
  private readonly logger = new Logger('BillingJobs');

  constructor(
    private readonly db: DatabaseService,
    private readonly invoices: InvoicesService,
    private readonly property: PropertyService,
    private readonly tenancy: TenancyService,
    private readonly notifications: NotificationsService,
  ) {}

  async runDaily(estateId: string, today: string): Promise<DailyResult> {
    const context = { estateId, userId: null };
    const settings = await this.tenancy.getSettings(context);
    const overdue = await this.markOverdue(estateId, today);
    const penalties = await this.applyPenalties(
      estateId,
      today,
      settings['billing.penalty_grace_days'],
    );
    const reminders = await this.sendReminders(
      estateId,
      today,
      settings['billing.reminder_offsets_days'],
    );
    const balanced = await this.verifyBalances(estateId);
    return { overdue, penalties, reminders, balanced };
  }

  private async markOverdue(estateId: string, today: string): Promise<number> {
    return this.db.withTenant({ estateId, userId: null }, async (tx) => {
      const rows = await tx.invoice.findMany({
        where: {
          estateId,
          status: { in: ['issued', 'partially_paid'] },
          dueDate: { lt: parseDateOnly(today) },
          overdueAt: null,
        },
        select: { id: true, number: true, payerUserId: true, balance: true },
        take: 5000,
      });
      if (rows.length === 0) return 0;
      await tx.invoice.updateMany({
        where: { id: { in: rows.map((row) => row.id) }, overdueAt: null },
        data: { overdueAt: new Date() },
      });
      await appendOutboxEvents(
        tx,
        rows.map((row) => ({
          type: 'billing.invoice.overdue',
          estateId,
          aggregateType: 'invoice',
          aggregateId: row.id,
          payload: { invoiceId: row.id, number: row.number, balance: toKobo(row.balance) },
        })),
      );
      return rows.length;
    });
  }

  /** One penalty invoice per late invoice, never on a penalty invoice (billing.md rule 5). */
  private async applyPenalties(
    estateId: string,
    today: string,
    graceDays: number,
  ): Promise<number> {
    const cutoff = parseDateOnly(addDays(today, -graceDays));
    return this.db.withTenant(
      { estateId, userId: null },
      async (tx) => {
        const late = await tx.invoice.findMany({
          where: {
            estateId,
            status: { in: ['issued', 'partially_paid'] },
            penaltyForInvoiceId: null,
            dueDate: { lt: cutoff },
            lines: { some: { chargeId: { not: null } } },
          },
          include: { lines: true },
          take: 2000,
        });
        if (late.length === 0) return 0;
        const already = new Set(
          (
            await tx.invoice.findMany({
              where: { estateId, penaltyForInvoiceId: { in: late.map((row) => row.id) } },
              select: { penaltyForInvoiceId: true },
            })
          ).map((row) => row.penaltyForInvoiceId),
        );
        const chargeIds = [
          ...new Set(
            late.flatMap((row) => row.lines.flatMap((l) => (l.chargeId ? [l.chargeId] : []))),
          ),
        ];
        const rules = new Map(
          (
            await tx.charge.findMany({
              where: { estateId, id: { in: chargeIds } },
              select: { id: true, penaltyRule: true },
            })
          ).map((charge) => [
            charge.id,
            charge.penaltyRule ? penaltyRuleSchema.parse(charge.penaltyRule) : null,
          ]),
        );
        const codes = new Map(
          (
            await this.property.spacesByIds(
              tx,
              estateId,
              late.map((row) => row.spaceId),
            )
          ).map((s) => [s.id, s.code]),
        );
        const toIssue = late
          .filter((row) => !already.has(row.id))
          .map((row) => {
            const amount = computePenalty(
              row.lines.map((line) => ({
                amount: toKobo(line.amount),
                rule: line.chargeId ? (rules.get(line.chargeId) ?? null) : null,
              })),
              { total: toKobo(row.total), balance: toKobo(row.balance) },
            );
            return { row, amount };
          })
          .filter((item) => item.amount > 0);
        if (toIssue.length === 0) return 0;
        await this.invoices.issue(
          tx,
          estateId,
          toIssue.map(({ row, amount }) => ({
            spaceId: row.spaceId,
            unitCode: codes.get(row.spaceId) ?? row.spaceId,
            householdId: row.householdId,
            payerUserId: row.payerUserId,
            payerType: 'occupant' as const,
            billingRunId: null,
            penaltyForInvoiceId: row.id,
            description: `Late payment penalty on ${row.number}`,
            issueDate: today,
            dueDate: addDays(today, PENALTY_DUE_DAYS),
            createdBy: null,
            lines: [
              {
                chargeId: null,
                chargeType: 'penalty',
                description: `Late payment penalty on ${row.number} (due ${dateOnly(row.dueDate)})`,
                quantity: 1,
                unitAmount: amount,
                amount,
              },
            ],
          })),
        );
        await appendOutboxEvents(
          tx,
          toIssue.map(({ row, amount }) => ({
            type: 'billing.penalty.applied',
            estateId,
            aggregateType: 'invoice',
            aggregateId: row.id,
            payload: { invoiceId: row.id, amount },
            audit: {
              actorType: 'system' as const,
              action: 'billing.penalty.apply',
              resourceType: 'invoice',
              resourceId: row.id,
              after: { amount },
            },
          })),
        );
        return toIssue.length;
      },
      { timeout: 120_000 },
    );
  }

  private async sendReminders(
    estateId: string,
    today: string,
    offsets: readonly number[],
  ): Promise<number> {
    if (offsets.length === 0) return 0;
    const earliest = parseDateOnly(addDays(today, -Math.max(...offsets)));
    const latest = parseDateOnly(addDays(today, -Math.min(...offsets)));
    return this.db.withTenant({ estateId, userId: null }, async (tx) => {
      const open = await tx.invoice.findMany({
        where: {
          estateId,
          status: { in: ['issued', 'partially_paid'] },
          dueDate: { gte: earliest, lte: latest },
        },
        select: { id: true, number: true, payerUserId: true, balance: true, dueDate: true },
        take: 10_000,
      });
      let sent = 0;
      for (const invoice of open) {
        for (const offset of remindersDue(dateOnly(invoice.dueDate), today, offsets)) {
          await this.notifications.request(tx, {
            intent: offset > 0 ? 'billing.invoice_overdue' : 'billing.invoice_reminder',
            userIds: [invoice.payerUserId],
            estateId,
            data: {
              number: invoice.number,
              amount: formatNaira(toKobo(invoice.balance)),
              dueDate: dateOnly(invoice.dueDate),
              invoiceId: invoice.id,
            },
            dedupeKey: `invoice-reminder:${invoice.id}:${offset}`,
          });
          sent += 1;
        }
      }
      return sent;
    });
  }

  /** Nightly check (billing.md §8): open invoice balances equal the receivable ledger balance. */
  async verifyBalances(estateId: string): Promise<boolean> {
    return this.db.withTenant({ estateId, userId: null }, async (tx) => {
      const invoices = await tx.invoice.aggregate({ where: { estateId }, _sum: { balance: true } });
      const ledger = await tx.ledgerEntry.aggregate({
        where: { estateId, account: { code: { startsWith: 'receivable:' } } },
        _sum: { debit: true, credit: true },
      });
      const invoiceTotal = toKobo(invoices._sum.balance ?? 0n);
      const ledgerTotal = sum([toKobo(ledger._sum.debit ?? 0n), -toKobo(ledger._sum.credit ?? 0n)]);
      if (invoiceTotal === ledgerTotal) return true;
      this.logger.error({
        msg: 'billing balances mismatch',
        estateId,
        difference: invoiceTotal - ledgerTotal,
      });
      await appendOutboxEvents(tx, [
        {
          type: 'billing.balances.mismatch_detected',
          estateId,
          aggregateType: 'estate',
          aggregateId: estateId,
          payload: { invoiceTotal, ledgerTotal },
        },
      ]);
      return false;
    });
  }
}
