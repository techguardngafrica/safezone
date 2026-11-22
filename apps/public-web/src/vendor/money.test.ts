import { describe, expect, it } from 'vitest';
import { nairaToKobo } from './money';

describe('nairaToKobo', () => {
  it('reads naira as typed by people into integer kobo', () => {
    expect(nairaToKobo('15000')).toBe(1_500_000);
    expect(nairaToKobo('15,000')).toBe(1_500_000);
    expect(nairaToKobo('₦ 2,500.50')).toBe(250_050);
    expect(nairaToKobo('0.1')).toBe(10);
  });

  it('refuses anything that is not a positive amount', () => {
    for (const bad of ['', '0', '-5', 'abc', '1.234', '1e5']) expect(nairaToKobo(bad)).toBeNull();
  });
});
