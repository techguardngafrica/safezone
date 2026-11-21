import { describe, expect, it } from 'vitest';
import { LOCK_AFTER_MS, lockCovers, shouldLockOnResume } from './lock-rules';

describe('shouldLockOnResume', () => {
  const start = 1_000_000;

  it('does not lock if the app never went to the background', () => {
    expect(shouldLockOnResume(null, start)).toBe(false);
  });

  it('does not lock before 5 minutes', () => {
    expect(shouldLockOnResume(start, start + LOCK_AFTER_MS - 1)).toBe(false);
  });

  it('locks at and after 5 minutes', () => {
    expect(shouldLockOnResume(start, start + LOCK_AFTER_MS)).toBe(true);
    expect(shouldLockOnResume(start, start + 3 * LOCK_AFTER_MS)).toBe(true);
  });
});

describe('lockCovers', () => {
  it('leaves the SOS screen reachable', () => {
    expect(lockCovers('/sos/0195f3d2-1111-7000-8000-000000000000')).toBe(false);
  });

  it('covers every other screen', () => {
    for (const path of ['/home', '/approvals', '/security', '/incidents/abc', '/sosx'])
      expect(lockCovers(path)).toBe(true);
  });
});
