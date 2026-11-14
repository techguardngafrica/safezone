import { describe, expect, it } from 'vitest';
import { estateSettingsSchema, updateEstateSettingsSchema } from './tenancy';
import { mfaVerifySchema } from './auth';

describe('estate settings', () => {
  it('fills every default', () => {
    const settings = estateSettingsSchema.parse({});
    expect(settings['visitor.max_pass_days']).toBe(30);
    expect(settings['sos.escalation'][0]).toEqual({ afterSeconds: 60, target: 'next_guard' });
  });

  it('PATCH keeps only the keys sent', () => {
    expect(updateEstateSettingsSchema.parse({ 'visitor.max_pass_days': 10 })).toEqual({
      'visitor.max_pass_days': 10,
    });
  });

  it('PATCH rejects unknown keys, bad values and empty bodies', () => {
    expect(updateEstateSettingsSchema.safeParse({ unknown: 1 }).success).toBe(false);
    expect(updateEstateSettingsSchema.safeParse({ 'visitor.max_pass_days': 0 }).success).toBe(
      false,
    );
    expect(updateEstateSettingsSchema.safeParse({}).success).toBe(false);
  });
});

describe('mfa verify', () => {
  it('needs exactly one of code or recovery code', () => {
    expect(mfaVerifySchema.safeParse({ code: '123456' }).success).toBe(true);
    expect(mfaVerifySchema.safeParse({ recoveryCode: 'ABCDE-FGHIJ' }).success).toBe(true);
    expect(mfaVerifySchema.safeParse({}).success).toBe(false);
    expect(mfaVerifySchema.safeParse({ code: '123456', recoveryCode: 'ABCDE-FGHIJ' }).success).toBe(
      false,
    );
  });
});
