import type { ApiData, ApiRow } from '@safezone/api-client';
import { formatKobo, type MessageKey, t } from '@safezone/i18n';
import type { Tone } from '@safezone/mobile-ui';

/** Marketplace and classifieds in the Resident App (marketplace.md, ADR-0023). Pure helpers. */

export type MarketListing = ApiRow<'/v1/estates/{estateId}/marketplace/listings', 'get'>;
export type ResidentOrder = ApiData<'/v1/estates/{estateId}/marketplace/orders/{id}', 'get'>;
export type OrderStatus = ResidentOrder['status'];
export type Classified = ApiRow<'/v1/estates/{estateId}/classifieds', 'get'>;

export const ORDER_TONE: Record<OrderStatus, Tone> = {
  requested: 'info',
  quoted: 'info',
  accepted: 'warning',
  scheduled: 'warning',
  in_progress: 'warning',
  completed: 'success',
  reviewed: 'success',
  declined: 'neutral',
  cancelled_by_resident: 'neutral',
  cancelled_by_vendor: 'neutral',
  disputed: 'danger',
  refunded: 'neutral',
};

export function orderStatusLabel(status: OrderStatus): string {
  return t(`res.market.status.${status}` as MessageKey);
}

/** Whole naira without ".00" for prices people scan quickly. */
export function nairaText(kobo: number): string {
  return formatKobo(kobo).replace(/\.00$/, '');
}

export function priceText(listing: {
  priceType: 'fixed' | 'from' | 'quote';
  priceKobo: number | null;
}): string {
  if (listing.priceType === 'quote' || listing.priceKobo === null) return t('res.market.onQuote');
  if (listing.priceType === 'from')
    return t('res.market.from', { price: nairaText(listing.priceKobo) });
  return nairaText(listing.priceKobo);
}

export function classifiedPriceText(item: {
  priceKobo: number | null;
  negotiable: boolean;
}): string {
  if (item.priceKobo === null) return t('res.classifieds.priceOnRequest');
  const price = nairaText(item.priceKobo);
  return item.negotiable ? t('res.classifieds.negotiable', { price }) : price;
}

const CANCELLABLE: readonly OrderStatus[] = ['requested', 'quoted', 'accepted', 'scheduled'];
const DISPUTABLE: readonly OrderStatus[] = ['accepted', 'scheduled', 'in_progress', 'completed'];

/** What the resident can do now; mirrors the API's state machine (the API still decides). */
export function residentActions(order: {
  status: OrderStatus;
  paid: boolean;
  amountKobo: number | null;
}) {
  return {
    acceptQuote: order.status === 'quoted',
    pay: order.status === 'accepted' && !order.paid && order.amountKobo !== null,
    cancel: CANCELLABLE.includes(order.status),
    review: order.status === 'completed',
    dispute: order.paid && DISPUTABLE.includes(order.status),
  };
}

/** What a vendor member can do now. `manage` is vendor.order.manage; others only start and complete. */
export function vendorActions(
  order: { status: OrderStatus; paid: boolean; amountKobo: number | null },
  manage: boolean,
) {
  const s = order.status;
  return {
    accept: manage && s === 'requested' && order.amountKobo !== null,
    quote: manage && (s === 'requested' || s === 'quoted'),
    decline: manage && (s === 'requested' || s === 'quoted'),
    schedule: manage && order.paid && (s === 'accepted' || s === 'scheduled'),
    start: order.paid && (s === 'accepted' || s === 'scheduled'),
    complete: s === 'in_progress',
    cancel: manage && (s === 'accepted' || s === 'scheduled'),
  };
}

/** Naira as typed (commas, ₦, up to 2 decimals) → positive integer kobo, else null. */
export function nairaToKobo(input: string): number | null {
  const cleaned = input.replace(/[,\s₦]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const kobo = Math.round(Number(cleaned) * 100);
  return Number.isSafeInteger(kobo) && kobo > 0 ? kobo : null;
}

/**
 * A WAT wall-clock date (YYYY-MM-DD) and time (HH:MM) as an ISO instant with the +01:00 offset, or null
 * when either is not a real date or time. WAT has no daylight saving.
 */
export function watInstant(date: string, time: string): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const tm = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time.trim());
  if (!d || !tm) return null;
  const [year, month, day] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  )
    return null;
  return `${d[1]}-${d[2]}-${d[3]}T${tm[1]}:${tm[2]}:00+01:00`;
}

let lastOrderId: string | null = null;
/** Remembered across the trip to the provider's checkout and back (safezone://marketplace/return). */
export function rememberOrder(id: string): void {
  lastOrderId = id;
}
export function lastOrder(): string | null {
  return lastOrderId;
}

let chosenVendorId: string | null = null;
/** The vendor account chosen in Vendor mode, kept while the app runs. */
export function chooseVendor(id: string): void {
  chosenVendorId = id;
}
export function chosenVendor(): string | null {
  return chosenVendorId;
}

const OPEN: readonly OrderStatus[] = [
  'requested',
  'quoted',
  'accepted',
  'scheduled',
  'in_progress',
  'disputed',
];
export function isOpenOrder(status: OrderStatus): boolean {
  return OPEN.includes(status);
}
