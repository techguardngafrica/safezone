import { createHash } from 'node:crypto';

/** JSON with sorted keys at every level, so the same record always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
}

/** hash = sha256(prev_hash + canonical_json(record)) (modules/audit.md §4). */
export function chainHash(prevHash: string | null, record: Record<string, unknown>): string {
  return createHash('sha256')
    .update(`${prevHash ?? ''}${canonicalJson(record)}`)
    .digest('hex');
}

/** Fields that go into the hash, in a fixed shape. */
export interface ChainedRecord {
  id: string;
  occurredAt: string;
  estateId: string | null;
  actorType: string;
  actorId: string | null;
  actingRole: string | null;
  supportSessionId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  ip: string | null;
  userAgent: string | null;
  deviceId: string | null;
  app: string | null;
  requestId: string | null;
  sourceEventId: string | null;
}

/** Verifies a stream in seq order. Returns the id of the first broken record, or null when intact. */
export function verifyChain(
  records: readonly (ChainedRecord & { hash: string; prevHash: string | null })[],
): string | null {
  let previous: string | null = null;
  for (const record of records) {
    const { hash, prevHash, ...fields } = record;
    if (
      prevHash !== previous ||
      chainHash(previous, fields as unknown as Record<string, unknown>) !== hash
    ) {
      return record.id;
    }
    previous = hash;
  }
  return null;
}
