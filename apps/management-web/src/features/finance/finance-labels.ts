import type { ApiData, ApiRow } from '@safezone/api-client';
import { formatKobo, type MessageKey, t } from '@safezone/i18n';
import type { Tone } from '@safezone/web-ui';

export type Charge = ApiData<'/v1/estates/{estateId}/charges/{id}', 'get'>;
export type AmountRule = Charge['amountRule'];
export type BillingRun = ApiData<'/v1/estates/{estateId}/billing-runs/{id}', 'get'>;
export type BillingRunItem = ApiRow<'/v1/estates/{estateId}/billing-runs/{id}/items', 'get'>;
export type Invoice = ApiRow<'/v1/estates/{estateId}/invoices', 'get'>;
export type InvoiceDetail = ApiData<'/v1/estates/{estateId}/invoices/{id}', 'get'>;
export type Waiver = ApiData<'/v1/estates/{estateId}/waivers', 'get'>[number];
export type Transaction = ApiRow<'/v1/estates/{estateId}/transactions', 'get'>;
export type ManualPayment = ApiData<'/v1/estates/{estateId}/manual-payments', 'get'>[number];

export const CHARGE_TYPES: Charge['type'][] = [
  'estate_dues',
  'service_charge',
  'maintenance_charge',
  'security_levy',
  'development_levy',
  'utility_charge',
  'special_assessment',
  'custom',
];
export const FREQUENCIES: Charge['frequency'][] = ['monthly', 'quarterly', 'annual', 'one_off'];
export const UNIT_TYPES = ['house', 'flat', 'shop', 'office', 'other'] as const;
export type UnitType = (typeof UNIT_TYPES)[number];

/** One line for a charge's amount rule, as shown in the charges table. */
export function amountRuleText(rule: AmountRule): string {
  switch (rule.kind) {
    case 'fixed':
      return formatKobo(rule.amount);
    case 'per_bedroom':
      return t('charge.ruleText.perBedroom', { amount: formatKobo(rule.amount) });
    case 'per_sqm':
      return t('charge.ruleText.perSqm', { amount: formatKobo(rule.amount) });
    case 'per_unit_type': {
      const amounts = Object.values(rule.amounts).filter((value): value is number => !!value);
      if (rule.otherwise) amounts.push(rule.otherwise);
      const lowest = amounts.length > 0 ? Math.min(...amounts) : 0;
      return t('charge.ruleText.perType', { amount: formatKobo(lowest) });
    }
    case 'metered':
      return t('charge.ruleText.metered', { amount: formatKobo(rule.ratePerUnit) });
  }
}

export function invoiceTone(status: Invoice['status']): Tone {
  switch (status) {
    case 'paid':
      return 'success';
    case 'overdue':
      return 'danger';
    case 'partially_paid':
      return 'warning';
    case 'issued':
      return 'info';
    default:
      return 'neutral';
  }
}

export function runTone(status: BillingRun['status']): Tone {
  switch (status) {
    case 'issued':
      return 'success';
    case 'awaiting_approval':
      return 'warning';
    case 'approved':
    case 'previewed':
      return 'info';
    default:
      return 'neutral';
  }
}

export function decisionTone(status: 'pending' | 'approved' | 'rejected'): Tone {
  if (status === 'approved') return 'success';
  if (status === 'rejected') return 'danger';
  return 'warning';
}

export const invoiceStatusLabel = (status: Invoice['status']) =>
  t(`invoice.status.${status}` as MessageKey);
export const runStatusLabel = (status: BillingRun['status']) =>
  t(`run.status.${status}` as MessageKey);

/** Today in WAT as YYYY-MM-DD, for date inputs and "not in the past" checks. */
export function todayWatDate(now = new Date()): string {
  return new Date(now.getTime() + 3_600_000).toISOString().slice(0, 10);
}

/** A WAT calendar date `days` from today. */
export function watDatePlus(days: number, now = new Date()): string {
  return todayWatDate(new Date(now.getTime() + days * 86_400_000));
}

/** "1 Jan 2027 to 31 Jan 2027". */
export function periodText(start: string, end: string, format: (iso: string) => string): string {
  return `${format(start)} to ${format(end)}`;
}
