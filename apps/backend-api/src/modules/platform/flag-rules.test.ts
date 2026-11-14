import { describe, expect, it } from 'vitest';
import { flagRulesSchema, isFlagEnabled, rolloutBucket } from './flag-rules';

const estateA = '01936b2e-0000-7000-8000-000000000001';
const estateB = '01936b2e-0000-7000-8000-000000000002';

describe('isFlagEnabled', () => {
  it('is off without default or targeting, on with default', () => {
    expect(isFlagEnabled({ key: 'x', defaultEnabled: false, rules: {} }, {})).toBe(false);
    expect(isFlagEnabled({ key: 'x', defaultEnabled: true, rules: {} }, {})).toBe(true);
  });

  it('targets estates, apps and minimum versions together', () => {
    const flag = {
      key: 'new_gate_ui',
      defaultEnabled: false,
      rules: { estateIds: [estateA], apps: ['security-mobile'], minAppVersion: '1.2.0' },
    };
    expect(
      isFlagEnabled(flag, { estateId: estateA, app: 'security-mobile', appVersion: '1.2.0' }),
    ).toBe(true);
    expect(
      isFlagEnabled(flag, { estateId: estateB, app: 'security-mobile', appVersion: '1.2.0' }),
    ).toBe(false);
    expect(
      isFlagEnabled(flag, { estateId: estateA, app: 'resident-mobile', appVersion: '1.2.0' }),
    ).toBe(false);
    expect(
      isFlagEnabled(flag, { estateId: estateA, app: 'security-mobile', appVersion: '1.1.9' }),
    ).toBe(false);
  });

  it('rolls out to a stable percentage of subjects', () => {
    const flag = { key: 'rollout', defaultEnabled: false, rules: { percent: 30 } };
    const subjects = Array.from(
      { length: 1000 },
      (_, i) => `00000000-0000-7000-8000-${String(i).padStart(12, '0')}`,
    );
    const on = subjects.filter((id) => isFlagEnabled(flag, { userId: id })).length;
    expect(on).toBeGreaterThan(220);
    expect(on).toBeLessThan(380);
    expect(isFlagEnabled(flag, { userId: subjects[0] })).toBe(
      isFlagEnabled(flag, { userId: subjects[0] }),
    );
    expect(rolloutBucket('a', 'b')).toBe(rolloutBucket('a', 'b'));
  });

  it('validates rules strictly', () => {
    expect(flagRulesSchema.safeParse({ percent: 101 }).success).toBe(false);
    expect(flagRulesSchema.safeParse({ unknown: 1 }).success).toBe(false);
  });
});
