import { describe, expect, it } from 'vitest';
import { transferAmountOk, wholeNairaToKobo } from './wallet';

describe('wallet helpers', () => {
  it('reads whole naira', () => {
    expect(wholeNairaToKobo('5,000')).toBe(500_000);
    expect(wholeNairaToKobo('50.5')).toBeNull();
    expect(wholeNairaToKobo('0')).toBeNull();
  });

  it('keeps transfers between ₦100 and ₦500,000', () => {
    expect(transferAmountOk(10_000)).toBe(true);
    expect(transferAmountOk(9_900)).toBe(false);
    expect(transferAmountOk(50_000_100)).toBe(false);
    expect(transferAmountOk(null)).toBe(false);
  });
});
