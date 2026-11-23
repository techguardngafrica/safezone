import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-sqlite', () => ({
  openDatabaseAsync: vi.fn(),
}));

import {
  deserializeCacheEntry,
  isCacheEntryExpired,
  serializeCacheEntry,
  shouldPersistQueryKey,
} from './offline-cache';

describe('shouldPersistQueryKey', () => {
  it('persists read-only estate operational slices', () => {
    expect(shouldPersistQueryKey(['estate', 'e1', 'reports', 'summary'])).toBe(true);
    expect(shouldPersistQueryKey(['estate', 'e1', 'announcements', 'latest'])).toBe(true);
    expect(shouldPersistQueryKey(['estate', 'e1', 'maintenance-requests'])).toBe(true);
    expect(shouldPersistQueryKey(['estate', 'e1', 'bookings', 'confirmed'])).toBe(true);
    expect(shouldPersistQueryKey(['estate', 'e1', 'gate-events', 'live'])).toBe(true);
    expect(shouldPersistQueryKey(['estate', 'e1', 'units', ''])).toBe(true);
  });

  it('never persists PII, SOS, moderation or auth queries', () => {
    expect(shouldPersistQueryKey(['estate', 'e1', 'residents', ''])).toBe(false);
    expect(shouldPersistQueryKey(['estate', 'e1', 'sos', 'active'])).toBe(false);
    expect(shouldPersistQueryKey(['estate', 'e1', 'moderation', 'queue'])).toBe(false);
    expect(shouldPersistQueryKey(['me', 'memberships'])).toBe(false);
    expect(shouldPersistQueryKey(['me', 'permissions', 'e1'])).toBe(false);
    expect(shouldPersistQueryKey(['estate', '', 'reports'])).toBe(false);
  });
});

describe('cache serialization and expiry', () => {
  it('round-trips a valid entry and rejects expired ones', () => {
    const now = 1_700_000_000_000;
    const row = serializeCacheEntry(['estate', 'e1', 'reports', 'summary'], { total: 42 }, now);
    expect(row).not.toBeNull();
    if (!row) return;
    expect(isCacheEntryExpired(row.savedAt, now + 60_000)).toBe(false);
    expect(deserializeCacheEntry(row, now + 60_000)).toEqual({
      queryKey: ['estate', 'e1', 'reports', 'summary'],
      data: { total: 42 },
      savedAt: now,
    });
    const after25h = now + 25 * 60 * 60 * 1000;
    expect(isCacheEntryExpired(row.savedAt, after25h)).toBe(true);
    expect(deserializeCacheEntry(row, after25h)).toBeNull();
  });
});
