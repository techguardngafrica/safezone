import { describe, expect, it, vi } from 'vitest';
import {
  createMemorySessionStorage,
  createSingleFlightRefresh,
  isAccessTokenExpiring,
  maskPhone,
} from './index';

describe('isAccessTokenExpiring', () => {
  const now = new Date('2026-11-13T10:00:00Z');

  it('is false when well within validity', () => {
    expect(isAccessTokenExpiring({ accessTokenExpiresAt: '2026-11-13T10:10:00Z' }, now)).toBe(
      false,
    );
  });

  it('is true inside the skew window or when invalid', () => {
    expect(isAccessTokenExpiring({ accessTokenExpiresAt: '2026-11-13T10:00:30Z' }, now)).toBe(true);
    expect(isAccessTokenExpiring({ accessTokenExpiresAt: 'not-a-date' }, now)).toBe(true);
  });
});

describe('createSingleFlightRefresh', () => {
  it('runs one refresh for concurrent callers', async () => {
    const refresh = vi.fn(async () => 'new-token');
    const run = createSingleFlightRefresh(refresh);
    const results = await Promise.all([run(), run(), run()]);
    expect(results).toEqual(['new-token', 'new-token', 'new-token']);
    expect(refresh).toHaveBeenCalledOnce();
  });
});

describe('session storage and masking', () => {
  it('stores and clears a session', async () => {
    const storage = createMemorySessionStorage();
    await storage.set({ accessToken: 'a', accessTokenExpiresAt: '2026-11-13T10:00:00Z' });
    expect(await storage.get()).not.toBeNull();
    await storage.clear();
    expect(await storage.get()).toBeNull();
  });

  it('masks phone numbers', () => {
    expect(maskPhone('+2348031234567')).toBe('+234803****567');
  });
});
