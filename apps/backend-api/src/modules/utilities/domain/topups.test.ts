import { describe, expect, it } from 'vitest';
import { airtimeProblem, maskedPhone, nextRequeryDelay, topupStuck } from './topups';

describe('top-up rules', () => {
  it('takes airtime in whole naira from ₦50 to ₦50,000', () => {
    expect(airtimeProblem(5_000)).toBeNull();
    expect(airtimeProblem(4_900)).toBe('too_small');
    expect(airtimeProblem(5_000_100)).toBe('too_large');
    expect(airtimeProblem(5_050)).toBe('not_naira');
  });

  it('requeries on a schedule, then stops', () => {
    expect(nextRequeryDelay(0)).toBe(60_000);
    expect(nextRequeryDelay(3)).toBe(1_800_000);
    expect(nextRequeryDelay(4)).toBeNull();
  });

  it('flags paid purchases not settled after 30 minutes', () => {
    const paidAt = new Date('2026-11-22T10:00:00Z');
    expect(topupStuck('delivering', paidAt, new Date('2026-11-22T10:20:00Z'))).toBe(false);
    expect(topupStuck('delivering', paidAt, new Date('2026-11-22T10:31:00Z'))).toBe(true);
    expect(topupStuck('delivered', paidAt, new Date('2026-11-22T12:00:00Z'))).toBe(false);
  });

  it('masks phone numbers', () => {
    expect(maskedPhone('+2348031234567')).toBe('0803 *** 4567');
  });
});
