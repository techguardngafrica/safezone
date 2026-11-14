import type { AmountRule } from '@safezone/schemas';

/**
 * Billing domain rules (billing.md §3, §5). Pure functions only: no I/O, no clock unless passed in.
 * Money is integer kobo throughout; rounding happens once, to the nearest kobo, per line.
 */

// ---- Money ---------------------------------------------------------------------------------------

/** Kobo from a bigint column, failing loudly rather than losing precision. */
export function toKobo(value: bigint): number {
  const kobo = Number(value);
  if (!Number.isSafeInteger(kobo)) throw new RangeError('Amount is outside the safe integer range');
  return kobo;
}

export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

// ---- Dates (WAT) ---------------------------------------------------------------------------------

const watDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Lagos',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's date in Lagos as YYYY-MM-DD (due dates and overdue checks are WAT calendar days). */
export function todayInLagos(now: Date = new Date()): string {
  return watDate.format(now);
}

/** A DATE column (midnight UTC) as YYYY-MM-DD. */
export function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

const DAY_MS = 86_400_000;

/** Calendar days from `from` to `to`, both included. */
export function daysInclusive(from: string, to: string): number {
  return Math.round((parseDateOnly(to).getTime() - parseDateOnly(from).getTime()) / DAY_MS) + 1;
}

// ---- Amount rules --------------------------------------------------------------------------------

export interface BillableUnit {
  unitType: string | null;
  bedrooms: number | null;
  sizeSqm: number | null;
  /** Metered consumption in the period by utility (estate-run supply); absent when the unit has no meter. */
  consumption?: Partial<Record<'electricity' | 'water' | 'gas', number>>;
}

export interface ComputedLine {
  quantity: number;
  unitAmount: number;
  amount: number;
}

/** What one charge costs one unit for a full period, or null when the rule does not apply to it. */
export function computeCharge(rule: AmountRule, unit: BillableUnit): ComputedLine | null {
  switch (rule.kind) {
    case 'fixed':
      return { quantity: 1, unitAmount: rule.amount, amount: rule.amount };
    case 'per_unit_type': {
      const byType = unit.unitType
        ? rule.amounts[unit.unitType as keyof typeof rule.amounts]
        : undefined;
      const amount = byType ?? rule.otherwise;
      return amount === undefined ? null : { quantity: 1, unitAmount: amount, amount };
    }
    case 'per_bedroom': {
      const bedrooms = Math.max(unit.bedrooms ?? 0, rule.minimumBedrooms);
      if (bedrooms === 0) return null;
      return { quantity: bedrooms, unitAmount: rule.amount, amount: bedrooms * rule.amount };
    }
    case 'per_sqm': {
      if (!unit.sizeSqm || unit.sizeSqm <= 0) return null;
      return {
        quantity: unit.sizeSqm,
        unitAmount: rule.amount,
        amount: Math.round(unit.sizeSqm * rule.amount),
      };
    }
    case 'metered': {
      const used = unit.consumption?.[rule.utility];
      if (used === undefined) return null;
      const amount = Math.round(used * rule.ratePerUnit) + (rule.fixedAmount ?? 0);
      return amount > 0 ? { quantity: used, unitAmount: rule.ratePerUnit, amount } : null;
    }
  }
}

/**
 * Prorates a full-period amount by days (billing.md rule 9) when billing starts or ends inside the
 * period, e.g. a household that moved in mid-month. Returns the amount and the fraction applied.
 */
export function prorate(
  amount: number,
  period: { start: string; end: string },
  billable: { from: string; to?: string | null },
): { amount: number; days: number; periodDays: number } {
  const periodDays = daysInclusive(period.start, period.end);
  const from = billable.from > period.start ? billable.from : period.start;
  const to = billable.to && billable.to < period.end ? billable.to : period.end;
  const days = from > to ? 0 : daysInclusive(from, to);
  if (days >= periodDays) return { amount, days: periodDays, periodDays };
  return { amount: Math.round((amount * days) / periodDays), days, periodDays };
}

// ---- Billing runs --------------------------------------------------------------------------------

export type BillingRunStatus =
  'draft' | 'previewed' | 'awaiting_approval' | 'approved' | 'issued' | 'cancelled';
export type BillingRunAction = 'preview' | 'submit' | 'approve' | 'issue' | 'cancel';

const RUN_TRANSITIONS: Record<
  Exclude<BillingRunAction, 'submit'>,
  { from: readonly BillingRunStatus[]; to: BillingRunStatus }
