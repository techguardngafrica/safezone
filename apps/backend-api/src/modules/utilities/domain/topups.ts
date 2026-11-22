/** Airtime and data rules (ADR-0025). Pure functions. */

export const AIRTIME_MIN_KOBO = 5_000;
export const AIRTIME_MAX_KOBO = 5_000_000;
export const TOPUP_FEE_KOBO = 0;
/** Requery schedule while the aggregator says pending: 1, 3, 10 and 30 minutes. */
export const REQUERY_DELAYS_MS = [60_000, 3 * 60_000, 10 * 60_000, 30 * 60_000] as const;
export const TOPUP_STUCK_AFTER_MS = 30 * 60_000;

export function airtimeProblem(amountKobo: number): 'not_naira' | 'too_small' | 'too_large' | null {
  if (!Number.isSafeInteger(amountKobo) || amountKobo % 100 !== 0) return 'not_naira';
  if (amountKobo < AIRTIME_MIN_KOBO) return 'too_small';
  if (amountKobo > AIRTIME_MAX_KOBO) return 'too_large';
  return null;
}

/** The next requery delay after `attempts` requeries, or null when it is time to stop and alert. */
export function nextRequeryDelay(attempts: number): number | null {
  return REQUERY_DELAYS_MS[attempts] ?? null;
}

export function topupStuck(status: string, paidAt: Date | null, now: Date): boolean {
  return (
    (status === 'paid' || status === 'delivering' || status === 'refund_pending') &&
    paidAt !== null &&
    now.getTime() - paidAt.getTime() > TOPUP_STUCK_AFTER_MS
  );
}

/** "+2348031234567" → "0803 *** 4567" for notifications. */
export function maskedPhone(e164: string): string {
  const local = e164.startsWith('+234') ? `0${e164.slice(4)}` : e164;
  return `${local.slice(0, 4)} *** ${local.slice(-4)}`;
}
