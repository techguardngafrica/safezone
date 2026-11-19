import { describe, expect, it } from 'vitest';
import { expiryState } from './documents';

describe('documents helpers', () => {
  const now = new Date('2026-11-19T12:00:00Z').getTime();

  it('returns null when there is no expiry date', () => {
    expect(expiryState(null, now)).toBeNull();
  });

  it('marks past dates as expired', () => {
    expect(expiryState('2026-11-18', now)).toBe('expired');
  });

  it('marks dates within 30 days as expiring_soon', () => {
    expect(expiryState('2026-11-19', now)).toBe('expiring_soon');
    expect(expiryState('2026-12-10', now)).toBe('expiring_soon');
  });

  it('marks dates beyond 30 days as valid', () => {
    expect(expiryState('2027-01-15', now)).toBe('valid');
  });
});
