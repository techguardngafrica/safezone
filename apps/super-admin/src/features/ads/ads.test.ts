import { describe, expect, it } from 'vitest';
import { nairaToKobo, splitList, watFromLocal } from './ads';

describe('advertising desk helpers', () => {
  it('reads naira into kobo', () => {
    expect(nairaToKobo('100,000')).toBe(10_000_000);
    expect(nairaToKobo('0')).toBeNull();
    expect(nairaToKobo('1.234')).toBeNull();
  });

  it('reads datetime-local as WAT', () => {
    expect(watFromLocal('2026-12-01T09:30')).toBe('2026-12-01T09:30:00+01:00');
    expect(watFromLocal('2026-12-01')).toBeNull();
  });

  it('splits comma lists', () => {
    expect(splitList('Lagos, Ogun ,lagos,, x')).toEqual(['Lagos', 'Ogun', 'lagos']);
  });
});
