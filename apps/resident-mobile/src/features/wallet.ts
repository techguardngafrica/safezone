import { formatKobo, type MessageKey, t } from '@safezone/i18n';
import type { Tone } from '@safezone/mobile-ui';

/** Safezone Pay helpers (ADR-0025). Pure. */

export const TRANSFER_MIN_KOBO = 10_000;
export const TRANSFER_MAX_KOBO = 50_000_000;
export const NETWORKS = ['mtn', 'glo', 'airtel', '9mobile'] as const;
export type Network = (typeof NETWORKS)[number];
export const NETWORK_LABELS: Record<Network, string> = {
  mtn: 'MTN',
  glo: 'Glo',
  airtel: 'Airtel',
  '9mobile': '9mobile',
};

export function statusLabel(status: string): string {
  return t(`res.wallet.status.${status}` as MessageKey);
}

export function statusTone(status: string): Tone {
  if (status === 'paid' || status === 'delivered') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'refund_pending' || status === 'delivering') return 'warning';
  return 'neutral';
}

/** Whole naira typed by a person → kobo, or null. */
export function wholeNairaToKobo(input: string): number | null {
  const cleaned = input.replace(/[,\s₦]/g, '');
  if (!/^\d{1,9}$/.test(cleaned)) return null;
  const kobo = Number(cleaned) * 100;
  return kobo > 0 ? kobo : null;
}

export function transferAmountOk(kobo: number | null): boolean {
  return kobo !== null && kobo >= TRANSFER_MIN_KOBO && kobo <= TRANSFER_MAX_KOBO;
}

export function naira(kobo: number): string {
  return formatKobo(kobo).replace(/\.00$/, '');
}

let lastItem: { kind: 'transfer' | 'topup'; id: string } | null = null;
/** Remembered across the trip to checkout and back (safezone://wallet/return). */
export function rememberWalletItem(item: { kind: 'transfer' | 'topup'; id: string }): void {
  lastItem = item;
}
export function lastWalletItem(): { kind: 'transfer' | 'topup'; id: string } | null {
  return lastItem;
}
