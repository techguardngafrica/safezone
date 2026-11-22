import type { OrderStatus } from '@safezone/schemas';
import { describe, expect, it } from 'vitest';
import {
  canAcceptWithoutQuote,
  checkTransition,
  classifiedExpiry,
  commissionBpsAt,
  type CommissionRuleRow,
  effectiveClassifiedStatus,
  ORDER_TRANSITIONS,
  type OrderAction,
  ratingAverage,
  refundableKobo,
  sellerCanEdit,
  servesEstate,
  splitAmount,
  vendorVisibleToEstate,
} from './marketplace';

const ALL_STATUSES: OrderStatus[] = [
  'requested',
  'quoted',
  'accepted',
  'scheduled',
  'in_progress',
  'completed',
  'reviewed',
  'declined',
  'cancelled_by_resident',
  'cancelled_by_vendor',
  'disputed',
  'refunded',
];

describe('order state machine', () => {
  const allowed: [OrderAction, OrderStatus, OrderStatus, boolean][] = [
    ['quote', 'requested', 'quoted', false],
    ['quote', 'quoted', 'quoted', false],
    ['accept', 'requested', 'accepted', false],
    ['accept_quote', 'quoted', 'accepted', false],
    ['decline', 'requested', 'declined', false],
    ['decline', 'quoted', 'declined', false],
    ['schedule', 'accepted', 'scheduled', true],
    ['schedule', 'scheduled', 'scheduled', true],
    ['start', 'accepted', 'in_progress', true],
    ['start', 'scheduled', 'in_progress', true],
    ['complete', 'in_progress', 'completed', true],
    ['review', 'completed', 'reviewed', true],
    ['cancel_by_resident', 'requested', 'cancelled_by_resident', false],
    ['cancel_by_resident', 'scheduled', 'cancelled_by_resident', true],
    ['cancel_by_vendor', 'accepted', 'cancelled_by_vendor', true],
    ['dispute', 'completed', 'disputed', true],
    ['dispute', 'in_progress', 'disputed', true],
    ['resolve_refund', 'disputed', 'refunded', true],
    ['resolve_no_action', 'disputed', 'completed', true],
  ];

  it.each(allowed)('%s moves %s to %s', (action, from, to, paid) => {
    const actor = ORDER_TRANSITIONS[action].actor;
    expect(checkTransition(action, { status: from, paid }, actor)).toEqual({ ok: true, to });
  });

  it('refuses every action from a status not listed for it', () => {
    for (const [action, transition] of Object.entries(ORDER_TRANSITIONS) as [
      OrderAction,
      (typeof ORDER_TRANSITIONS)[OrderAction],
    ][]) {
      for (const status of ALL_STATUSES.filter((s) => !transition.from.includes(s))) {
        expect(checkTransition(action, { status, paid: true }, transition.actor)).toEqual({
          ok: false,
          reason: 'wrong_status',
        });
      }
    }
  });

  it('refuses the wrong actor', () => {
    expect(checkTransition('accept', { status: 'requested', paid: false }, 'resident')).toEqual({
      ok: false,
      reason: 'wrong_actor',
    });
    expect(checkTransition('accept_quote', { status: 'quoted', paid: false }, 'vendor')).toEqual({
      ok: false,
      reason: 'wrong_actor',
    });
    expect(
      checkTransition('resolve_refund', { status: 'disputed', paid: true }, 'resident'),
    ).toEqual({ ok: false, reason: 'wrong_actor' });
  });

  it('refuses work and disputes before payment is verified', () => {
    for (const action of ['schedule', 'start'] as const) {
      expect(checkTransition(action, { status: 'accepted', paid: false }, 'vendor')).toEqual({
        ok: false,
        reason: 'not_paid',
      });
    }
    expect(checkTransition('dispute', { status: 'accepted', paid: false }, 'resident')).toEqual({
      ok: false,
      reason: 'not_paid',
    });
  });

  it('does not let anyone cancel work in progress or done', () => {
    for (const status of ['in_progress', 'completed', 'reviewed'] as const) {
      expect(checkTransition('cancel_by_resident', { status, paid: true }, 'resident').ok).toBe(
        false,
      );
      expect(checkTransition('cancel_by_vendor', { status, paid: true }, 'vendor').ok).toBe(false);
    }
  });

  it('accepts only fixed-price orders without a quote', () => {
    expect(canAcceptWithoutQuote('fixed')).toBe(true);
    expect(canAcceptWithoutQuote('from')).toBe(false);
    expect(canAcceptWithoutQuote('quote')).toBe(false);
  });
});

