import { Injectable } from '@nestjs/common';
import type { ledgerQuerySchema, statementQuerySchema } from '@safezone/schemas';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import { DatabaseService } from '../../common/database/database.service';
import type { TenantContext, Tx } from '../../common/database/tenant-context';
import { uuidv7 } from '../../common/ids/uuidv7';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import {
  type AccountRef,
  assertBalanced,
  type JournalLine,
  type LedgerAccountType,
  toKobo,
} from './domain/billing';

export interface JournalInput {
  type:
    | 'invoice'
    | 'payment'
    | 'credit_note'
    | 'waiver'
    | 'refund'
    | 'adjustment'
    | 'manual'
    | 'expense'
    | 'payable'
    | 'payable_payment'
    | 'closing'
    | 'reversal';
  description: string;
  sourceType: string;
  sourceId: string;
  reference?: string | null;
  postedBy: string | null;
  reversesJournalId?: string | null;
  occurredAt?: Date;
  lines: readonly JournalLine[];
}

const ledgerCursorSchema = z.object({ occurredAt: z.iso.datetime(), id: z.uuid() });
const STATEMENT_TYPES: Record<
  string,
  'invoice' | 'payment' | 'credit_note' | 'waiver' | 'adjustment'
> = { invoice: 'invoice', payment: 'payment', credit_note: 'credit_note', waiver: 'waiver' };

/** Start of a WAT calendar day as a UTC instant. */
function watStart(date: string): Date {
  return new Date(`${date}T00:00:00.000+01:00`);
}
function watEndExclusive(date: string): Date {
  return new Date(watStart(date).getTime() + 86_400_000);
}

/**
 * Double-entry ledger (billing.md §3). Journals and entries are append-only; the database rejects
 * unbalanced journals at commit. Balances are sums of entries (ADR-0012: no materialised balances yet).
 */
@Injectable()
export class LedgerService {
  constructor(private readonly db: DatabaseService) {}

  /** Posts journals in the caller's transaction. Returns their ids in input order. */
  async post(tx: Tx, estateId: string, journals: readonly JournalInput[]): Promise<string[]> {
    if (journals.length === 0) return [];
    for (const journal of journals) assertBalanced(journal.lines);
    const accountIds = await this.ensureAccounts(
      tx,
      estateId,
      journals.flatMap((journal) => journal.lines.map((line) => line.account)),
    );
    const now = new Date();
    const rows = journals.map((journal) => ({ id: uuidv7(), journal }));
    await tx.journal.createMany({
      data: rows.map(({ id, journal }) => ({
        id,
        estateId,
        type: journal.type,
        description: journal.description,
        sourceType: journal.sourceType,
        sourceId: journal.sourceId,
        reference: journal.reference ?? null,
        postedBy: journal.postedBy,
        reversesJournalId: journal.reversesJournalId ?? null,
        postedAt: journal.occurredAt ?? now,
      })),
    });
    await tx.ledgerEntry.createMany({
      data: rows.flatMap(({ id, journal }) =>
        journal.lines.map((line) => ({
          estateId,
          journalId: id,
          accountId: accountIds.get(line.account.code) as string,
          debit: BigInt(line.debit),
          credit: BigInt(line.credit),
          occurredAt: journal.occurredAt ?? now,
        })),
      ),
    });
    return rows.map((row) => row.id);
  }

  /** Creates missing accounts (codes are unique per estate) and returns code → id. */
  private async ensureAccounts(tx: Tx, estateId: string, refs: readonly AccountRef[]) {
    const unique = new Map(refs.map((ref) => [ref.code, ref]));
    await tx.ledgerAccount.createMany({
      data: [...unique.values()].map((ref) => ({
        estateId,
        code: ref.code,
        name: ref.name,
        type: ref.type,
        partyUserId: ref.partyUserId ?? null,
        spaceId: ref.spaceId ?? null,
      })),
      skipDuplicates: true,
    });
    const rows = await tx.ledgerAccount.findMany({
      where: { estateId, code: { in: [...unique.keys()] } },
      select: { id: true, code: true },
    });
    return new Map(rows.map((row) => [row.code, row.id]));
  }

  /** A payer's unallocated credit (overpayments not yet applied or refunded), in the caller's tx. */
  async creditBalance(tx: Tx, estateId: string, payerUserId: string): Promise<number> {
    const totals = await tx.ledgerEntry.aggregate({
      where: { estateId, account: { code: `credits:${payerUserId}` } },
      _sum: { debit: true, credit: true },
    });
    return toKobo(totals._sum.credit ?? 0n) - toKobo(totals._sum.debit ?? 0n);
  }

