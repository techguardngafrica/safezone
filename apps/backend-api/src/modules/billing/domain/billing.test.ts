import { describe, expect, it } from 'vitest';
import {
  accounts,
  allocateOldestFirst,
  assertBalanced,
  addDays,
  canReduceBy,
  computePenalty,
  computeCharge,
  daysInclusive,
  deriveInvoiceStatus,
  displayInvoiceStatus,
  formatInvoiceNumber,
  invoiceJournal,
  nextRunStatus,
  prorate,
  remindersDue,
  runNeedsApproval,
  todayInLagos,
  toKobo,
  waiverNeedsSecondApprover,
} from './billing';

const flat = { unitType: 'flat', bedrooms: 3, sizeSqm: 120.5 };

describe('amount rules', () => {
  it('fixed', () => {
    expect(computeCharge({ kind: 'fixed', amount: 2_500_000 }, flat)).toEqual({
      quantity: 1,
      unitAmount: 2_500_000,
      amount: 2_500_000,
    });
  });

  it('per unit type, with and without a fallback', () => {
    const rule = { kind: 'per_unit_type' as const, amounts: { flat: 1_000_000, house: 3_000_000 } };
    expect(computeCharge(rule, flat)?.amount).toBe(1_000_000);
    expect(computeCharge(rule, { ...flat, unitType: 'shop' })).toBeNull();
    expect(computeCharge(rule, { ...flat, unitType: null })).toBeNull();
    expect(
      computeCharge({ ...rule, otherwise: 500_000 }, { ...flat, unitType: 'shop' })?.amount,
    ).toBe(500_000);
  });

  it('per bedroom applies the minimum', () => {
    const rule = { kind: 'per_bedroom' as const, amount: 400_000, minimumBedrooms: 1 };
    expect(computeCharge(rule, flat)).toEqual({
      quantity: 3,
      unitAmount: 400_000,
      amount: 1_200_000,
    });
    expect(computeCharge(rule, { ...flat, bedrooms: null })?.amount).toBe(400_000);
    expect(computeCharge({ ...rule, minimumBedrooms: 0 }, { ...flat, bedrooms: 0 })).toBeNull();
  });

  it('metered bills consumption × rate plus the fixed charge, and skips units without a meter', () => {
    const rule = {
      kind: 'metered' as const,
      utility: 'electricity' as const,
      ratePerUnit: 20_900,
      fixedAmount: 50_000,
    };
    expect(computeCharge(rule, { ...flat, consumption: { electricity: 120.5 } })).toEqual({
      quantity: 120.5,
      unitAmount: 20_900,
      amount: Math.round(120.5 * 20_900) + 50_000,
    });
    expect(computeCharge(rule, flat)).toBeNull();
    expect(
      computeCharge(
        { ...rule, fixedAmount: undefined },
        { ...flat, consumption: { electricity: 0 } },
      ),
    ).toBeNull();
  });

  it('per sqm rounds once to the nearest kobo and skips units without a size', () => {
    const rule = { kind: 'per_sqm' as const, amount: 333 };
    expect(computeCharge(rule, flat)?.amount).toBe(Math.round(120.5 * 333));
    expect(computeCharge(rule, { ...flat, sizeSqm: null })).toBeNull();
  });
});

describe('proration', () => {
  const january = { start: '2027-01-01', end: '2027-01-31' };

  it('bills the full amount for a household there all period', () => {
    expect(prorate(3_100_000, january, { from: '2026-06-01' })).toEqual({
      amount: 3_100_000,
      days: 31,
      periodDays: 31,
    });
  });

  it('prorates by days for a mid-period move-in and move-out', () => {
    expect(prorate(3_100_000, january, { from: '2027-01-17' }).amount).toBe(1_500_000);
    expect(prorate(3_100_000, january, { from: '2027-01-01', to: '2027-01-10' }).amount).toBe(
      1_000_000,
    );
    expect(prorate(3_100_000, january, { from: '2027-02-01' }).amount).toBe(0);
  });

  it('counts days inclusively across a leap day', () => {
    expect(daysInclusive('2028-02-01', '2028-02-29')).toBe(29);
  });
});

