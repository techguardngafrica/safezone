import type { QueryClient } from '@tanstack/react-query';
import * as SQLite from 'expo-sqlite';

const DB_NAME = 'safezone_management_cache.db';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Only read-only estate operational slices are persisted (management-mobile.md §9).
 * PII-bearing resident directories, live SOS alerts, moderation reports and auth/session
 * queries are strictly excluded.
 */
const PERSISTABLE_SLICES = new Set([
  'reports',
  'announcements',
  'gate-events',
  'gate',
  'incidents',
  'maintenance-requests',
  'bookings',
  'units',
  'shift-sessions',
]);

export function shouldPersistQueryKey(queryKey: readonly unknown[]): boolean {
  if (queryKey.length < 3) return false;
  if (queryKey[0] !== 'estate') return false;
  if (typeof queryKey[1] !== 'string' || queryKey[1].length === 0) return false;
  return typeof queryKey[2] === 'string' && PERSISTABLE_SLICES.has(queryKey[2]);
}

export function isCacheEntryExpired(savedAt: number, now: number = Date.now()): boolean {
  return now - savedAt > CACHE_TTL_MS;
}

export interface SerializedCacheRow {
  key: string;
  queryKeyJson: string;
  dataJson: string;
  savedAt: number;
}

export function serializeCacheEntry(
  queryKey: readonly unknown[],
  data: unknown,
  now: number = Date.now(),
): SerializedCacheRow | null {
  try {
    const queryKeyJson = JSON.stringify(queryKey);
    const dataJson = JSON.stringify(data);
    if (!queryKeyJson || dataJson === undefined) return null;
    return { key: queryKeyJson, queryKeyJson, dataJson, savedAt: now };
  } catch {
    return null;
  }
}

export function deserializeCacheEntry(
  row: SerializedCacheRow,
  now: number = Date.now(),
): { queryKey: readonly unknown[]; data: unknown; savedAt: number } | null {
  if (isCacheEntryExpired(row.savedAt, now)) return null;
  try {
    const queryKey = JSON.parse(row.queryKeyJson) as unknown;
    if (!Array.isArray(queryKey) || !shouldPersistQueryKey(queryKey)) return null;
    const data = JSON.parse(row.dataJson) as unknown;
    return { queryKey, data, savedAt: row.savedAt };
  } catch {
    return null;
  }
}

let dbPromise: Promise<SQLite.SQLiteDatabase | null> | null = null;

function openCacheDb(): Promise<SQLite.SQLiteDatabase | null> {
  if (!dbPromise) {
    dbPromise = (async () => {
      try {
        const db = await SQLite.openDatabaseAsync(DB_NAME);
        await db.execAsync(
          'CREATE TABLE IF NOT EXISTS query_cache (key TEXT PRIMARY KEY NOT NULL, query_key_json TEXT NOT NULL, data_json TEXT NOT NULL, saved_at INTEGER NOT NULL);',
        );
        return db;
      } catch {
        return null;
      }
    })();
  }
  return dbPromise;
}

/** Hydrates TanStack Query with recent read-only snapshots and persists future updates. */
export function attachOfflineCache(queryClient: QueryClient): () => void {
  let active = true;

  void openCacheDb().then(async (db) => {
    if (!db || !active) return;
    try {
      const now = Date.now();
      const rows = await db.getAllAsync<{
        key: string;
        query_key_json: string;
        data_json: string;
        saved_at: number;
      }>('SELECT key, query_key_json, data_json, saved_at FROM query_cache');
      for (const row of rows) {
        if (!active) break;
        const parsed = deserializeCacheEntry(
          {
            key: row.key,
            queryKeyJson: row.query_key_json,
            dataJson: row.data_json,
            savedAt: row.saved_at,
          },
          now,
        );
        if (!parsed) {
          await db.runAsync('DELETE FROM query_cache WHERE key = ?', [row.key]);
          continue;
        }
        const existing = queryClient.getQueryData(parsed.queryKey);
        if (existing === undefined) {
          queryClient.setQueryData(parsed.queryKey, parsed.data, { updatedAt: parsed.savedAt });
        }
      }
    } catch {
      // Ignore corrupt cache rows; live queries will repopulate.
    }
  });

  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success') return;
    const { queryKey, state } = event.query;
    if (!shouldPersistQueryKey(queryKey) || state.data === undefined) return;
    const row = serializeCacheEntry(queryKey, state.data, state.dataUpdatedAt || Date.now());
    if (!row) return;
    void openCacheDb().then(async (db) => {
      if (!db || !active) return;
      try {
        await db.runAsync(
          'INSERT OR REPLACE INTO query_cache (key, query_key_json, data_json, saved_at) VALUES (?, ?, ?, ?)',
          [row.key, row.queryKeyJson, row.dataJson, row.savedAt],
        );
      } catch {
        // Non-fatal: in-memory cache still holds the data.
      }
    });
  });

  return () => {
    active = false;
    unsubscribe();
  };
}

/** Wipes all persisted read-only snapshots (called on sign-out). */
export async function clearOfflineCache(): Promise<void> {
  const db = await openCacheDb();
  if (!db) return;
  try {
    await db.runAsync('DELETE FROM query_cache');
  } catch {
    // Non-fatal.
  }
}