  /** Ledger lines for accountants, newest first, optionally one account (code prefix) and date range. */
  async entries(context: TenantContext, query: z.infer<typeof ledgerQuerySchema>) {
    const after = query.cursor
      ? decodeCursor(
          query.cursor,
          (value): value is z.infer<typeof ledgerCursorSchema> =>
            ledgerCursorSchema.safeParse(value).success,
        )
      : undefined;
    return this.db.withTenant(context, async (tx) => {
      const rows = await tx.ledgerEntry.findMany({
        where: {
          estateId: context.estateId,
          ...(query.account ? { account: { code: { startsWith: query.account } } } : {}),
          occurredAt: {
            ...(query.from ? { gte: watStart(query.from) } : {}),
            ...(query.to ? { lt: watEndExclusive(query.to) } : {}),
          },
          ...(after
            ? {
                OR: [
                  { occurredAt: { lt: new Date(after.occurredAt) } },
                  { occurredAt: new Date(after.occurredAt), id: { lt: after.id } },
                ],
              }
            : {}),
        },
        include: {
          account: { select: { code: true, name: true, type: true } },
          journal: { select: { type: true, description: true } },
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      });
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        items: page.map((row) => ({
          id: row.id,
          journalId: row.journalId,
          journalType: row.journal.type,
          description: row.journal.description,
          accountCode: row.account.code,
          accountName: row.account.name,
          accountType: row.account.type as LedgerAccountType,
          debit: toKobo(row.debit),
          credit: toKobo(row.credit),
          occurredAt: row.occurredAt.toISOString(),
        })),
        nextCursor:
          rows.length > query.limit && last
            ? encodeCursor({ occurredAt: last.occurredAt.toISOString(), id: last.id })
            : null,
      };
    });
  }

  /** Trial balance: debits, credits and balance per account. Total debits always equal total credits. */
  async balances(context: TenantContext) {
    return this.db.withTenant(context, async (tx) => {
      const sums = await tx.ledgerEntry.groupBy({
        by: ['accountId'],
        where: { estateId: context.estateId },
        _sum: { debit: true, credit: true },
      });
      const accounts = await tx.ledgerAccount.findMany({
        where: { estateId: context.estateId, id: { in: sums.map((row) => row.accountId) } },
        select: { id: true, code: true, name: true, type: true },
        orderBy: { code: 'asc' },
      });
      const byId = new Map(sums.map((row) => [row.accountId, row._sum]));
      return accounts.map((account) => {
        const total = byId.get(account.id);
        const debit = toKobo(total?.debit ?? 0n);
        const credit = toKobo(total?.credit ?? 0n);
        return {
          code: account.code,
          name: account.name,
          type: account.type as LedgerAccountType,
          debit,
          credit,
          balance: debit - credit,
        };
      });
    });
  }