describe('billing run status machine', () => {
  it('allows the documented transitions', () => {
    expect(nextRunStatus('draft', 'preview')).toBe('previewed');
    expect(nextRunStatus('previewed', 'preview')).toBe('previewed');
    expect(nextRunStatus('previewed', 'submit')).toBe('awaiting_approval');
    expect(nextRunStatus('previewed', 'submit', { approvalRequired: false })).toBe('approved');
    expect(nextRunStatus('awaiting_approval', 'approve')).toBe('approved');
    expect(nextRunStatus('approved', 'issue')).toBe('issued');
    for (const from of ['draft', 'previewed', 'awaiting_approval', 'approved'])
      expect(nextRunStatus(from, 'cancel')).toBe('cancelled');
  });

  it('rejects everything else', () => {
    expect(nextRunStatus('draft', 'submit')).toBeNull();
    expect(nextRunStatus('draft', 'issue')).toBeNull();
    expect(nextRunStatus('previewed', 'approve')).toBeNull();
    expect(nextRunStatus('awaiting_approval', 'preview')).toBeNull();
    expect(nextRunStatus('awaiting_approval', 'issue')).toBeNull();
    expect(nextRunStatus('approved', 'approve')).toBeNull();
    expect(nextRunStatus('issued', 'cancel')).toBeNull();
    expect(nextRunStatus('cancelled', 'preview')).toBeNull();
  });

  it('needs approval when two-level is on or the total is above the threshold', () => {
    expect(runNeedsApproval({ twoLevel: true, thresholdKobo: 10 }, 1)).toBe(true);
    expect(runNeedsApproval({ twoLevel: false, thresholdKobo: 10 }, 10)).toBe(false);
    expect(runNeedsApproval({ twoLevel: false, thresholdKobo: 10 }, 11)).toBe(true);
    expect(waiverNeedsSecondApprover(0, 1)).toBe(true);
    expect(waiverNeedsSecondApprover(5_000, 5_000)).toBe(false);
  });
});