> = {
  // Re-previewing is allowed until someone submits it.
  preview: { from: ['draft', 'previewed'], to: 'previewed' },
  approve: { from: ['awaiting_approval'], to: 'approved' },
  issue: { from: ['approved'], to: 'issued' },
  cancel: { from: ['draft', 'previewed', 'awaiting_approval', 'approved'], to: 'cancelled' },
};

/**
 * The status after an action, or null when the action is not allowed. Submitting goes straight to
 * approved when no approval is required.
 */
export function nextRunStatus(
  current: string,
  action: BillingRunAction,
  options: { approvalRequired?: boolean } = {},
): BillingRunStatus | null {
  if (action === 'submit') {
    if (current !== 'previewed') return null;
    return options.approvalRequired === false ? 'approved' : 'awaiting_approval';
  }
  const transition = RUN_TRANSITIONS[action];
  return (transition.from as readonly string[]).includes(current) ? transition.to : null;
}

export interface ApprovalSettings {
  twoLevel: boolean;
  thresholdKobo: number;
}

/** billing.md rule 3: approval when two-level is on, or when the run is above the threshold. */
export function runNeedsApproval(settings: ApprovalSettings, totalKobo: number): boolean {
  return settings.twoLevel || totalKobo > settings.thresholdKobo;
}

/** billing.md rule 6: waivers above the threshold need someone other than the requester. */
export function waiverNeedsSecondApprover(thresholdKobo: number, amountKobo: number): boolean {
  return amountKobo > thresholdKobo;
}

// ---- Invoices ------------------------------------------------------------------------------------

export type StoredInvoiceStatus = 'issued' | 'partially_paid' | 'paid' | 'waived' | 'cancelled';
export type InvoiceStatus = StoredInvoiceStatus | 'overdue';

export interface InvoiceAmounts {
  total: number;
  amountPaid: number;
  amountCredited: number;
  amountWaived: number;
}

export function invoiceBalance(amounts: InvoiceAmounts): number {
  return amounts.total - amounts.amountPaid - amounts.amountCredited - amounts.amountWaived;
}

/**
 * Stored status from the amounts. A settled invoice is `paid` if any money came in, `waived` if
 * waivers cleared it, otherwise `cancelled` (fully credited).
 */
export function deriveInvoiceStatus(amounts: InvoiceAmounts): StoredInvoiceStatus {
  const balance = invoiceBalance(amounts);
  if (balance < 0) throw new RangeError('Invoice balance cannot be negative');
  if (balance > 0) return amounts.amountPaid > 0 ? 'partially_paid' : 'issued';
  if (amounts.amountPaid > 0) return 'paid';
  if (amounts.amountWaived > 0) return 'waived';
  return amounts.total === 0 ? 'paid' : 'cancelled';
}

/** What clients see: open invoices past their due date (WAT) are overdue. */
export function displayInvoiceStatus(
  stored: string,
  dueDate: string,
  today: string,
  markedOverdue = false,
): InvoiceStatus {
  const open = stored === 'issued' || stored === 'partially_paid';
  if (open && (markedOverdue || dueDate < today)) return 'overdue';
  return stored as StoredInvoiceStatus;
}

/** Whether a credit note or waiver of `amount` fits what is still owed. */
export function canReduceBy(amounts: InvoiceAmounts, amount: number): boolean {
  return amount > 0 && amount <= invoiceBalance(amounts);
}

export function formatInvoiceNumber(sequence: number): string {
  return `INV-${String(sequence).padStart(6, '0')}`;
}

// ---- Penalties -----------------------------------------------------------------------------------

export type PenaltyRuleInput =
  | { kind: 'fixed'; amount: number }
  | { kind: 'percent'; basisPoints: number; cap?: number | undefined };

/**
 * Late penalty for an invoice (billing.md §2.6, rule 5): each line whose charge has a rule contributes,
 * on its share of what is still unpaid. Fixed amounts never exceed that share; percentages are capped.
 */
export function computePenalty(
  lines: readonly { amount: number; rule: PenaltyRuleInput | null }[],
  invoice: { total: number; balance: number },
): number {
  if (invoice.balance <= 0 || invoice.total <= 0) return 0;
  let penalty = 0;
  for (const line of lines) {
    if (!line.rule || line.amount <= 0) continue;
    const unpaid = Math.round((line.amount * invoice.balance) / invoice.total);
    if (unpaid <= 0) continue;
    if (line.rule.kind === 'fixed') penalty += Math.min(line.rule.amount, unpaid);
    else {
      const raw = Math.round((unpaid * line.rule.basisPoints) / 10_000);
      penalty += line.rule.cap === undefined ? raw : Math.min(raw, line.rule.cap);
    }
  }
  return penalty;
}

