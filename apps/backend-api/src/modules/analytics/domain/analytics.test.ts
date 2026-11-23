import { describe, expect, it } from 'vitest';
import { applySmallNumberSuppression, safePercent, stripPiiProperties } from './analytics';

describe('analytics domain rules', () => {
  it('strips PII properties from product events', () => {
    const clean = stripPiiProperties({
      screen: 'home',
      durationMs: 420,
      phone: '+2348012345678',
      fullName: 'Ada Obi',
      latitude: 6.5244,
      messageBody: 'secret',
      isOffline: false,
    });
    expect(clean).toEqual({ screen: 'home', durationMs: 420, isOffline: false });
  });

  it('suppresses cohorts below the threshold (default 200)', () => {
    expect(applySmallNumberSuppression(199)).toEqual({ value: null, suppressed: true });
    expect(applySmallNumberSuppression(200)).toEqual({ value: 200, suppressed: false });
  });

  it('computes percentages safely', () => {
    expect(safePercent(0, 0)).toBe(0);
    expect(safePercent(4, 5)).toBe(80);
  });
});
