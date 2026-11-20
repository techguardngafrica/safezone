/** Prepaid token purchase rules (ADR-0018, utilities.md §5). Pure functions. Money is integer kobo. */

export type PurchaseStatus =
  'created' | 'paid' | 'vending' | 'vended' | 'failed' | 'refund_pending' | 'refunded';

/** ₦1,000 to ₦200,000 per purchase to start (ADR-0018 point 3). */
export const MIN_PURCHASE_KOBO = 100_000;
export const MAX_PURCHASE_KOBO = 20_000_000;
/** Service fee: none to start; a product decision (ADR-0018 open points). */
export const PURCHASE_FEE_KOBO = 0;
/** Vend attempts before a full refund (3 over about 10 minutes). */
export const MAX_VEND_ATTEMPTS = 3;
export const VEND_BACKOFF_MS = [60_000, 3 * 60_000, 6 * 60_000] as const;
/** Paid but neither vended nor refunded after this long raises an alert (utilities.md rule 2). */
export const STUCK_AFTER_MS = 15 * 60_000;

export function amountProblem(amountKobo: number): 'too_small' | 'too_large' | 'not_naira' | null {
  if (!Number.isSafeInteger(amountKobo) || amountKobo % 100 !== 0) return 'not_naira';
  if (amountKobo < MIN_PURCHASE_KOBO) return 'too_small';
  if (amountKobo > MAX_PURCHASE_KOBO) return 'too_large';
  return null;
}

/**
 * What a verified payment does to a purchase. Only a `created` purchase moves; a payment below the total
 * cannot buy the token, so it is refunded (the money is real and must not be kept).
 */
export function onPaid(
  status: string,
  paidKobo: number,
  totalKobo: number,
): 'paid' | 'refund_pending' | 'ignore' {
  if (status !== 'created') return 'ignore';
  return paidKobo >= totalKobo ? 'paid' : 'refund_pending';
}

/** After a failed vend attempt: retry while attempts remain and the failure may pass, else refund. */
export function afterVendFailure(attempts: number, retryable: boolean): 'retry' | 'refund_pending' {
  return retryable && attempts < MAX_VEND_ATTEMPTS ? 'retry' : 'refund_pending';
}

/** Purchases that hold the buyer's money without a token or a refund. */
export const OPEN_PAID_STATUSES: readonly PurchaseStatus[] = ['paid', 'vending', 'refund_pending'];

export function isStuck(status: string, paidAt: Date | null, now: Date = new Date()): boolean {
  return (
    paidAt !== null &&
    (OPEN_PAID_STATUSES as readonly string[]).includes(status) &&
    now.getTime() - paidAt.getTime() > STUCK_AFTER_MS
  );
}

/** "12345678901234567890" → "1234-5678-9012-3456-7890" for reading out and typing in. */
export function formatToken(token: string): string {
  const digits = token.replace(/\D/g, '');
  return digits.length === 20 ? digits.replace(/(\d{4})(?=\d)/g, '$1-') : token;
}
