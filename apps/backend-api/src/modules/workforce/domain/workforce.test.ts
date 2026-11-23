import { describe, expect, it } from 'vitest';
import { buildPayrollCsv, computeSalaryTotals } from './workforce';

describe('workforce domain rules', () => {
  it('computes gross, deductions and net pay in integer kobo', () => {
    const totals = computeSalaryTotals({
      basicKobo: 15_000_000,
      allowances: [
        { label: 'Housing', amountKobo: 3_000_000 },
        { label: 'Transport', amountKobo: 2_000_000 },
      ],
      deductions: [{ label: 'Pension', amountKobo: 1_200_000 }],
    });
    expect(totals).toEqual({
      grossKobo: 20_000_000,
      deductionsKobo: 1_200_000,
      netKobo: 18_800_000,
    });
  });

  it('builds a clean payroll CSV export', () => {
    const csv = buildPayrollCsv('2026-11', [
      {
        staffNumber: 'STF-001',
        jobTitle: 'Facility Manager',
        basicKobo: 15_000_000,
        grossKobo: 20_000_000,
        deductionsKobo: 1_200_000,
        netKobo: 18_800_000,
      },
    ]);
    expect(csv).toContain(
      '2026-11,STF-001,Facility Manager,150000.00,200000.00,12000.00,188000.00',
    );
  });
});