describe('commission', () => {
  const at = new Date('2026-12-01T10:00:00Z');
  const rules: CommissionRuleRow[] = [
    { scope: 'default', scopeId: null, bps: 0, validFrom: new Date('2026-11-22T00:00:00Z') },
    { scope: 'default', scopeId: null, bps: 500, validFrom: new Date('2026-11-30T00:00:00Z') },
    { scope: 'default', scopeId: null, bps: 900, validFrom: new Date('2027-01-01T00:00:00Z') },
    { scope: 'category', scopeId: 'cat-1', bps: 700, validFrom: new Date('2026-11-25T00:00:00Z') },
    { scope: 'vendor', scopeId: 'ven-1', bps: 300, validFrom: new Date('2026-11-25T00:00:00Z') },
  ];

  it('prefers vendor over category over default, using the rule in force at the time', () => {
    expect(commissionBpsAt(rules, { vendorId: 'ven-1', categoryId: 'cat-1' }, at)).toBe(300);
    expect(commissionBpsAt(rules, { vendorId: 'ven-2', categoryId: 'cat-1' }, at)).toBe(700);
    expect(commissionBpsAt(rules, { vendorId: 'ven-2', categoryId: 'cat-2' }, at)).toBe(500);
    expect(
      commissionBpsAt(rules, { vendorId: 'ven-2', categoryId: 'cat-2' }, new Date('2026-11-23')),
    ).toBe(0);
  });

  it('is 0% with no rules', () => {
    expect(commissionBpsAt([], { vendorId: 'v', categoryId: 'c' }, at)).toBe(0);
  });

  it('splits in whole kobo and always adds up', () => {
    expect(splitAmount(1_000_000, 750)).toEqual({ commissionKobo: 75_000, vendorKobo: 925_000 });
    expect(splitAmount(333, 1000)).toEqual({ commissionKobo: 33, vendorKobo: 300 });
    for (const amount of [1, 99, 12_345, 987_654_321]) {
      const split = splitAmount(amount, 1234);
      expect(split.commissionKobo + split.vendorKobo).toBe(amount);
    }
  });

  it('refuses bad amounts and rates', () => {
    expect(() => splitAmount(0, 100)).toThrow(RangeError);
    expect(() => splitAmount(10.5, 100)).toThrow(RangeError);
    expect(() => splitAmount(100, 3001)).toThrow(RangeError);
  });

  it('caps refunds at the captured amount less earlier refunds', () => {
    expect(refundableKobo(10_000, 0)).toBe(10_000);
    expect(refundableKobo(10_000, 4_000)).toBe(6_000);
    expect(refundableKobo(10_000, 12_000)).toBe(0);
  });
});

describe('vendor visibility', () => {
  const estate = { id: 'est-1', state: 'Lagos', lga: 'Eti-Osa' };
  const base = {
    vendorStatus: 'approved',
    payoutReady: true,
    approval: null,
    allowAllVerified: false,
    servesEstate: true,
  } as const;

  it('matches service areas by estate, state, or state and LGA', () => {
    expect(servesEstate([{ state: null, lga: null, estateId: 'est-1' }], estate)).toBe(true);
    expect(servesEstate([{ state: null, lga: null, estateId: 'est-2' }], estate)).toBe(false);
    expect(servesEstate([{ state: 'lagos', lga: null, estateId: null }], estate)).toBe(true);
    expect(servesEstate([{ state: 'Lagos', lga: 'eti-osa', estateId: null }], estate)).toBe(true);
    expect(servesEstate([{ state: 'Lagos', lga: 'Ikeja', estateId: null }], estate)).toBe(false);
    expect(servesEstate([{ state: 'Abuja', lga: null, estateId: null }], estate)).toBe(false);
  });

  it('shows approved vendors, and hides blocked ones even when all verified vendors are allowed', () => {
    expect(vendorVisibleToEstate({ ...base, approval: 'approved' })).toBe(true);
    expect(vendorVisibleToEstate({ ...base, approval: 'blocked', allowAllVerified: true })).toBe(
      false,
    );
  });

  it('shows undecided vendors only when the estate allows all verified vendors in its area', () => {
    expect(vendorVisibleToEstate(base)).toBe(false);
    expect(vendorVisibleToEstate({ ...base, allowAllVerified: true })).toBe(true);
    expect(vendorVisibleToEstate({ ...base, allowAllVerified: true, servesEstate: false })).toBe(
      false,
    );
  });

  it('never shows unapproved vendors or vendors without a payout account', () => {
    for (const vendorStatus of ['applied', 'under_review', 'rejected', 'suspended']) {
      expect(vendorVisibleToEstate({ ...base, vendorStatus, approval: 'approved' })).toBe(false);
    }
    expect(vendorVisibleToEstate({ ...base, payoutReady: false, approval: 'approved' })).toBe(
      false,
    );
  });
});

describe('ratings and classifieds', () => {
  it('averages ratings to one decimal place', () => {
    expect(ratingAverage(0, 0)).toBeNull();
    expect(ratingAverage(14, 3)).toBe(4.7);
  });

  it('expires classifieds after 30 days and reads them as expired', () => {
    const created = new Date('2026-11-22T12:00:00Z');
    const expires = classifiedExpiry(created);
    expect(expires.toISOString()).toBe('2026-12-22T12:00:00.000Z');
    expect(effectiveClassifiedStatus('active', expires, new Date('2026-12-01'))).toBe('active');
    expect(effectiveClassifiedStatus('active', expires, expires)).toBe('expired');
    expect(effectiveClassifiedStatus('sold', expires, new Date('2027-01-01'))).toBe('sold');
  });

  it('keeps hidden listings out of the seller’s hands', () => {
    expect(sellerCanEdit('active')).toBe(true);
    expect(sellerCanEdit('hidden')).toBe(false);
  });
});
