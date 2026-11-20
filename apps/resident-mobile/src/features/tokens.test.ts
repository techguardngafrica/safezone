import { describe, expect, it } from 'vitest';
import { amountOk, isInProgress, nairaToKobo } from './tokens';

describe('token helpers', () => {
  it('turns naira input into kobo', () => {
    expect(nairaToKobo('3500')).toBe(350_000);
    expect(nairaToKobo('3,500')).toBe(350_000);
    expect(nairaToKobo('₦ 2000')).toBe(200_000);
    expect(nairaToKobo('35.50')).toBeNull();
    expect(nairaToKobo('')).toBeNull();
  });

  it('checks the limits', () => {
    expect(amountOk(100_000, 100_000, 20_000_000)).toBe(true);
    expect(amountOk(99_900, 100_000, 20_000_000)).toBe(false);
    expect(amountOk(null, 100_000, 20_000_000)).toBe(false);
  });

  it('knows which statuses still change', () => {
    expect(isInProgress('created')).toBe(true);
    expect(isInProgress('vending')).toBe(true);
    expect(isInProgress('vended')).toBe(false);
    expect(isInProgress('refund_pending')).toBe(false);
  });
});
