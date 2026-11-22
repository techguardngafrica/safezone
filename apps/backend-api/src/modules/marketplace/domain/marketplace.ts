import type { OrderStatus } from '@safezone/schemas';

/**
 * Marketplace rules (marketplace.md §3 and §5, ADR-0023). Pure functions: no I/O, no clock reads.
 */

export type OrderAction =
  | 'quote'
  | 'accept'
  | 'accept_quote'
  | 'decline'
  | 'schedule'
  | 'start'
  | 'complete'
  | 'review'
  | 'cancel_by_resident'
  | 'cancel_by_vendor'
  | 'dispute'
  | 'resolve_refund'
  | 'resolve_no_action';

export type OrderActor = 'resident' | 'vendor' | 'platform';

interface Transition {
  from: readonly OrderStatus[];
  to: OrderStatus;
  actor: OrderActor;
  /** The order must have a verified payment first. */
  needsPayment?: boolean;
}

const CANCELLABLE: readonly OrderStatus[] = ['requested', 'quoted', 'accepted', 'scheduled'];

export const ORDER_TRANSITIONS: Readonly<Record<OrderAction, Transition>> = {
  quote: { from: ['requested', 'quoted'], to: 'quoted', actor: 'vendor' },
  accept: { from: ['requested'], to: 'accepted', actor: 'vendor' },
  accept_quote: { from: ['quoted'], to: 'accepted', actor: 'resident' },
  decline: { from: ['requested', 'quoted'], to: 'declined', actor: 'vendor' },
  schedule: {
    from: ['accepted', 'scheduled'],
    to: 'scheduled',
    actor: 'vendor',
    needsPayment: true,
  },
  start: {
    from: ['accepted', 'scheduled'],
    to: 'in_progress',
    actor: 'vendor',
    needsPayment: true,
  },
  complete: { from: ['in_progress'], to: 'completed', actor: 'vendor', needsPayment: true },
  review: { from: ['completed'], to: 'reviewed', actor: 'resident' },
  cancel_by_resident: { from: CANCELLABLE, to: 'cancelled_by_resident', actor: 'resident' },
  cancel_by_vendor: { from: CANCELLABLE, to: 'cancelled_by_vendor', actor: 'vendor' },
  dispute: {
    from: ['accepted', 'scheduled', 'in_progress', 'completed'],
    to: 'disputed',
    actor: 'resident',
    needsPayment: true,
  },
  resolve_refund: { from: ['disputed'], to: 'refunded', actor: 'platform', needsPayment: true },
  resolve_no_action: { from: ['disputed'], to: 'completed', actor: 'platform', needsPayment: true },
};

export type TransitionRefusal = 'wrong_status' | 'wrong_actor' | 'not_paid';

export function checkTransition(
  action: OrderAction,
  state: { status: OrderStatus; paid: boolean },
  actor: OrderActor,
): { ok: true; to: OrderStatus } | { ok: false; reason: TransitionRefusal } {
  const transition = ORDER_TRANSITIONS[action];
  if (transition.actor !== actor) return { ok: false, reason: 'wrong_actor' };
  if (!transition.from.includes(state.status)) return { ok: false, reason: 'wrong_status' };
  if (transition.needsPayment && !state.paid) return { ok: false, reason: 'not_paid' };
  return { ok: true, to: transition.to };
}

/** Terminal states: nothing happens to the order any more. */
export const FINAL_STATUSES: ReadonlySet<OrderStatus> = new Set([
  'reviewed',
  'declined',
  'cancelled_by_resident',
  'cancelled_by_vendor',
  'refunded',
]);

/** A vendor can accept a fixed-price order at once; "from" and "quote" listings need a quote first. */
export function canAcceptWithoutQuote(priceType: 'fixed' | 'from' | 'quote'): boolean {
  return priceType === 'fixed';
}

// ---- Commission ---------------------------------------------------------------------------------

export interface CommissionRuleRow {
  scope: 'default' | 'category' | 'vendor';
  scopeId: string | null;
  bps: number;
  validFrom: Date;
}

