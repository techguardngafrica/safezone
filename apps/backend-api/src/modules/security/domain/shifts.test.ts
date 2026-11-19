import { describe, expect, it } from 'vitest';
import { canEndShift, startDecision } from './shifts';

describe('shift rules', () => {
  it('starts when nothing is open', () => {
    expect(startDecision(null, 'gate-a')).toBe('start');
  });

  it('resumes an open shift at the same gate', () => {
    expect(startDecision({ userId: 'u', gateId: 'gate-a' }, 'gate-a')).toBe('resume');
  });

  it('refuses a second open shift at another gate', () => {
    expect(startDecision({ userId: 'u', gateId: 'gate-a' }, 'gate-b')).toBe('conflict');
  });

  it('lets guards end only their own shift, supervisors any', () => {
    expect(canEndShift('u1', 'u1', false)).toBe(true);
    expect(canEndShift('u1', 'u2', false)).toBe(false);
    expect(canEndShift('u1', 'u2', true)).toBe(true);
  });
});
