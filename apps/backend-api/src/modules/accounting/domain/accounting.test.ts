import { describe, expect, it } from 'vitest';
import {
  buildBalanceSheet,
  buildCashFlowStatement,
  buildIncomeStatement,
  buildJournalsCsv,
  buildTrialBalanceCsv,
  computeBudgetLineMetrics,
  type AccountBalanceRow,
} from './accounting';

describe('accounting domain statements', () => {
  const balances: AccountBalanceRow[] = [
    {
      code: 'cash:bank',
      name: 'Bank',
      type: 'asset',
      debit: 500_000,
      credit: 120_000,
      balance: 380_000,
    },
    {
      code: 'payable:suppliers',
      name: 'AP',
      type: 'liability',
      debit: 0,
      credit: 80_000,
      balance: -80_000,
    },
    {
      code: 'income:estate_dues',
      name: 'Dues',
      type: 'income',
      debit: 0,
      credit: 500_000,
      balance: -500_000,
    },
    {
      code: 'expense:utilities',
      name: 'Utilities',
      type: 'expense',
      debit: 200_000,
      credit: 0,
      balance: 200_000,
    },
  ];

  it('builds a balanced income statement and balance sheet', () => {
    const pl = buildIncomeStatement(balances, '2026-11-01', '2026-11-30');
    expect(pl.totalIncomeKobo).toBe(500_000);
    expect(pl.totalExpensesKobo).toBe(200_000);
    expect(pl.netIncomeKobo).toBe(300_000);

    const bs = buildBalanceSheet(balances, '2026-11-30');
    expect(bs.totalAssetsKobo).toBe(380_000);
    expect(bs.totalLiabilitiesKobo).toBe(80_000);
    expect(bs.retainedEarningsKobo).toBe(300_000);
    expect(bs.totalAssetsKobo).toBe(bs.totalLiabilitiesKobo + bs.totalEquityKobo);
  });

  it('computes cash flow across cash:* accounts', () => {
    const cf = buildCashFlowStatement(
      [
        {
          code: 'cash:bank',
          name: 'Bank',
          type: 'asset',
          debit: 100_000,
          credit: 0,
          balance: 100_000,
        },
      ],
      balances,
      '2026-11-01',
      '2026-11-30',
    );
    expect(cf.openingCashKobo).toBe(100_000);
    expect(cf.inflowsKobo).toBe(500_000);
    expect(cf.outflowsKobo).toBe(120_000);
    expect(cf.closingCashKobo).toBe(480_000);
  });

  it('computes budget variance for expense and income accounts', () => {
    expect(computeBudgetLineMetrics('expense', 300_000, balances[3])).toEqual({
      actualKobo: 200_000,
      varianceKobo: 100_000,
    });
    expect(computeBudgetLineMetrics('income', 400_000, balances[2])).toEqual({
      actualKobo: 500_000,
      varianceKobo: 100_000,
    });
  });

  it('formats CSV exports cleanly', () => {
    const tbCsv = buildTrialBalanceCsv(balances);
    expect(tbCsv.split('\n')).toHaveLength(5);
    expect(tbCsv).toContain('cash:bank,Bank,asset,5000.00,1200.00,3800.00');

    const jCsv = buildJournalsCsv([
      {
        id: 'j1',
        postedAt: '2026-11-10T10:00:00.000Z',
        type: 'manual',
        reference: 'REF-1',
        description: 'Diesel, generator',
        lines: [
          { accountCode: 'expense:utilities', accountName: 'Utilities', debit: 10_000, credit: 0 },
        ],
      },
    ]);
    expect(jCsv).toContain('"Diesel, generator"');
    expect(jCsv).toContain('100.00,0.00');
  });
});
