import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import type { ApiData } from '@safezone/api-client';
import { decideEntry, normalisePlate, type DecisionResult } from './decide';
import { parsePassToken, signatureValid } from './pass-token';

export type ExpectedList = ApiData<'/v1/estates/{estateId}/gate/expected', 'get'>;
export type ExpectedPass = ExpectedList['passes'][number];
export type SigningKeys = ApiData<'/v1/estates/{estateId}/gate/keys', 'get'>;
export type VerifyResult = ApiData<'/v1/estates/{estateId}/gate/verify', 'post'> & {
  offline: boolean;
};

/** Everything a gate device keeps on disk to check passes without the API (security-mobile.md §8). */
export interface OfflineCache {
  estateId: string;
  gateId: string;
  keys: SigningKeys;
  expected: ExpectedList | null;
  revokedPassIds: ReadonlySet<string>;
  /** Entries recorded on this device but not yet synced, per pass id (counted as uses). */
  pendingUses: ReadonlyMap<string, number>;
}

export type Credential = { qr: string } | { pin: string };

/** sha256(passId ":" pin) in hex, as the API puts in the expected list (ADR-0010 §3). */
export function pinDigest(passId: string, pin: string): string {
  return bytesToHex(sha256(utf8ToBytes(`${passId}:${pin}`)));
}

function isRestricted(cache: OfflineCache, pass: ExpectedPass): boolean {
  const restricted = cache.expected?.restricted ?? [];
  const plate = pass.vehiclePlate ? normalisePlate(pass.vehiclePlate) : null;
  const name = pass.visitorName.trim().toLowerCase();
  return restricted.some(
    (item) =>
      (plate !== null && item.plate !== null && normalisePlate(item.plate) === plate) ||
      (item.name !== null && item.name.trim().toLowerCase() === name),
  );
}

function deny(reason: string): VerifyResult {
  return { decision: 'deny', reasons: [reason], pass: null, offline: true };
}

function usesOf(cache: OfflineCache, passId: string, cached: number): number {
  return cached + (cache.pendingUses.get(passId) ?? 0);
}

function fromExpected(
  cache: OfflineCache,
  pass: ExpectedPass,
  direction: 'in' | 'out',
  now: Date,
): VerifyResult {
  const usesCount = usesOf(cache, pass.id, pass.usesCount);
  const result: DecisionResult =
    direction === 'out'
      ? { decision: 'allow', reasons: [] }
      : decideEntry(
          {
            validFrom: new Date(pass.validFrom),
            validTo: new Date(pass.validTo),
            recurrence: pass.recurrence,
            maxUses: pass.maxUses,
            usesCount,
            revoked: cache.revokedPassIds.has(pass.id),
            gateIds: pass.gateIds,
          },
          { now, gateId: cache.gateId, restricted: isRestricted(cache, pass) },
        );
  return {
    ...result,
    offline: true,
    pass: {
      id: pass.id,
      type: pass.type,
      visitorName: pass.visitorName,
      vehiclePlate: pass.vehiclePlate,
      unitCode: pass.unitCode,
      usesLeft: pass.maxUses === null ? null : Math.max(0, pass.maxUses - usesCount),
      validTo: pass.validTo,
    },
  };
}

/**
 * Offline verification (security-mobile.md §7.2): Ed25519 signature with the cached estate key, validity
 * window, gate, uses and the local revocation list. A signed pass that is missing from the expected list
 * (issued after the last sync) is never ALLOW: its gate and schedule are unknown, so the guard sees CHECK.
 */
export function verifyOffline(
  cache: OfflineCache,
  credential: Credential,
  direction: 'in' | 'out',
  now: Date = new Date(),
): VerifyResult {
  if ('pin' in credential) {
    const candidates = (cache.expected?.passes ?? []).filter(
      (pass) =>
        !cache.revokedPassIds.has(pass.id) && pass.pinDigest === pinDigest(pass.id, credential.pin),
    );
    const [first] = candidates;
    if (!first) return deny('unknown_pass');
    const result = fromExpected(cache, first, direction, now);
    if (candidates.length > 1 && result.decision === 'allow')
      return { ...result, decision: 'check', reasons: ['ambiguous_pin'] };
    return result;
  }

  const parsed = parsePassToken(credential.qr);
  if (!parsed) return deny('invalid_qr');
  const key = cache.keys.find((item) => item.keyIndex === parsed.claims.keyIndex);
  if (!key || !signatureValid(parsed, key.publicKey)) return deny('invalid_qr');
  if (parsed.claims.estateId !== cache.estateId) return deny('wrong_estate');

  const listed = cache.expected?.passes.find((pass) => pass.id === parsed.claims.passId);
  if (listed) return fromExpected(cache, listed, direction, now);

  const { claims } = parsed;
  const maxUses = claims.maxUses === 0 ? null : claims.maxUses;
  const usesCount = usesOf(cache, claims.passId, 0);
  const base: DecisionResult =
    direction === 'out'
      ? { decision: 'allow', reasons: [] }
      : decideEntry(
          {
            validFrom: claims.notBefore,
            validTo: claims.notAfter,
            recurrence: null,
            maxUses,
            usesCount,
            revoked: cache.revokedPassIds.has(claims.passId),
            gateIds: [],
          },
          { now, gateId: cache.gateId, restricted: false },
        );
  const result: DecisionResult =
    base.decision === 'allow' && direction === 'in'
      ? { decision: 'check', reasons: ['not_in_offline_list'] }
      : base;
  return {
    ...result,
    offline: true,
    pass: {
      id: claims.passId,
      type: 'one_time',
      visitorName: '',
      vehiclePlate: null,
      unitCode: null,
      usesLeft: maxUses === null ? null : Math.max(0, maxUses - usesCount),
      validTo: claims.notAfter.toISOString(),
    },
  };
}

/**
 * A pass the guard picked from the expected list by name, without seeing its QR or PIN. Same rules, but
 * never stronger than CHECK: the guard must confirm who is at the gate.
 */
export function verifyListed(
  cache: OfflineCache,
  passId: string,
  direction: 'in' | 'out',
  now: Date = new Date(),
): VerifyResult {
  const pass = cache.expected?.passes.find((item) => item.id === passId);
  if (!pass) return deny('unknown_pass');
  const result = fromExpected(cache, pass, direction, now);
  if (result.decision === 'allow' && direction === 'in')
    return { ...result, decision: 'check', reasons: ['picked_from_list'] };
  return result;
}