describe('invoice status', () => {
  const base = { total: 10_000, amountPaid: 0, amountCredited: 0, amountWaived: 0 };

  it('derives the stored status from the amounts', () => {
    expect(deriveInvoiceStatus(base)).toBe('issued');
    expect(deriveInvoiceStatus({ ...base, amountPaid: 4_000 })).toBe('partially_paid');
    expect(deriveInvoiceStatus({ ...base, amountPaid: 4_000, amountWaived: 6_000 })).toBe('paid');
    expect(deriveInvoiceStatus({ ...base, amountWaived: 10_000 })).toBe('waived');
    expect(deriveInvoiceStatus({ ...base, amountCredited: 10_000 })).toBe('cancelled');
    expect(deriveInvoiceStatus({ ...base, amountCredited: 3_000 })).toBe('issued');
    expect(() => deriveInvoiceStatus({ ...base, amountPaid: 10_001 })).toThrow(RangeError);
  });

  it('shows open invoices past due as overdue', () => {
    expect(displayInvoiceStatus('issued', '2027-01-14', '2027-01-15')).toBe('overdue');
    expect(displayInvoiceStatus('partially_paid', '2027-01-14', '2027-01-15')).toBe('overdue');
    expect(displayInvoiceStatus('issued', '2027-01-15', '2027-01-15')).toBe('issued');
    expect(displayInvoiceStatus('paid', '2027-01-01', '2027-01-15')).toBe('paid');
    expect(displayInvoiceStatus('issued', '2027-02-01', '2027-01-15', true)).toBe('overdue');
    expect(displayInvoiceStatus('paid', '2027-02-01', '2027-01-15', true)).toBe('paid');
  });

  it('only reduces by what is still owed', () => {
    expect(canReduceBy({ ...base, amountPaid: 4_000 }, 6_000)).toBe(true);
    expect(canReduceBy({ ...base, amountPaid: 4_000 }, 6_001)).toBe(false);
    expect(canReduceBy(base, 0)).toBe(false);
  });

  it('formats numbers and WAT dates', () => {
    expect(formatInvoiceNumber(42)).toBe('INV-000042');
    // 23:30 UTC on 31 Dec is already 1 Jan in Lagos (UTC+1).
    expect(todayInLagos(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
    expect(toKobo(12_345n)).toBe(12_345);
    expect(() => toKobo(2n ** 60n)).toThrow(RangeError);
  });
});

describe('allocation', () => {
  const invoices = [
    { id: 'b', balance: 5_000, dueDate: '2027-02-14', issueDate: '2027-02-01', number: 'INV-2' },
    { id: 'a', balance: 3_000, dueDate: '2027-01-14', issueDate: '2027-01-01', number: 'INV-1' },
    { id: 'z', balance: 0, dueDate: '2026-12-14', issueDate: '2026-12-01', number: 'INV-0' },
  ];

  it('pays the oldest due invoice first and partially pays the next', () => {
    expect(allocateOldestFirst(invoices, 4_000)).toEqual({
      allocations: [
        { invoiceId: 'a', amount: 3_000 },
        { invoiceId: 'b', amount: 1_000 },
      ],
      remainder: 0,
    });
  });

  it('holds an overpayment as credit', () => {
    expect(allocateOldestFirst(invoices, 9_500).remainder).toBe(1_500);
    expect(allocateOldestFirst([], 100)).toEqual({ allocations: [], remainder: 100 });
  });

  it('rejects zero, negative and fractional amounts', () => {
    expect(() => allocateOldestFirst(invoices, 0)).toThrow(RangeError);
    expect(() => allocateOldestFirst(invoices, -1)).toThrow(RangeError);
    expect(() => allocateOldestFirst(invoices, 1.5)).toThrow(RangeError);
  });
});

describe('journals', () => {
  const receivable = accounts.receivable(
    '0190f0d0-0000-7000-8000-000000000001',
    '0190f0d0-0000-7000-8000-000000000002',
    'A-1',
  );

  it('posts an invoice as receivable against income per charge type', () => {
    const lines = invoiceJournal(receivable, [
      { chargeType: 'estate_dues', amount: 2_000 },
      { chargeType: 'security_levy', amount: 500 },
      { chargeType: 'estate_dues', amount: 1_000 },
    ]);
    expect(lines.map((line) => [line.account.code, line.debit, line.credit])).toEqual([
      [receivable.code, 3_500, 0],
      ['income:estate_dues', 0, 3_000],
      ['income:security_levy', 0, 500],
    ]);
    expect(() => assertBalanced(lines)).not.toThrow();
  });

  it('rejects unbalanced, one-line and two-sided journals', () => {
    expect(() =>
      assertBalanced([
        { account: receivable, debit: 100, credit: 0 },
        { account: accounts.waivers(), debit: 0, credit: 99 },
      ]),
    ).toThrow('does not balance');
    expect(() => assertBalanced([{ account: receivable, debit: 100, credit: 0 }])).toThrow();
    expect(() =>
      assertBalanced([
        { account: receivable, debit: 100, credit: 100 },
        { account: accounts.waivers(), debit: 0, credit: 0 },
      ]),
    ).toThrow(/positive debit/);
  });
});

describe('penalties and reminders', () => {
  it('applies percent and fixed rules to the unpaid share of each line', () => {
    const lines = [
      { amount: 8_000, rule: { kind: 'percent' as const, basisPoints: 1_000 } },
      { amount: 2_000, rule: { kind: 'fixed' as const, amount: 5_000 } },
      { amount: 1_000, rule: null },
    ];
    // Half unpaid: lines owe 4,000 / 1,000 / 500 → 10% of 4,000 + min(5,000, 1,000).
    expect(computePenalty(lines, { total: 11_000, balance: 5_500 })).toBe(400 + 1_000);
    expect(computePenalty(lines, { total: 11_000, balance: 0 })).toBe(0);
  });

  it('caps percentages', () => {
    expect(
      computePenalty(
        [{ amount: 100_000, rule: { kind: 'percent', basisPoints: 5_000, cap: 2_000 } }],
        {
          total: 100_000,
          balance: 100_000,
        },
      ),
    ).toBe(2_000);
  });

  it('finds reminders due today', () => {
    expect(remindersDue('2027-01-14', '2027-01-11', [-3, 0, 7])).toEqual([-3]);
    expect(remindersDue('2027-01-14', '2027-01-21', [-3, 0, 7])).toEqual([7]);
    expect(remindersDue('2027-01-14', '2027-01-15', [-3, 0, 7])).toEqual([]);
    expect(addDays('2027-02-27', 2)).toBe('2027-03-01');
  });
});
