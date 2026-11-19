import * as SQLite from 'expo-sqlite';
import type { ExpectedList, SigningKeys } from './verify';

/**
 * On-device store (security-mobile.md §8): the offline cache per estate and gate, and the ordered sync
 * queue of entries and exits recorded while offline. SQLite, not SecureStore: it holds no secrets, only
 * the minimum visitor data the expected list already carries.
 */
let db: SQLite.SQLiteDatabase | null = null;

function database(): SQLite.SQLiteDatabase {
  if (db) return db;
  db = SQLite.openDatabaseSync('safezone-security.db');
  db.execSync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS queue (
      client_uuid TEXT PRIMARY KEY NOT NULL,
      estate_id TEXT NOT NULL,
      pass_id TEXT,
      direction TEXT NOT NULL,
      decision TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  return db;
}

function read<T>(key: string): T | null {
  const row = database().getFirstSync<{ value: string }>('SELECT value FROM cache WHERE key = ?', [
    key,
  ]);
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  database().runSync('INSERT OR REPLACE INTO cache (key, value) VALUES (?, ?)', [
    key,
    JSON.stringify(value),
  ]);
}

export interface RevocationState {
  /** Server time of the last successful fetch; the next fetch asks for changes since then. */
  syncedAt: string;
  passIds: string[];
}

export const offlineStore = {
  /** Last good API answer for start-up data (memberships, permissions, gates), so a gate phone starts offline. */
  snapshot: <T>(key: string) => read<T>(`snapshot:${key}`),
  setSnapshot: (key: string, value: unknown) => write(`snapshot:${key}`, value),

  keys: (estateId: string) => read<SigningKeys>(`keys:${estateId}`) ?? [],
  setKeys: (estateId: string, keys: SigningKeys) => write(`keys:${estateId}`, keys),

  expected: (estateId: string, gateId: string) =>
    read<ExpectedList>(`expected:${estateId}:${gateId}`),
  setExpected: (estateId: string, gateId: string, list: ExpectedList) =>
    write(`expected:${estateId}:${gateId}`, list),

  revocations: (estateId: string) => read<RevocationState>(`revocations:${estateId}`),
  setRevocations: (estateId: string, state: RevocationState) =>
    write(`revocations:${estateId}`, state),

  enqueue(estateId: string, event: QueuedEvent): void {
    database().runSync(
      `INSERT OR IGNORE INTO queue (client_uuid, estate_id, pass_id, direction, decision, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        event.clientUuid,
        estateId,
        event.passId ?? null,
        event.direction,
        event.decision,
        serialiseEvent(event),
        Date.now(),
      ],
    );
  },

  /** Oldest first, so the server sees events in the order they happened. */
  pending(estateId: string, limit = 500): QueuedEvent[] {
    return database()
      .getAllSync<{ body: string }>(
        'SELECT body FROM queue WHERE estate_id = ? ORDER BY created_at ASC LIMIT ?',
        [estateId, limit],
      )
      .map((row) => JSON.parse(row.body) as QueuedEvent);
  },

  pendingCount(estateId: string): number {
    return (
      database().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM queue WHERE estate_id = ?',
        [estateId],
      )?.count ?? 0
    );
  },

  /** Queued entries per pass, counted as uses by the offline check. */
  pendingUses(estateId: string): Map<string, number> {
    const rows = database().getAllSync<{ pass_id: string; count: number }>(
      `SELECT pass_id, COUNT(*) AS count FROM queue
       WHERE estate_id = ? AND pass_id IS NOT NULL AND direction = 'in' AND decision != 'deny'
       GROUP BY pass_id`,
      [estateId],
    );
    return new Map(rows.map((row) => [row.pass_id, row.count]));
  },

  remove(clientUuids: string[]): void {
    if (clientUuids.length === 0) return;
    const marks = clientUuids.map(() => '?').join(',');
    database().runSync(`DELETE FROM queue WHERE client_uuid IN (${marks})`, clientUuids);
  },
};

/** The body of POST gate/events and one item of POST gate/sync. */
export interface QueuedEvent {
  clientUuid: string;
  gateId: string;
  direction: 'in' | 'out';
  passId?: string;
  walkinId?: string;
  visitorName?: string;
  vehiclePlate?: string;
  decision: 'allow' | 'check' | 'deny' | 'override';
  reason?: string;
  occurredAt: string;
  /** Set when recorded under an offline PIN sign-in: synced with the device credential (ADR-0017). */
  offlineGuardUserId?: string;
}

function serialiseEvent(event: QueuedEvent): string {
  return JSON.stringify(event);
}