/** YYYY-MM-DD plus a number of days. */
export function addDays(date: string, days: number): string {
  return dateOnly(new Date(parseDateOnly(date).getTime() + days * DAY_MS));
}

/** Reminder offsets (days from due) that fall on `today` for an invoice due on `dueDate`. */
export function remindersDue(dueDate: string, today: string, offsets: readonly number[]): number[] {
  return offsets.filter((offset) => addDays(dueDate, offset) === today);
}

// ---- Allocation ----------------------------------------------------------------------------------

export interface OpenInvoice {
  id: string;
  balance: number;
  dueDate: string;
  issueDate: string;
  number: string;
}

/**
 * Applies a payment to open invoices, oldest due date first (billing.md §2.5), then issue date and
 * number. What is left over is held as the payer's credit.
 */
export function allocateOldestFirst(
  invoices: readonly OpenInvoice[],
  amount: number,
): { allocations: { invoiceId: string; amount: number }[]; remainder: number } {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new RangeError('Amount must be positive');
  const ordered = invoices
    .filter((invoice) => invoice.balance > 0)
    .sort(
      (a, b) =>
        a.dueDate.localeCompare(b.dueDate) ||
        a.issueDate.localeCompare(b.issueDate) ||
        a.number.localeCompare(b.number),
    );
  const allocations: { invoiceId: string; amount: number }[] = [];
  let remainder = amount;
  for (const invoice of ordered) {
    if (remainder === 0) break;
    const applied = Math.min(invoice.balance, remainder);
    allocations.push({ invoiceId: invoice.id, amount: applied });
    remainder -= applied;
  }
  return { allocations, remainder };
}

// ---- Ledger --------------------------------------------------------------------------------------

export type LedgerAccountType = 'asset' | 'liability' | 'income' | 'expense' | 'equity';

export interface AccountRef {
  code: string;
  name: string;
  type: LedgerAccountType;
  partyUserId?: string | null;
  spaceId?: string | null;
}

export interface JournalLine {
  account: AccountRef;
  debit: number;
  credit: number;
}

export const accounts = {
  receivable: (payerUserId: string, spaceId: string, unitCode: string): AccountRef => ({
    code: `receivable:${payerUserId}:${spaceId}`,
    name: `Receivable ${unitCode}`,
    type: 'asset',
    partyUserId: payerUserId,
    spaceId,
  }),
  income: (chargeType: string): AccountRef => ({
    code: `income:${chargeType}`,
    name: `Income: ${chargeType.replaceAll('_', ' ')}`,
    type: 'income',
  }),
  /** Contra-income: credit notes reduce income rather than counting as an expense. */
  incomeAdjustments: (): AccountRef => ({
    code: 'income_adjustments',
    name: 'Income adjustments (credit notes)',
    type: 'income',
  }),
  waivers: (): AccountRef => ({ code: 'waivers', name: 'Waivers', type: 'expense' }),
  cash: (channel: string): AccountRef => ({
    code: `cash:${channel}`,
    name: `Cash: ${channel.replaceAll('_', ' ')}`,
    type: 'asset',
  }),
  credits: (payerUserId: string): AccountRef => ({
    code: `credits:${payerUserId}`,
    name: 'Payer credit',
    type: 'liability',
    partyUserId: payerUserId,
  }),
};

/** Throws unless the lines balance, every line is one-sided and amounts are positive integers. */
export function assertBalanced(lines: readonly JournalLine[]): void {
  if (lines.length < 2) throw new RangeError('A journal needs at least two lines');
  for (const line of lines) {
    const oneSided = line.debit > 0 !== line.credit > 0;
    if (!oneSided || !Number.isSafeInteger(line.debit) || !Number.isSafeInteger(line.credit)) {
      throw new RangeError('Each journal line is a positive debit or a positive credit');
    }
  }
  const debits = sum(lines.map((line) => line.debit));
  const credits = sum(lines.map((line) => line.credit));
  if (debits !== credits) throw new RangeError('Journal does not balance');
}

/** Invoice issued: Dr receivable / Cr income per charge type (billing.md §3). */
export function invoiceJournal(
  receivable: AccountRef,
  lines: readonly { chargeType: string; amount: number }[],
): JournalLine[] {
  const byType = new Map<string, number>();
  for (const line of lines)
    byType.set(line.chargeType, (byType.get(line.chargeType) ?? 0) + line.amount);
  const total = sum([...byType.values()]);
  return [
    { account: receivable, debit: total, credit: 0 },
    ...[...byType.entries()]
      .filter(([, amount]) => amount > 0)
      .map(([chargeType, amount]) => ({
        account: accounts.income(chargeType),
        debit: 0,
        credit: amount,
      })),
  ];
}