/**
 * The rule in force at `at` (marketplace.md rule 3): vendor rule, else category rule, else default; within
 * a scope, the latest valid_from at or before `at`. No rule at all means 0%.
 */
export function commissionBpsAt(
  rules: readonly CommissionRuleRow[],
  target: { vendorId: string; categoryId: string },
  at: Date,
): number {
  const latest = (scope: CommissionRuleRow['scope'], scopeId: string | null) =>
    rules
      .filter((r) => r.scope === scope && r.scopeId === scopeId && r.validFrom <= at)
      .sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime())[0];
  return (
    (
      latest('vendor', target.vendorId) ??
      latest('category', target.categoryId) ??
      latest('default', null)
    )?.bps ?? 0
  );
}

/** Splits an amount into Safezone's commission (rounded down to the kobo) and the vendor's share. */
export function splitAmount(
  amountKobo: number,
  bps: number,
): { commissionKobo: number; vendorKobo: number } {
  if (!Number.isSafeInteger(amountKobo) || amountKobo <= 0) throw new RangeError('amount');
  if (!Number.isInteger(bps) || bps < 0 || bps > 3000) throw new RangeError('bps');
  const commissionKobo = Math.floor((amountKobo * bps) / 10_000);
  return { commissionKobo, vendorKobo: amountKobo - commissionKobo };
}

/** Refund cap: never more than what was captured less earlier refunds (payments.md rule 5). */
export function refundableKobo(amountKobo: number, refundedKobo: number): number {
  return Math.max(0, amountKobo - refundedKobo);
}

// ---- Visibility ---------------------------------------------------------------------------------

export interface ServiceArea {
  state: string | null;
  lga: string | null;
  estateId: string | null;
}

/** True when one of the vendor's areas covers the estate (by id, or by state and optional LGA). */
export function servesEstate(
  areas: readonly ServiceArea[],
  estate: { id: string; state: string | null; lga: string | null },
): boolean {
  const same = (a: string | null, b: string | null) =>
    a !== null && b !== null && a.trim().toLowerCase() === b.trim().toLowerCase();
  return areas.some((area) => {
    if (area.estateId !== null) return area.estateId === estate.id;
    if (!same(area.state, estate.state)) return false;
    return area.lga === null || same(area.lga, estate.lga);
  });
}

/**
 * marketplace.md rules 1 and 2: residents see an approved vendor with a payout account only when the
 * estate approved them, or the estate allows all verified vendors serving its area and has not blocked them.
 */
export function vendorVisibleToEstate(input: {
  vendorStatus: string;
  payoutReady: boolean;
  approval: 'approved' | 'blocked' | null;
  allowAllVerified: boolean;
  servesEstate: boolean;
}): boolean {
  if (input.vendorStatus !== 'approved' || !input.payoutReady) return false;
  if (input.approval === 'blocked') return false;
  if (input.approval === 'approved') return true;
  return input.allowAllVerified && input.servesEstate;
}

// ---- Ratings ------------------------------------------------------------------------------------

export function ratingAverage(sum: number, count: number): number | null {
  if (count <= 0) return null;
  return Math.round((sum / count) * 10) / 10;
}

// ---- Classifieds --------------------------------------------------------------------------------

export const CLASSIFIED_LIFETIME_DAYS = 30;
export const MAX_ACTIVE_CLASSIFIEDS = 20;

export function classifiedExpiry(from: Date): Date {
  return new Date(from.getTime() + CLASSIFIED_LIFETIME_DAYS * 86_400_000);
}

/** A seller may change their own listing unless staff hid it; hidden listings stay hidden. */
export function sellerCanEdit(status: string): boolean {
  return status !== 'hidden';
}

/** Status seen by readers: an active listing past its expiry reads as expired. */
export function effectiveClassifiedStatus(status: string, expiresAt: Date, now: Date): string {
  return status === 'active' && expiresAt <= now ? 'expired' : status;
}
