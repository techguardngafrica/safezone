import { describe, expect, it } from 'vitest';
import { DEFAULT_CURRENCY, DEFAULT_TIMEZONE, ESTATE_STATUSES } from './index';

describe('@safezone/types constants', () => {
  it('defaults to Naira and Lagos time', () => {
    expect(DEFAULT_CURRENCY).toBe('NGN');
    expect(DEFAULT_TIMEZONE).toBe('Africa/Lagos');
  });

  it('includes every estate lifecycle status', () => {
    expect(ESTATE_STATUSES).toContain('active');
    expect(ESTATE_STATUSES).toContain('suspended');
  });
});
