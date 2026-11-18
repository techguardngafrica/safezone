import type { ApiData, ApiRow } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import type { Tone } from '@safezone/mobile-ui';

export type Invoice = ApiRow<'/v1/estates/{estateId}/invoices', 'get'>;
export type InvoiceDetail = ApiData<'/v1/estates/{estateId}/invoices/{id}', 'get'>;
export type PaymentIntent = ApiData<'/v1/estates/{estateId}/payment-intents/{id}', 'get'>;

const DAY = 86_400_000;
/** Today in WAT (UTC+1, no daylight saving) as YYYY-MM-DD, to compare with invoice due dates. */
export function todayWat(now = Date.now()): string {
  return new Date(now + 3_600_000).toISOString().slice(0, 10);
}

export const isOpenInvoice = (invoice: Invoice) =>
  invoice.status === 'issued' ||
  invoice.status === 'partially_paid' ||
  invoice.status === 'overdue';

/**
 * What a resident should read on a bill (UI_GUIDELINES §6.8 invoice tones): overdue and failed are
 * danger, due within 3 days is a warning, part-paid is info, paid is success.
 */
export function invoiceState(invoice: Invoice, now = Date.now()): { tone: Tone; label: string } {
  const today = todayWat(now);
  if (invoice.status === 'paid') return { tone: 'success', label: t('res.bills.state.paid') };
  if (invoice.status === 'waived') return { tone: 'neutral', label: t('res.bills.state.waived') };
  if (invoice.status === 'cancelled')
    return { tone: 'neutral', label: t('res.bills.state.cancelled') };
  if (invoice.status === 'overdue' || invoice.dueDate < today)
    return { tone: 'danger', label: t('res.bills.state.overdue') };
  const soon = new Date(`${invoice.dueDate}T00:00:00+01:00`).getTime() - now <= 3 * DAY;
  if (invoice.status === 'partially_paid')
    return { tone: 'info', label: t('res.bills.state.partial') };
  return soon
    ? { tone: 'warning', label: t('res.bills.state.dueSoon') }
    : { tone: 'neutral', label: t('res.bills.state.due') };
}

/** Last payment started in this app session, so the safezone://pay/return link can reopen it. */
let lastIntentId: string | null = null;
export const rememberIntent = (id: string) => {
  lastIntentId = id;
};
export const lastIntent = () => lastIntentId;
