import { describe, expect, it } from 'vitest';
import {
  afterVendFailure,
  amountProblem,
  formatToken,
  isStuck,
  MAX_VEND_ATTEMPTS,
  onPaid,
} from './purchases';

describe('purchase amounts', () => {
  it('accepts whole naira between the limits', () => {
    expect(amountProblem(100_000)).toBeNull();
    expect(amountProblem(5_000_000)).toBeNull();
    expect(amountProblem(20_000_000)).toBeNull();
  });

  it('rejects kobo fractions, too small and too large', () => {
    expect(amountProblem(100_050)).toBe('not_naira');
    expect(amountProblem(1.5)).toBe('not_naira');
    expect(amountProblem(99_900)).toBe('too_small');
    expect(amountProblem(20_000_100)).toBe('too_large');
  });
});

describe('purchase transitions', () => {
  it('moves only a created purchase on payment', () => {
    expect(onPaid('created', 500_000, 500_000)).toBe('paid');
    expect(onPaid('created', 600_000, 500_000)).toBe('paid');
    expect(onPaid('created', 400_000, 500_000)).toBe('refund_pending');
    for (const status of ['paid', 'vending', 'vended', 'refunded', 'refund_pending', 'failed'])
      expect(onPaid(status, 500_000, 500_000)).toBe('ignore');
  });

  it('retries retryable vend failures, then refunds', () => {
    expect(afterVendFailure(1, true)).toBe('retry');
    expect(afterVendFailure(MAX_VEND_ATTEMPTS - 1, true)).toBe('retry');
    expect(afterVendFailure(MAX_VEND_ATTEMPTS, true)).toBe('refund_pending');
    expect(afterVendFailure(1, false)).toBe('refund_pending');
  });

  it('flags paid purchases with no token or refund after 15 minutes', () => {
    const now = new Date('2026-11-20T10:00:00Z');
    const old = new Date('2026-11-20T09:40:00Z');
    const fresh = new Date('2026-11-20T09:50:00Z');
    expect(isStuck('vending', old, now)).toBe(true);
    expect(isStuck('refund_pending', old, now)).toBe(true);
    expect(isStuck('vending', fresh, now)).toBe(false);
    expect(isStuck('vended', old, now)).toBe(false);
    expect(isStuck('created', null, now)).toBe(false);
  });

  it('groups 20-digit tokens in fours', () => {
    expect(formatToken('12345678901234567890')).toBe('1234-5678-9012-3456-7890');
    expect(formatToken('1234-5678-9012-3456-7890')).toBe('1234-5678-9012-3456-7890');
    expect(formatToken('ABC')).toBe('ABC');
  });
});
