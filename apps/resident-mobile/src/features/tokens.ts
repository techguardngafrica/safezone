import type { ApiData, ApiRow } from '@safezone/api-client';
import { formatKobo } from '@safezone/i18n';
import type { Tone } from '@safezone/mobile-ui';

export type TokenPurchase = ApiData<'/v1/estates/{estateId}/utility-purchases/{id}', 'get'>;
export type TokenPurchaseRow = ApiRow<'/v1/estates/{estateId}/utility-purchases', 'get'>;

export const TOKEN_TONE: Record<TokenPurchase['status'], Tone> = {
  created: 'neutral',
  paid: 'info',
  vending: 'info',
  vended: 'success',
  failed: 'neutral',
  refund_pending: 'warning',
  refunded: 'neutral',
};

/** Statuses still moving on the server: the screen keeps checking. */
export function isInProgress(status: TokenPurchase['status']): boolean {
  return status === 'created' || status === 'paid' || status === 'vending';
}

/** Quick amounts in kobo (₦1,000, ₦2,000, ₦5,000, ₦10,000). */
export const QUICK_AMOUNTS = [100_000, 200_000, 500_000, 1_000_000] as const;

/** "3500" or "3,500" naira → kobo; null when not a whole naira amount. */
export function nairaToKobo(input: string): number | null {
  const clean = input.replace(/[,\s₦]/g, '');
  if (!/^\d{1,7}$/.test(clean)) return null;
  return Number(clean) * 100;
}

export function amountOk(kobo: number | null, minKobo: number, maxKobo: number): boolean {
  return kobo !== null && kobo % 100 === 0 && kobo >= minKobo && kobo <= maxKobo;
}

export function nairaText(kobo: number): string {
  return formatKobo(kobo).replace(/\.00$/, '');
}

let lastPurchaseId: string | null = null;
/** Remembered across the trip to the provider's checkout and back (safezone://utilities/return). */
export function rememberPurchase(id: string): void {
  lastPurchaseId = id;
}
export function lastPurchase(): string | null {
  return lastPurchaseId;
}
