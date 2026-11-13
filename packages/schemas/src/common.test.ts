import { describe, expect, it } from 'vitest';
import { normalizeNigerianPhone, otpVerifySchema, phoneE164Schema } from './index';

describe('phone numbers', () => {
  it('accepts valid E.164 Nigerian numbers', () => {
    expect(phoneE164Schema.safeParse('+2348031234567').success).toBe(true);
  });

  it('rejects malformed numbers', () => {
    expect(phoneE164Schema.safeParse('08031234567').success).toBe(false);
    expect(phoneE164Schema.safeParse('+23480312').success).toBe(false);
  });

  it('normalises local formats', () => {
    expect(normalizeNigerianPhone('0803 123 4567')).toBe('+2348031234567');
    expect(normalizeNigerianPhone('2348031234567')).toBe('+2348031234567');
    expect(normalizeNigerianPhone('12345')).toBeNull();
  });
});

describe('otp verify', () => {
  it('requires a 6-digit code', () => {
    const result = otpVerifySchema.safeParse({
      phone: '+2348031234567',
      code: '12a456',
      device: { app: 'resident-mobile', platform: 'android', appVersion: '1.0.0' },
    });
    expect(result.success).toBe(false);
  });
});
