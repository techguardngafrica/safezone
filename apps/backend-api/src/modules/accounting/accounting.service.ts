import { Injectable } from '@nestjs/common';
import type {
  accountingAsOfQuerySchema,
  accountingExportQuerySchema,
  accountingRangeQuerySchema,
  createBudgetSchema,
  createCoaAccountSchema,
  createExpenseSchema,
  createFinancialPeriodSchema,
  createManualJournalSchema,
  createPayableSchema,
  expenseListQuerySchema,
  importBankStatementSchema,
  matchBankLineSchema,
  payableListQuerySchema,
  payPayableSchema,
  reverseJournalSchema,
  updateCoaAccountSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import type { EstateAccess } from '../../common/auth/auth.decorators';
import { DatabaseService } from '../../common/database/database.service';
import type { Tx } from '../../common/database/tenant-context';
import { ConflictError, DomainError, NotFoundError } from '../../common/errors/domain-error';
import { uuidv7 } from '../../common/ids/uuidv7';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import {
  assertBalanced,
  dateOnly,
  parseDateOnly,
  todayInLagos,
  toKobo,
  type JournalLine,
  type LedgerAccountType,
} from '../billing/domain/billing';
import { LedgerService } from '../billing/ledger.service';
import {
  buildBalanceSheet,
  buildCashFlowStatement,
  buildIncomeStatement,
  buildJournalsCsv,
  buildTrialBalanceCsv,
  computeBudgetLineMetrics,
  DEFAULT_COA,
} from './domain/accounting';

const cursorSchema = z.object({ createdAt: z.iso.datetime(), id: z.uuid() });

function dayBefore(dateStr: string): string {
  const d = parseDateOnly(dateStr);
  d.setUTCDate(d.getUTCDate() - 1);
  return dateOnly(d);
}

/**
 * Full accounting & general ledger (billing.md Phase 5, ADR-0026).
 * Owns CoA metadata, financial periods, budgets, expenses, payables and bank reconciliation,
 * and posts all double-entry journals exclusively through Billing's LedgerService.
 */
@Injectable()
export class AccountingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly ledger: LedgerService,
  ) {}

  // ---- Chart of Accounts ------------------------------------------------------------------------

  async listAccounts(access: EstateAccess) {
    return this.db.withTenant(access, async (tx) => {
      await this.ensureDefaultCoa(tx, access.estateId);
      const rows = await tx.coaAccount.findMany({
        where: { estateId: access.estateId },
        orderBy: [{ type: 'asc' }, { code: 'asc' }],
      });
      return rows.map((row) => this.coaView(row));
    });
  }

  async createAccount(access: EstateAccess, input: z.infer<typeof createCoaAccountSchema>) {
    return this.db.withTenant(access, async (tx) => {
      await this.ensureDefaultCoa(tx, access.estateId);
      const code = input.code.toLowerCase();
      const existing = await tx.coaAccount.findUnique({
        where: { estateId_code: { estateId: access.estateId, code } },
      });
      if (existing) throw new ConflictError('ACCOUNT_CODE_EXISTS', 'Account code already exists');
      const row = await tx.coaAccount.create({
        data: {
          estateId: access.estateId,
          code,
          name: input.name,
          type: input.type,
          parentCode: input.parentCode ?? null,
          description: input.description ?? null,
        },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'accounting.account.created',
          estateId: access.estateId,
          aggregateType: 'coa_account',
          aggregateId: row.id,
          payload: { code: row.code, type: row.type },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'accounting.account.create',
            resourceType: 'coa_account',
            resourceId: row.id,
            after: { code: row.code, name: row.name, type: row.type },
          },
        },
      ]);
      return this.coaView(row);
    });
  }

  async updateAccount(
    access: EstateAccess,
    accountId: string,
    input: z.infer<typeof updateCoaAccountSchema>,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const row = await tx.coaAccount.findFirst({
        where: { estateId: access.estateId, id: accountId },
      });
      if (!row) throw new NotFoundError('Account not found', 'ACCOUNT_NOT_FOUND');
      if (row.isSystem && input.archived === true) {
        throw new DomainError('SYSTEM_ACCOUNT_LOCKED', 'System accounts cannot be archived', 422);
      }
      const updated = await tx.coaAccount.update({
        where: { id: row.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.parentCode !== undefined ? { parentCode: input.parentCode } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.archived !== undefined
            ? { archivedAt: input.archived ? new Date() : null }
            : {}),
        },
      });
      return this.coaView(updated);
    });
  }

  private async ensureDefaultCoa(tx: Tx, estateId: string) {
    await tx.coaAccount.createMany({
      data: DEFAULT_COA.map((a) => ({
        estateId,
        code: a.code,
        name: a.name,
        type: a.type,
        description: a.description,
        isSystem: true,
      })),
      skipDuplicates: true,
    });
  }

  private async resolveActiveAccounts(tx: Tx, estateId: string, codes: readonly string[]) {
    await this.ensureDefaultCoa(tx, estateId);
    const normalised = [...new Set(codes.map((c) => c.toLowerCase()))];
    const rows = await tx.coaAccount.findMany({
      where: { estateId, code: { in: normalised } },
    });
    const map = new Map(rows.map((r) => [r.code, r]));
    for (const code of normalised) {
      const found = map.get(code);
      if (!found) {
        throw new DomainError(
          'ACCOUNT_NOT_FOUND',
          `Account ${code} is not in the chart of accounts`,
          422,
        );
      }
      if (found.archivedAt) {
        throw new DomainError('ACCOUNT_ARCHIVED', `Account ${code} is archived`, 422);
      }
    }
    return map;
  }

  private async assertPeriodOpen(tx: Tx, estateId: string, dateStr: string) {
    const d = parseDateOnly(dateStr);
    const closed = await tx.financialPeriod.findFirst({
      where: {
        estateId,
        status: 'closed',
        startsOn: { lte: d },
        endsOn: { gte: d },
      },
      select: { name: true },
    });
    if (closed) {
      throw new ConflictError(
        'FINANCIAL_PERIOD_CLOSED',
        `Financial period "${closed.name}" is closed for ${dateStr}`,
      );
    }
  }

  // ---- Journals ---------------------------------------------------------------------------------

  async listJournals(access: EstateAccess, range?: { from?: string; to?: string }) {
    return this.db.withTenant(access, (tx) =>
      this.ledger.journalsInRangeInTx(tx, access.estateId, range?.from, range?.to, 200),
    );
  }

  async createManualJournal(
    access: EstateAccess,
    input: z.infer<typeof createManualJournalSchema>,
  ) {
    const occurredOn = input.occurredOn ?? todayInLagos();
    return this.db.withTenant(access, async (tx) => {
      await this.assertPeriodOpen(tx, access.estateId, occurredOn);
      const accounts = await this.resolveActiveAccounts(
        tx,
        access.estateId,
        input.lines.map((l) => l.accountCode),
      );
      const lines: JournalLine[] = input.lines.map((l) => {
        const acct = accounts.get(l.accountCode.toLowerCase())!;
        return {
          account: { code: acct.code, name: acct.name, type: acct.type as LedgerAccountType },
          debit: l.debit,
          credit: l.credit,
        };
      });
      try {
        assertBalanced(lines);
      } catch {
        throw new DomainError('UNBALANCED_JOURNAL', 'Total debits must equal total credits', 422);
      }
      const refId = uuidv7();
      const [journalId] = await this.ledger.post(tx, access.estateId, [
        {
          type: 'manual',
          description: input.description,
          sourceType: 'manual_journal',
          sourceId: refId,
          reference: input.reference ?? null,
          postedBy: access.userId,
          occurredAt: new Date(`${occurredOn}T12:00:00.000+01:00`),
          lines,
        },
      ]);
      await appendOutboxEvents(tx, [
        {
          type: 'accounting.journal.posted',
          estateId: access.estateId,
          aggregateType: 'journal',
          aggregateId: journalId!,
          payload: { journalId, type: 'manual' },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'accounting.journal.post',
            resourceType: 'journal',
            resourceId: journalId!,
            after: { description: input.description, occurredOn, lineCount: lines.length },
          },
        },
      ]);
      return (await this.ledger.findJournalInTx(tx, access.estateId, journalId!))!;
    });
  }

  async reverseJournal(
    access: EstateAccess,
    journalId: string,
    input: z.infer<typeof reverseJournalSchema>,
  ) {
    const occurredOn = input.occurredOn ?? todayInLagos();
    return this.db.withTenant(access, async (tx) => {
      await this.assertPeriodOpen(tx, access.estateId, occurredOn);
      const original = await this.ledger.findJournalInTx(tx, access.estateId, journalId);
      if (!original) throw new NotFoundError('Journal not found', 'JOURNAL_NOT_FOUND');
      const lines: JournalLine[] = original.lines.map((l) => ({
        account: { code: l.accountCode, name: l.accountName, type: l.accountType },
        debit: l.credit,
        credit: l.debit,
      }));
      const [revId] = await this.ledger.post(tx, access.estateId, [
        {
          type: 'reversal',
          description: `Reversal: ${original.description} (${input.reason})`,
          sourceType: 'journal_reversal',
          sourceId: original.id,
          reference: original.reference,
          postedBy: access.userId,
          reversesJournalId: original.id,
          occurredAt: new Date(`${occurredOn}T12:00:00.000+01:00`),
          lines,
        },
      ]);
      await appendOutboxEvents(tx, [
        {
          type: 'accounting.journal.reversed',
          estateId: access.estateId,
          aggregateType: 'journal',
          aggregateId: revId!,
          payload: { journalId: revId, reversesJournalId: original.id },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'accounting.journal.reverse',
            resourceType: 'journal',
            resourceId: revId!,
            reason: input.reason,
          },
        },
      ]);
      return (await this.ledger.findJournalInTx(tx, access.estateId, revId!))!;
    });
  }

  // ---- Financial Periods ------------------------------------------------------------------------

  async listPeriods(access: EstateAccess) {
    return this.db.withTenant(access, async (tx) => {
      const rows = await tx.financialPeriod.findMany({
        where: { estateId: access.estateId },
        orderBy: { startsOn: 'desc' },
      });
      return rows.map((row) => this.periodView(row));
    });
  }

  async createPeriod(access: EstateAccess, input: z.infer<typeof createFinancialPeriodSchema>) {
    return this.db.withTenant(access, async (tx) => {
      const startsOn = parseDateOnly(input.startsOn);
      const endsOn = parseDateOnly(input.endsOn);
      const overlap = await tx.financialPeriod.findFirst({
        where: {
          estateId: access.estateId,
          startsOn: { lte: endsOn },
          endsOn: { gte: startsOn },
        },
      });
      if (overlap) {
        throw new ConflictError('PERIOD_OVERLAP', `Dates overlap with period "${overlap.name}"`);
      }
      const row = await tx.financialPeriod.create({
        data: {
          estateId: access.estateId,
          name: input.name,
          startsOn,
          endsOn,
        },
      });
      return this.periodView(row);
    });
  }

  async closePeriod(access: EstateAccess, periodId: string) {
    return this.db.withTenant(access, async (tx) => {
      await this.ensureDefaultCoa(tx, access.estateId);
      const period = await tx.financialPeriod.findFirst({
        where: { estateId: access.estateId, id: periodId },
      });
      if (!period) throw new NotFoundError('Financial period not found', 'PERIOD_NOT_FOUND');
      if (period.status === 'closed') {
        throw new ConflictError('PERIOD_ALREADY_CLOSED', 'This financial period is already closed');
      }

      const from = dateOnly(period.startsOn);
      const to = dateOnly(period.endsOn);
      const balances = await this.ledger.balancesInTx(tx, access.estateId, { from, to });
      const lines: JournalLine[] = [];
      let netIncome = 0;

      for (const b of balances) {
        if (b.type === 'income') {
          const amount = b.credit - b.debit;
          if (amount > 0) {
            lines.push({
              account: { code: b.code, name: b.name, type: 'income' },
              debit: amount,
              credit: 0,
            });
            netIncome += amount;
          } else if (amount < 0) {
            lines.push({
              account: { code: b.code, name: b.name, type: 'income' },
              debit: 0,
              credit: -amount,
            });
            netIncome += amount;
          }
        } else if (b.type === 'expense') {
          const amount = b.debit - b.credit;
          if (amount > 0) {
            lines.push({
              account: { code: b.code, name: b.name, type: 'expense' },
              debit: 0,
              credit: amount,
            });
            netIncome -= amount;
          } else if (amount < 0) {
            lines.push({
              account: { code: b.code, name: b.name, type: 'expense' },
              debit: -amount,
              credit: 0,
            });
            netIncome -= amount;
          }
        }
      }

      let closingJournalId: string | null = null;
      if (lines.length > 0 && netIncome !== 0) {
        lines.push({
          account: {
            code: 'equity:retained_earnings',
            name: 'Retained Earnings',
            type: 'equity',
          },
          debit: netIncome < 0 ? -netIncome : 0,
          credit: netIncome > 0 ? netIncome : 0,
        });
        const [jId] = await this.ledger.post(tx, access.estateId, [
          {
            type: 'closing',
            description: `Close financial period ${period.name}`,
            sourceType: 'financial_period',
            sourceId: period.id,
            postedBy: access.userId,
            occurredAt: new Date(`${to}T23:00:00.000+01:00`),
            lines,
          },
        ]);
        closingJournalId = jId ?? null;
      }

      const updated = await tx.financialPeriod.update({
        where: { id: period.id },
        data: {
          status: 'closed',
          closedBy: access.userId,
          closedAt: new Date(),
          closingJournalId,
        },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'accounting.period.closed',
          estateId: access.estateId,
          aggregateType: 'financial_period',
          aggregateId: period.id,
          payload: { periodId: period.id, netIncomeKobo: netIncome, closingJournalId },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'accounting.period.close',
            resourceType: 'financial_period',
            resourceId: period.id,
            after: { status: 'closed', closingJournalId },
          },
        },
      ]);
      return this.periodView(updated);
    });
  }

  // ---- Budgets ----------------------------------------------------------------------------------

  async listBudgets(access: EstateAccess) {
    return this.db.withTenant(access, async (tx) => {
      await this.ensureDefaultCoa(tx, access.estateId);
      const budgets = await tx.budget.findMany({
        where: { estateId: access.estateId },
        include: { period: true, lines: true },
        orderBy: { createdAt: 'desc' },
      });
      const coa = await tx.coaAccount.findMany({ where: { estateId: access.estateId } });
      const coaMap = new Map(coa.map((a) => [a.code, a]));
      const results = [];
      for (const b of budgets) {
        const balances = await this.ledger.balancesInTx(tx, access.estateId, {
          from: dateOnly(b.period.startsOn),
          to: dateOnly(b.period.endsOn),
        });
        const balMap = new Map(balances.map((r) => [r.code, r]));
        const lines = b.lines.map((line) => {
          const acct = coaMap.get(line.accountCode);
          const type = (acct?.type ?? 'expense') as LedgerAccountType;
          const allocatedKobo = toKobo(line.allocatedKobo);
          const { actualKobo, varianceKobo } = computeBudgetLineMetrics(
            type,
            allocatedKobo,
            balMap.get(line.accountCode),
          );
          return {
            id: line.id,
            accountCode: line.accountCode,
            accountName: acct?.name ?? line.accountCode,
            accountType: type,
            allocatedKobo,
            actualKobo,
            varianceKobo,
            notes: line.notes,
          };
        });
        results.push({
          id: b.id,
          name: b.name,
          periodId: b.periodId,
          periodName: b.period.name,
          status: b.status as 'draft' | 'approved' | 'archived',
          totalAllocatedKobo: lines.reduce((s, l) => s + l.allocatedKobo, 0),
          totalActualKobo: lines.reduce((s, l) => s + l.actualKobo, 0),
          createdBy: b.createdBy,
          approvedBy: b.approvedBy,
          approvedAt: b.approvedAt ? b.approvedAt.toISOString() : null,
          createdAt: b.createdAt.toISOString(),
          lines,
        });
      }
      return results;
    });
  }

  async createBudget(access: EstateAccess, input: z.infer<typeof createBudgetSchema>) {
    return this.db.withTenant(access, async (tx) => {
      const period = await tx.financialPeriod.findFirst({
        where: { estateId: access.estateId, id: input.periodId },
      });
      if (!period) throw new NotFoundError('Financial period not found', 'PERIOD_NOT_FOUND');
      await this.resolveActiveAccounts(
        tx,
        access.estateId,
        input.lines.map((l) => l.accountCode),
      );
      const budget = await tx.budget.create({
        data: {
          estateId: access.estateId,
          name: input.name,
          periodId: period.id,
          createdBy: access.userId,
          lines: {
            create: input.lines.map((l) => ({
              estateId: access.estateId,
              accountCode: l.accountCode.toLowerCase(),
              allocatedKobo: BigInt(l.allocatedKobo),
              notes: l.notes ?? null,
            })),
          },
        },
        include: { period: true, lines: true },
      });
      const all = await this.listBudgetsInTx(tx, access.estateId, budget.id);
      return all[0]!;
    });
  }

  async approveBudget(access: EstateAccess, budgetId: string) {
    return this.db.withTenant(access, async (tx) => {
      const budget = await tx.budget.findFirst({
        where: { estateId: access.estateId, id: budgetId },
      });
      if (!budget) throw new NotFoundError('Budget not found', 'BUDGET_NOT_FOUND');
      if (budget.status !== 'draft') {
        throw new ConflictError('BUDGET_NOT_DRAFT', 'Only draft budgets can be approved');
      }
      if (budget.createdBy === access.userId) {
        throw new DomainError(
          'SELF_APPROVAL_FORBIDDEN',
          'The budget creator cannot approve their own budget',
          403,
        );
      }
      await tx.budget.update({
        where: { id: budget.id },
        data: { status: 'approved', approvedBy: access.userId, approvedAt: new Date() },
      });
      const all = await this.listBudgetsInTx(tx, access.estateId, budget.id);
      return all[0]!;
    });
  }

  private async listBudgetsInTx(tx: Tx, estateId: string, budgetId: string) {
    const b = await tx.budget.findFirstOrThrow({
      where: { estateId, id: budgetId },
      include: { period: true, lines: true },
    });
    const coa = await tx.coaAccount.findMany({ where: { estateId } });
    const coaMap = new Map(coa.map((a) => [a.code, a]));
    const balances = await this.ledger.balancesInTx(tx, estateId, {
      from: dateOnly(b.period.startsOn),
      to: dateOnly(b.period.endsOn),
    });
    const balMap = new Map(balances.map((r) => [r.code, r]));
    const lines = b.lines.map((line) => {
      const acct = coaMap.get(line.accountCode);
      const type = (acct?.type ?? 'expense') as LedgerAccountType;
      const allocatedKobo = toKobo(line.allocatedKobo);
      const { actualKobo, varianceKobo } = computeBudgetLineMetrics(
        type,
        allocatedKobo,
        balMap.get(line.accountCode),
      );
      return {
        id: line.id,
        accountCode: line.accountCode,
        accountName: acct?.name ?? line.accountCode,
        accountType: type,
        allocatedKobo,
        actualKobo,
        varianceKobo,
        notes: line.notes,
      };
    });
    return [
      {
        id: b.id,
        name: b.name,
        periodId: b.periodId,
        periodName: b.period.name,
        status: b.status as 'draft' | 'approved' | 'archived',
        totalAllocatedKobo: lines.reduce((s, l) => s + l.allocatedKobo, 0),
        totalActualKobo: lines.reduce((s, l) => s + l.actualKobo, 0),
        createdBy: b.createdBy,
        approvedBy: b.approvedBy,
        approvedAt: b.approvedAt ? b.approvedAt.toISOString() : null,
        createdAt: b.createdAt.toISOString(),
        lines,
      },
    ];
  }

  // ---- Expenses ---------------------------------------------------------------------------------

  async listExpenses(access: EstateAccess, query: z.infer<typeof expenseListQuerySchema>) {
    const after = query.cursor
      ? decodeCursor(
          query.cursor,
          (v): v is z.infer<typeof cursorSchema> => cursorSchema.safeParse(v).success,
        )
      : undefined;
    return this.db.withTenant(access, async (tx) => {
      const rows = await tx.expense.findMany({
        where: {
          estateId: access.estateId,
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
      const last = page.at(-1);
      return {
        items: page.map((r) => this.expenseView(r)),
        nextCursor:
          rows.length > query.limit && last
            ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
            : null,
      };
    });
  }

  async createExpense(access: EstateAccess, input: z.infer<typeof createExpenseSchema>) {
    return this.db.withTenant(access, async (tx) => {
      await this.assertPeriodOpen(tx, access.estateId, input.incurredOn);
      await this.resolveActiveAccounts(tx, access.estateId, [
        input.categoryAccountCode,
        input.cashAccountCode,
      ]);
      const count = await tx.expense.count({ where: { estateId: access.estateId } });
      const number = `EXP-${String(count + 1).padStart(6, '0')}`;
      const row = await tx.expense.create({
        data: {
          estateId: access.estateId,
          number,
          categoryAccountCode: input.categoryAccountCode.toLowerCase(),
          cashAccountCode: input.cashAccountCode.toLowerCase(),
          vendorName: input.vendorName,
          description: input.description,
          amountKobo: BigInt(input.amountKobo),
          incurredOn: parseDateOnly(input.incurredOn),
          receiptFileId: input.receiptFileId ?? null,
          status: 'submitted',
          requestedBy: access.userId,
        },
      });
      return this.expenseView(row);
    });
  }

  async approveExpense(access: EstateAccess, expenseId: string) {
    return this.db.withTenant(access, async (tx) => {
      const row = await tx.expense.findFirst({
        where: { estateId: access.estateId, id: expenseId },
      });
      if (!row) throw new NotFoundError('Expense not found', 'EXPENSE_NOT_FOUND');
      if (row.status !== 'submitted') {
        throw new ConflictError('EXPENSE_NOT_SUBMITTED', 'Only submitted expenses can be approved');
      }
      if (row.requestedBy === access.userId) {
        throw new DomainError(
          'SELF_APPROVAL_FORBIDDEN',
          'You cannot approve your own expense',
          403,
        );
      }
      const incurredOn = dateOnly(row.incurredOn);
      await this.assertPeriodOpen(tx, access.estateId, incurredOn);
      const accounts = await this.resolveActiveAccounts(tx, access.estateId, [
        row.categoryAccountCode,
        row.cashAccountCode,
      ]);
      const expAcct = accounts.get(row.categoryAccountCode)!;
      const cashAcct = accounts.get(row.cashAccountCode)!;
      const amount = toKobo(row.amountKobo);
      const [journalId] = await this.ledger.post(tx, access.estateId, [
        {
          type: 'expense',
          description: `${row.number}: ${row.vendorName} — ${row.description}`,
          sourceType: 'expense',
          sourceId: row.id,
          reference: row.number,
          postedBy: access.userId,
          occurredAt: new Date(`${incurredOn}T12:00:00.000+01:00`),
          lines: [
            {
              account: {
                code: expAcct.code,
                name: expAcct.name,
                type: expAcct.type as LedgerAccountType,
              },
              debit: amount,
              credit: 0,
            },
            {
              account: {
                code: cashAcct.code,
                name: cashAcct.name,
                type: cashAcct.type as LedgerAccountType,
              },
              debit: 0,
              credit: amount,
            },
          ],
        },
      ]);
      const updated = await tx.expense.update({
        where: { id: row.id },
        data: {
          status: 'posted',
          approvedBy: access.userId,
          approvedAt: new Date(),
          journalId: journalId!,
        },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'accounting.expense.posted',
          estateId: access.estateId,
          aggregateType: 'expense',
          aggregateId: row.id,
          payload: { expenseId: row.id, amountKobo: amount, journalId },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'accounting.expense.approve',
            resourceType: 'expense',
            resourceId: row.id,
            after: { status: 'posted', journalId },
          },
        },
      ]);
      return this.expenseView(updated);
    });
  }

  async rejectExpense(access: EstateAccess, expenseId: string, reason: string) {
    return this.db.withTenant(access, async (tx) => {
      const row = await tx.expense.findFirst({
        where: { estateId: access.estateId, id: expenseId },
      });
      if (!row) throw new NotFoundError('Expense not found', 'EXPENSE_NOT_FOUND');
      if (row.status !== 'submitted') {
        throw new ConflictError('EXPENSE_NOT_SUBMITTED', 'Only submitted expenses can be rejected');
      }
      const updated = await tx.expense.update({
        where: { id: row.id },
        data: { status: 'rejected', rejectionReason: reason },
      });
      return this.expenseView(updated);
    });
  }

  // ---- Payables ---------------------------------------------------------------------------------

  async listPayables(access: EstateAccess, query: z.infer<typeof payableListQuerySchema>) {
    const after = query.cursor
      ? decodeCursor(
          query.cursor,
          (v): v is z.infer<typeof cursorSchema> => cursorSchema.safeParse(v).success,
        )
      : undefined;
    return this.db.withTenant(access, async (tx) => {
      const rows = await tx.payable.findMany({
        where: {
          estateId: access.estateId,
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
        include: { payments: { orderBy: { createdAt: 'asc' } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      });
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        items: page.map((r) => this.payableView(r)),
        nextCursor:
          rows.length > query.limit && last
            ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
            : null,
      };
    });
  }

  async createPayable(access: EstateAccess, input: z.infer<typeof createPayableSchema>) {
    return this.db.withTenant(access, async (tx) => {
      const row = await this.createPayableInTx(tx, access.estateId, {
        ...input,
        requestedBy: access.userId,
        status: 'draft',
      });
      return this.payableView({ ...row, payments: [] });
    });
  }

  /** Exported for ProcurementModule when a 3-way matched supplier invoice is posted. */
  async createPayableFromProcurementInTx(
    tx: Tx,
    estateId: string,
    input: {
      supplierId: string;
      supplierName: string;
      poId: string;
      grnId: string;
      invoiceRef: string;
      expenseAccountCode?: string;
      amountKobo: number;
      dueOn: string;
      requestedBy: string;
    },
  ) {
    return this.createPayableInTx(tx, estateId, {
      supplierId: input.supplierId,
      supplierName: input.supplierName,
      poId: input.poId,
      grnId: input.grnId,
      invoiceRef: input.invoiceRef,
      expenseAccountCode: input.expenseAccountCode ?? 'expense:procurement',
      amountKobo: input.amountKobo,
      dueOn: input.dueOn,
      requestedBy: input.requestedBy,
      status: 'matched',
    });
  }

  private async createPayableInTx(
    tx: Tx,
    estateId: string,
    input: {
      supplierId?: string;
      supplierName: string;
      poId?: string;
      grnId?: string;
      invoiceRef: string;
      expenseAccountCode: string;
      amountKobo: number;
      dueOn: string;
      requestedBy: string | null;
      status: 'draft' | 'matched';
    },
  ) {
    await this.resolveActiveAccounts(tx, estateId, [input.expenseAccountCode, 'payable:suppliers']);
    const count = await tx.payable.count({ where: { estateId } });
    const number = `AP-${String(count + 1).padStart(6, '0')}`;
    return tx.payable.create({
      data: {
        estateId,
        number,
        supplierId: input.supplierId ?? null,
        supplierName: input.supplierName,
        poId: input.poId ?? null,
        grnId: input.grnId ?? null,
        invoiceRef: input.invoiceRef,
        expenseAccountCode: input.expenseAccountCode.toLowerCase(),
        amountKobo: BigInt(input.amountKobo),
        dueOn: parseDateOnly(input.dueOn),
        status: input.status,
        requestedBy: input.requestedBy,
      },
    });
  }

  async approvePayable(access: EstateAccess, payableId: string) {
    return this.db.withTenant(access, async (tx) => {
      const row = await tx.payable.findFirst({
        where: { estateId: access.estateId, id: payableId },
        include: { payments: true },
      });
      if (!row) throw new NotFoundError('Payable not found', 'PAYABLE_NOT_FOUND');
      if (row.status !== 'draft' && row.status !== 'matched') {
        throw new ConflictError('PAYABLE_NOT_APPROVABLE', 'This payable cannot be approved');
      }
      if (row.requestedBy && row.requestedBy === access.userId) {
        throw new DomainError(
          'SELF_APPROVAL_FORBIDDEN',
          'You cannot approve your own payable',
          403,
        );
      }
      const today = todayInLagos();
      await this.assertPeriodOpen(tx, access.estateId, today);
      const accounts = await this.resolveActiveAccounts(tx, access.estateId, [
        row.expenseAccountCode,
        'payable:suppliers',
      ]);
      const expAcct = accounts.get(row.expenseAccountCode)!;
      const apAcct = accounts.get('payable:suppliers')!;
      const amount = toKobo(row.amountKobo);
      const [journalId] = await this.ledger.post(tx, access.estateId, [
        {
          type: 'payable',
          description: `${row.number}: ${row.supplierName} (${row.invoiceRef})`,
          sourceType: 'payable',
          sourceId: row.id,
          reference: row.invoiceRef,
          postedBy: access.userId,
          lines: [
            {
              account: {
                code: expAcct.code,
                name: expAcct.name,
                type: expAcct.type as LedgerAccountType,
              },
              debit: amount,
              credit: 0,
            },
            {
              account: {
                code: apAcct.code,
                name: apAcct.name,
                type: apAcct.type as LedgerAccountType,
              },
              debit: 0,
              credit: amount,
            },
          ],
        },
      ]);
      const updated = await tx.payable.update({
        where: { id: row.id },
        data: {
          status: 'approved',
          approvedBy: access.userId,
          approvedAt: new Date(),
          journalId: journalId!,
        },
        include: { payments: true },
      });
      return this.payableView(updated);
    });
  }

  async payPayable(
    access: EstateAccess,
    payableId: string,
    input: z.infer<typeof payPayableSchema>,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const row = await tx.payable.findFirst({
        where: { estateId: access.estateId, id: payableId },
        include: { payments: true },
      });
      if (!row) throw new NotFoundError('Payable not found', 'PAYABLE_NOT_FOUND');
      if (row.status !== 'approved' && row.status !== 'partially_paid') {
        throw new ConflictError('PAYABLE_NOT_PAYABLE', 'Payable must be approved before payment');
      }
      const remaining = toKobo(row.amountKobo) - toKobo(row.amountPaidKobo);
      if (input.amountKobo > remaining) {
        throw new DomainError('OVERPAYMENT', 'Payment exceeds remaining payable balance', 422);
      }
      await this.assertPeriodOpen(tx, access.estateId, input.paidOn);
      const accounts = await this.resolveActiveAccounts(tx, access.estateId, [
        'payable:suppliers',
        input.cashAccountCode,
      ]);
      const apAcct = accounts.get('payable:suppliers')!;
      const cashAcct = accounts.get(input.cashAccountCode.toLowerCase())!;
      const [journalId] = await this.ledger.post(tx, access.estateId, [
        {
          type: 'payable_payment',
          description: `Pay ${row.number}: ${row.supplierName}`,
          sourceType: 'payable_payment',
          sourceId: row.id,
          reference: input.reference ?? row.invoiceRef,
          postedBy: access.userId,
          occurredAt: new Date(`${input.paidOn}T12:00:00.000+01:00`),
          lines: [
            {
              account: {
                code: apAcct.code,
                name: apAcct.name,
                type: apAcct.type as LedgerAccountType,
              },
              debit: input.amountKobo,
              credit: 0,
            },
            {
              account: {
                code: cashAcct.code,
                name: cashAcct.name,
                type: cashAcct.type as LedgerAccountType,
              },
              debit: 0,
              credit: input.amountKobo,
            },
          ],
        },
      ]);
      await tx.payablePayment.create({
        data: {
          estateId: access.estateId,
          payableId: row.id,
          amountKobo: BigInt(input.amountKobo),
          paidOn: parseDateOnly(input.paidOn),
          cashAccountCode: cashAcct.code,
          reference: input.reference ?? null,
          recordedBy: access.userId,
          journalId: journalId!,
        },
      });
      const newPaid = toKobo(row.amountPaidKobo) + input.amountKobo;
      const updated = await tx.payable.update({
        where: { id: row.id },
        data: {
          amountPaidKobo: BigInt(newPaid),
          status: newPaid >= toKobo(row.amountKobo) ? 'paid' : 'partially_paid',
        },
        include: { payments: { orderBy: { createdAt: 'asc' } } },
      });
      return this.payableView(updated);
    });
  }

  // ---- Bank Reconciliation ----------------------------------------------------------------------

  async listBankStatements(access: EstateAccess) {
    return this.db.withTenant(access, async (tx) => {
      const rows = await tx.bankStatement.findMany({
        where: { estateId: access.estateId },
        include: { lines: { orderBy: { txnDate: 'asc' } } },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map((s) => this.bankStatementView(s, true));
    });
  }

  async importBankStatement(
    access: EstateAccess,
    input: z.infer<typeof importBankStatementSchema>,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const cashCode = input.cashAccountCode.toLowerCase();
      await this.resolveActiveAccounts(tx, access.estateId, [cashCode]);
      const journals = await this.ledger.journalsInRangeInTx(
        tx,
        access.estateId,
        input.statementFrom,
        input.statementTo,
        1000,
      );
      const usedJournals = new Set<string>();

      const statement = await tx.bankStatement.create({
        data: {
          estateId: access.estateId,
          cashAccountCode: cashCode,
          name: input.name,
          statementFrom: parseDateOnly(input.statementFrom),
          statementTo: parseDateOnly(input.statementTo),
          openingBalanceKobo: BigInt(input.openingBalanceKobo),
          closingBalanceKobo: BigInt(input.closingBalanceKobo),
          importedBy: access.userId,
          lines: {
            create: input.lines.map((line) => {
              // Auto-match by cash account side (bank credit = cash debit; bank debit = cash credit) + amount
              const match = journals.find((j) => {
                if (usedJournals.has(j.id)) return false;
                return j.lines.some(
                  (jl) =>
                    jl.accountCode === cashCode &&
                    (line.direction === 'credit'
                      ? jl.debit === line.amountKobo
                      : jl.credit === line.amountKobo),
                );
              });
              if (match) usedJournals.add(match.id);
              return {
                estateId: access.estateId,
                txnDate: parseDateOnly(line.txnDate),
                description: line.description,
                reference: line.reference ?? null,
                amountKobo: BigInt(line.amountKobo),
                direction: line.direction,
                matchedJournalId: match?.id ?? null,
                status: match ? 'matched' : 'unmatched',
              };
            }),
          },
        },
        include: { lines: { orderBy: { txnDate: 'asc' } } },
      });
      return this.bankStatementView(statement, true);
    });
  }

  async matchBankLine(
    access: EstateAccess,
    lineId: string,
    input: z.infer<typeof matchBankLineSchema>,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const line = await tx.bankStatementLine.findFirst({
        where: { estateId: access.estateId, id: lineId },
      });
      if (!line) throw new NotFoundError('Bank statement line not found', 'BANK_LINE_NOT_FOUND');
      if (input.status === 'matched' && input.journalId) {
        const j = await this.ledger.findJournalInTx(tx, access.estateId, input.journalId);
        if (!j) throw new NotFoundError('Journal not found', 'JOURNAL_NOT_FOUND');
      }
      const updated = await tx.bankStatementLine.update({
        where: { id: line.id },
        data: {
          status: input.status,
          matchedJournalId: input.status === 'matched' ? (input.journalId ?? null) : null,
        },
      });
      return {
        id: updated.id,
        txnDate: dateOnly(updated.txnDate),
        description: updated.description,
        reference: updated.reference,
        amountKobo: toKobo(updated.amountKobo),
        direction: updated.direction as 'credit' | 'debit',
        matchedJournalId: updated.matchedJournalId,
        status: updated.status as 'unmatched' | 'matched' | 'ignored',
      };
    });
  }

  // ---- Financial Statements & Export ------------------------------------------------------------

  async incomeStatement(access: EstateAccess, query: z.infer<typeof accountingRangeQuerySchema>) {
    return this.db.withTenant(access, async (tx) => {
      const balances = await this.ledger.balancesInTx(tx, access.estateId, {
        from: query.from,
        to: query.to,
      });
      return buildIncomeStatement(balances, query.from, query.to);
    });
  }

  async balanceSheet(access: EstateAccess, query: z.infer<typeof accountingAsOfQuerySchema>) {
    return this.db.withTenant(access, async (tx) => {
      const balances = await this.ledger.balancesInTx(tx, access.estateId, { upTo: query.asOf });
      return buildBalanceSheet(balances, query.asOf);
    });
  }

  async cashFlow(access: EstateAccess, query: z.infer<typeof accountingRangeQuerySchema>) {
    return this.db.withTenant(access, async (tx) => {
      const [opening, period] = await Promise.all([
        this.ledger.balancesInTx(tx, access.estateId, { upTo: dayBefore(query.from) }),
        this.ledger.balancesInTx(tx, access.estateId, { from: query.from, to: query.to }),
      ]);
      return buildCashFlowStatement(opening, period, query.from, query.to);
    });
  }

  async exportCsv(access: EstateAccess, query: z.infer<typeof accountingExportQuerySchema>) {
    return this.db.withTenant(access, async (tx) => {
      if (query.kind === 'trial_balance') {
        const balances = await this.ledger.balancesInTx(tx, access.estateId, {
          from: query.from,
          to: query.to,
        });
        return {
          filename: `trial-balance-${query.from}-to-${query.to}.csv`,
          contentType: 'text/csv' as const,
          csv: buildTrialBalanceCsv(balances),
        };
      }
      const journals = await this.ledger.journalsInRangeInTx(
        tx,
        access.estateId,
        query.from,
        query.to,
        5000,
      );
      return {
        filename: `journals-${query.from}-to-${query.to}.csv`,
        contentType: 'text/csv' as const,
        csv: buildJournalsCsv(journals),
      };
    });
  }

  // ---- View helpers -----------------------------------------------------------------------------

  private coaView(row: {
    id: string;
    code: string;
    name: string;
    type: string;
    parentCode: string | null;
    description: string | null;
    isSystem: boolean;
    archivedAt: Date | null;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      type: row.type as LedgerAccountType,
      parentCode: row.parentCode,
      description: row.description,
      isSystem: row.isSystem,
      archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private periodView(row: {
    id: string;
    name: string;
    startsOn: Date;
    endsOn: Date;
    status: string;
    closedBy: string | null;
    closedAt: Date | null;
    closingJournalId: string | null;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      name: row.name,
      startsOn: dateOnly(row.startsOn),
      endsOn: dateOnly(row.endsOn),
      status: row.status as 'open' | 'closed',
      closedBy: row.closedBy,
      closedAt: row.closedAt ? row.closedAt.toISOString() : null,
      closingJournalId: row.closingJournalId,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private expenseView(row: {
    id: string;
    number: string;
    categoryAccountCode: string;
    cashAccountCode: string;
    vendorName: string;
    description: string;
    amountKobo: bigint;
    incurredOn: Date;
    receiptFileId: string | null;
    status: string;
    requestedBy: string;
    approvedBy: string | null;
    approvedAt: Date | null;
    rejectionReason: string | null;
    journalId: string | null;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      number: row.number,
      categoryAccountCode: row.categoryAccountCode,
      cashAccountCode: row.cashAccountCode,
      vendorName: row.vendorName,
      description: row.description,
      amountKobo: toKobo(row.amountKobo),
      incurredOn: dateOnly(row.incurredOn),
      receiptFileId: row.receiptFileId,
      status: row.status as 'draft' | 'submitted' | 'approved' | 'posted' | 'rejected',
      requestedBy: row.requestedBy,
      approvedBy: row.approvedBy,
      approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
      rejectionReason: row.rejectionReason,
      journalId: row.journalId,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private payableView(row: {
    id: string;
    number: string;
    supplierId: string | null;
    supplierName: string;
    poId: string | null;
    grnId: string | null;
    invoiceRef: string;
    expenseAccountCode: string;
    amountKobo: bigint;
    amountPaidKobo: bigint;
    dueOn: Date;
    status: string;
    requestedBy: string | null;
    approvedBy: string | null;
    approvedAt: Date | null;
    journalId: string | null;
    createdAt: Date;
    payments?: {
      id: string;
      amountKobo: bigint;
      paidOn: Date;
      cashAccountCode: string;
      reference: string | null;
      recordedBy: string;
      journalId: string;
      createdAt: Date;
    }[];
  }) {
    const amountKobo = toKobo(row.amountKobo);
    const amountPaidKobo = toKobo(row.amountPaidKobo);
    return {
      id: row.id,
      number: row.number,
      supplierId: row.supplierId,
      supplierName: row.supplierName,
      poId: row.poId,
      grnId: row.grnId,
      invoiceRef: row.invoiceRef,
      expenseAccountCode: row.expenseAccountCode,
      amountKobo,
      amountPaidKobo,
      balanceKobo: amountKobo - amountPaidKobo,
      dueOn: dateOnly(row.dueOn),
      status: row.status as 'draft' | 'matched' | 'approved' | 'partially_paid' | 'paid' | 'void',
      requestedBy: row.requestedBy,
      approvedBy: row.approvedBy,
      approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
      journalId: row.journalId,
      createdAt: row.createdAt.toISOString(),
      payments: row.payments?.map((p) => ({
        id: p.id,
        amountKobo: toKobo(p.amountKobo),
        paidOn: dateOnly(p.paidOn),
        cashAccountCode: p.cashAccountCode,
        reference: p.reference,
        recordedBy: p.recordedBy,
        journalId: p.journalId,
        createdAt: p.createdAt.toISOString(),
      })),
    };
  }

  private bankStatementView(
    s: {
      id: string;
      cashAccountCode: string;
      name: string;
      statementFrom: Date;
      statementTo: Date;
      openingBalanceKobo: bigint;
      closingBalanceKobo: bigint;
      createdAt: Date;
      lines: {
        id: string;
        txnDate: Date;
        description: string;
        reference: string | null;
        amountKobo: bigint;
        direction: string;
        matchedJournalId: string | null;
        status: string;
      }[];
    },
    includeLines: boolean,
  ) {
    const matchedCount = s.lines.filter((l) => l.status === 'matched').length;
    const unmatchedCount = s.lines.filter((l) => l.status === 'unmatched').length;
    return {
      id: s.id,
      cashAccountCode: s.cashAccountCode,
      name: s.name,
      statementFrom: dateOnly(s.statementFrom),
      statementTo: dateOnly(s.statementTo),
      openingBalanceKobo: toKobo(s.openingBalanceKobo),
      closingBalanceKobo: toKobo(s.closingBalanceKobo),
      matchedCount,
      unmatchedCount,
      createdAt: s.createdAt.toISOString(),
      ...(includeLines
        ? {
            lines: s.lines.map((l) => ({
              id: l.id,
              txnDate: dateOnly(l.txnDate),
              description: l.description,
              reference: l.reference,
              amountKobo: toKobo(l.amountKobo),
              direction: l.direction as 'credit' | 'debit',
              matchedJournalId: l.matchedJournalId,
              status: l.status as 'unmatched' | 'matched' | 'ignored',
            })),
          }
        : {}),
    };
  }
}
