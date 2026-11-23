import type { LedgerAccountType } from '../../billing/domain/billing';

export interface DefaultAccountSeed {
  readonly code: string;
  readonly name: string;
  readonly type: LedgerAccountType;
  readonly description: string;
}

/** Standard Chart of Accounts seeded lazily for every estate on first accounting access. */
export const DEFAULT_COA: readonly DefaultAccountSeed[] = [
  {
    code: 'cash:bank',
    name: 'Estate Bank Account',
    type: 'asset',
    description: 'Primary estate bank account',
  },
  {
    code: 'cash:petty',
    name: 'Petty Cash',
    type: 'asset',
    description: 'On-site petty cash float',
  },
  {
    code: 'cash:paystack',
    name: 'Paystack Settlement',
    type: 'asset',
    description: 'Online payment collections',
  },
  {
    code: 'receivable:control',
    name: 'Accounts Receivable Control',
    type: 'asset',
    description: 'Resident and owner receivables',
  },
  {
    code: 'payable:suppliers',
    name: 'Accounts Payable (Suppliers)',
    type: 'liability',
    description: 'Unpaid supplier invoices',
  },
  {
    code: 'equity:retained_earnings',
    name: 'Retained Earnings',
    type: 'equity',
    description: 'Accumulated surplus / deficit',
  },
  {
    code: 'income:estate_dues',
    name: 'Estate Dues Income',
    type: 'income',
    description: 'Periodic estate dues',
  },
  {
    code: 'income:service_charge',
    name: 'Service Charge Income',
    type: 'income',
    description: 'Estate service charges',
  },
  {
    code: 'income:other',
    name: 'Other Income',
    type: 'income',
    description: 'Facility bookings and miscellaneous income',
  },
  {
    code: 'expense:maintenance',
    name: 'Repairs and Maintenance',
    type: 'expense',
    description: 'Repairs, parts and facility upkeep',
  },
  {
    code: 'expense:utilities',
    name: 'Estate Utilities and Diesel',
    type: 'expense',
    description: 'Power, water, generator fuel',
  },
  {
    code: 'expense:security',
    name: 'Security Operations',
    type: 'expense',
    description: 'Security contracts and equipment',
  },
  {
    code: 'expense:payroll',
    name: 'Staff Payroll and Benefits',
    type: 'expense',
    description: 'Estate staff salaries and allowances',
  },
  {
    code: 'expense:procurement',
    name: 'Procurement and Supplies',
    type: 'expense',
    description: 'Consumables and general purchases',
  },
  {
    code: 'expense:admin',
    name: 'Administration and Office',
    type: 'expense',
    description: 'Office, legal and audit expenses',
  },
];

export interface AccountBalanceRow {
  code: string;
  name: string;
  type: LedgerAccountType;
  debit: number;
  credit: number;
  balance: number;
}

/**
 * Income statement (P&L) for a date range.
 * Income accounts carry credit balances (credit - debit); expense accounts carry debit balances (debit - credit).
 */
export function buildIncomeStatement(
  balances: readonly AccountBalanceRow[],
  from: string,
  to: string,
) {
  const income = balances
    .filter((row) => row.type === 'income')
    .map((row) => ({ code: row.code, name: row.name, amountKobo: row.credit - row.debit }))
    .filter((row) => row.amountKobo !== 0);
  const expenses = balances
    .filter((row) => row.type === 'expense')
    .map((row) => ({ code: row.code, name: row.name, amountKobo: row.debit - row.credit }))
    .filter((row) => row.amountKobo !== 0);

  const totalIncomeKobo = income.reduce((acc, r) => acc + r.amountKobo, 0);
  const totalExpensesKobo = expenses.reduce((acc, r) => acc + r.amountKobo, 0);
  return {
    from,
    to,
    currency: 'NGN' as const,
    income,
    expenses,
    totalIncomeKobo,
    totalExpensesKobo,
    netIncomeKobo: totalIncomeKobo - totalExpensesKobo,
  };
}

/**
 * Balance sheet as of a date.
 * Assets = debit - credit; Liabilities & Equity = credit - debit.
 * Unclosed income/expense accounts roll into `retainedEarningsKobo` so Assets = Liabilities + Equity always holds.
 */