  /**
   * Statement for a payer and/or unit from their receivable accounts (billing.md §2.9): opening balance,
   * every posting in the range with a running balance, and unallocated credit.
   */
  async statement(context: TenantContext, query: z.infer<typeof statementQuerySchema>) {
    return this.db.withTenant(context, async (tx) => {
      const party: Prisma.LedgerAccountWhereInput = {
        estateId: context.estateId,
        ...(query.payerUserId ? { partyUserId: query.payerUserId } : {}),
        ...(query.spaceId ? { spaceId: query.spaceId } : {}),
      };
      const receivables = await tx.ledgerAccount.findMany({
        where: { ...party, code: { startsWith: 'receivable:' } },
        select: { id: true },
      });
      const receivableIds = receivables.map((row) => row.id);
      const from = query.from ? watStart(query.from) : undefined;
      const to = query.to ? watEndExclusive(query.to) : undefined;

      const opening = from
        ? await tx.ledgerEntry.aggregate({
            where: {
              estateId: context.estateId,
              accountId: { in: receivableIds },
              occurredAt: { lt: from },
            },
            _sum: { debit: true, credit: true },
          })
        : null;
      let balance = opening
        ? toKobo(opening._sum.debit ?? 0n) - toKobo(opening._sum.credit ?? 0n)
        : 0;
      const openingBalance = balance;

      const entries = await tx.ledgerEntry.findMany({
        where: {
          estateId: context.estateId,
          accountId: { in: receivableIds },
          occurredAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) },
        },
        include: { journal: { select: { type: true, description: true, reference: true } } },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        take: 5000,
      });
      const lines = entries.map((entry) => {
        const debit = toKobo(entry.debit);
        const credit = toKobo(entry.credit);
        balance += debit - credit;
        return {
          date: entry.occurredAt.toISOString(),
          type: STATEMENT_TYPES[entry.journal.type] ?? 'adjustment',
          description: entry.journal.description,
          reference: entry.journal.reference,
          debit,
          credit,
          balance,
        };
      });

      // Credit is held per payer, not per unit.
      const credits = query.payerUserId
        ? await tx.ledgerEntry.aggregate({
            where: {
              estateId: context.estateId,
              account: { code: `credits:${query.payerUserId}` },
            },
            _sum: { debit: true, credit: true },
          })
        : null;
      const unallocatedCredit = credits
        ? toKobo(credits._sum.credit ?? 0n) - toKobo(credits._sum.debit ?? 0n)
        : 0;

      return {
        spaceId: query.spaceId ?? null,
        payerUserId: query.payerUserId ?? null,
        from: query.from ?? null,
        to: query.to ?? null,
        currency: 'NGN' as const,
        openingBalance,
        closingBalance: balance,
        unallocatedCredit,
        lines,
      };
    });
  }

  /** Account sums inside a caller's tenant transaction (used by AccountingModule for statements/budgets). */
  async balancesInTx(
    tx: Tx,
    estateId: string,
    range?: { from?: string; to?: string; upTo?: string },
  ) {
    const occurredAt: Prisma.DateTimeFilter | undefined = range
      ? {
          ...(range.from ? { gte: watStart(range.from) } : {}),
          ...(range.to ? { lt: watEndExclusive(range.to) } : {}),
          ...(range.upTo ? { lt: watEndExclusive(range.upTo) } : {}),
        }
      : undefined;
    const sums = await tx.ledgerEntry.groupBy({
      by: ['accountId'],
      where: { estateId, ...(occurredAt ? { occurredAt } : {}) },
      _sum: { debit: true, credit: true },
    });
    if (sums.length === 0) return [];
    const accounts = await tx.ledgerAccount.findMany({
      where: { estateId, id: { in: sums.map((row) => row.accountId) } },
      select: { id: true, code: true, name: true, type: true },
      orderBy: { code: 'asc' },
    });
    const byId = new Map(sums.map((row) => [row.accountId, row._sum]));
    return accounts.map((account) => {
      const total = byId.get(account.id);
      const debit = toKobo(total?.debit ?? 0n);
      const credit = toKobo(total?.credit ?? 0n);
      return {
        code: account.code,
        name: account.name,
        type: account.type as LedgerAccountType,
        debit,
        credit,
        balance: debit - credit,
      };
    });
  }

  /** Fetch one journal with its lines inside a caller's transaction (for reversals and reconciliation). */
  async findJournalInTx(tx: Tx, estateId: string, journalId: string) {
    const row = await tx.journal.findFirst({
      where: { estateId, id: journalId },
      include: {
        entries: {
          include: { account: { select: { code: true, name: true, type: true } } },
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!row) return null;
    return {
      id: row.id,
      type: row.type,
      description: row.description,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      reference: row.reference,
      postedBy: row.postedBy,
      reversesJournalId: row.reversesJournalId,
      postedAt: row.postedAt.toISOString(),
      lines: row.entries.map((entry) => ({
        accountCode: entry.account.code,
        accountName: entry.account.name,
        accountType: entry.account.type as LedgerAccountType,
        debit: toKobo(entry.debit),
        credit: toKobo(entry.credit),
      })),
    };
  }

  /** List journals with lines in a date range (for journal viewer, reconciliation matching and CSV export). */
  async journalsInRangeInTx(tx: Tx, estateId: string, from?: string, to?: string, limit = 500) {
    const rows = await tx.journal.findMany({
      where: {
        estateId,
        ...(from || to
          ? {
              postedAt: {
                ...(from ? { gte: watStart(from) } : {}),
                ...(to ? { lt: watEndExclusive(to) } : {}),
              },
            }
          : {}),
      },
      include: {
        entries: {
          include: { account: { select: { code: true, name: true, type: true } } },
          orderBy: { id: 'asc' },
        },
      },
      orderBy: [{ postedAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      description: row.description,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      reference: row.reference,
      postedBy: row.postedBy,
      reversesJournalId: row.reversesJournalId,
      postedAt: row.postedAt.toISOString(),
      lines: row.entries.map((entry) => ({
        accountCode: entry.account.code,
        accountName: entry.account.name,
        accountType: entry.account.type as LedgerAccountType,
        debit: toKobo(entry.debit),
        credit: toKobo(entry.credit),
      })),
    }));
  }
}