export function buildBalanceSheet(balances: readonly AccountBalanceRow[], asOf: string) {
  const assets = balances
    .filter((row) => row.type === 'asset')
    .map((row) => ({ code: row.code, name: row.name, amountKobo: row.debit - row.credit }))
    .filter((row) => row.amountKobo !== 0);
  const liabilities = balances
    .filter((row) => row.type === 'liability')
    .map((row) => ({ code: row.code, name: row.name, amountKobo: row.credit - row.debit }))
    .filter((row) => row.amountKobo !== 0);
  const equity = balances
    .filter((row) => row.type === 'equity')
    .map((row) => ({ code: row.code, name: row.name, amountKobo: row.credit - row.debit }))
    .filter((row) => row.amountKobo !== 0);

  const unclosedIncome = balances
    .filter((row) => row.type === 'income')
    .reduce((acc, row) => acc + (row.credit - row.debit), 0);
  const unclosedExpenses = balances
    .filter((row) => row.type === 'expense')
    .reduce((acc, row) => acc + (row.debit - row.credit), 0);
  const retainedEarningsKobo = unclosedIncome - unclosedExpenses;

  const totalAssetsKobo = assets.reduce((acc, r) => acc + r.amountKobo, 0);
  const totalLiabilitiesKobo = liabilities.reduce((acc, r) => acc + r.amountKobo, 0);
  const totalEquityKobo = equity.reduce((acc, r) => acc + r.amountKobo, 0) + retainedEarningsKobo;

  return {
    asOf,
    currency: 'NGN' as const,
    assets,
    liabilities,
    equity,
    retainedEarningsKobo,
    totalAssetsKobo,
    totalLiabilitiesKobo,
    totalEquityKobo,
  };
}

/** Cash flow statement across all `cash:*` asset accounts for a date range. */
export function buildCashFlowStatement(
  openingBalances: readonly AccountBalanceRow[],
  periodBalances: readonly AccountBalanceRow[],
  from: string,
  to: string,
) {
  const isCash = (row: AccountBalanceRow) => row.type === 'asset' && row.code.startsWith('cash:');
  const openingCashKobo = openingBalances
    .filter(isCash)
    .reduce((acc, r) => acc + (r.debit - r.credit), 0);

  const byAccount = periodBalances.filter(isCash).map((r) => ({
    code: r.code,
    name: r.name,
    inflowsKobo: r.debit,
    outflowsKobo: r.credit,
    netKobo: r.debit - r.credit,
  }));
  const inflowsKobo = byAccount.reduce((acc, r) => acc + r.inflowsKobo, 0);
  const outflowsKobo = byAccount.reduce((acc, r) => acc + r.outflowsKobo, 0);
  const netCashChangeKobo = inflowsKobo - outflowsKobo;

  return {
    from,
    to,
    currency: 'NGN' as const,
    openingCashKobo,
    inflowsKobo,
    outflowsKobo,
    netCashChangeKobo,
    closingCashKobo: openingCashKobo + netCashChangeKobo,
    byAccount,
  };
}

/** Actual spend/income for a budget line and its variance (allocated - actual for expenses; actual - allocated for income). */
export function computeBudgetLineMetrics(
  accountType: LedgerAccountType,
  allocatedKobo: number,
  row: AccountBalanceRow | undefined,
): { actualKobo: number; varianceKobo: number } {
  if (!row) {
    return {
      actualKobo: 0,
      varianceKobo: accountType === 'income' ? -allocatedKobo : allocatedKobo,
    };
  }
  const actualKobo =
    accountType === 'income' || accountType === 'liability' || accountType === 'equity'
      ? row.credit - row.debit
      : row.debit - row.credit;
  const varianceKobo =
    accountType === 'income' ? actualKobo - allocatedKobo : allocatedKobo - actualKobo;
  return { actualKobo, varianceKobo };
}

function csvCell(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function buildTrialBalanceCsv(balances: readonly AccountBalanceRow[]): string {
  const header = 'account_code,account_name,account_type,debit_ngn,credit_ngn,balance_ngn';
  const rows = balances.map((b) =>
    [
      b.code,
      b.name,
      b.type,
      (b.debit / 100).toFixed(2),
      (b.credit / 100).toFixed(2),
      (b.balance / 100).toFixed(2),
    ]
      .map(csvCell)
      .join(','),
  );
  return [header, ...rows].join('\n');
}

export function buildJournalsCsv(
  journals: readonly {
    id: string;
    postedAt: string;
    type: string;
    reference: string | null;
    description: string;
    lines: readonly {
      accountCode: string;
      accountName: string;
      debit: number;
      credit: number;
    }[];
  }[],
): string {
  const header =
    'journal_id,posted_at,type,reference,description,account_code,account_name,debit_ngn,credit_ngn';
  const rows: string[] = [];
  for (const j of journals) {
    for (const l of j.lines) {
      rows.push(
        [
          j.id,
          j.postedAt,
          j.type,
          j.reference ?? '',
          j.description,
          l.accountCode,
          l.accountName,
          (l.debit / 100).toFixed(2),
          (l.credit / 100).toFixed(2),
        ]
          .map(csvCell)
          .join(','),
      );
    }
  }
  return [header, ...rows].join('\n');
}
