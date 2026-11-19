// Node types only for the API-compatibility test (node:crypto signs like the backend does).
/// <reference types="node" />
import { generateKeyPairSync, sign } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519';
import { describe, expect, it } from 'vitest';
import { decideEntry, minutesOutsideRecurrence, normalisePlate, type PassFacts } from './decide';
import { base64UrlDecode, parsePassToken } from './pass-token';
import {
  pinDigest,
  verifyListed,
  verifyOffline,
  type ExpectedPass,
  type OfflineCache,
} from './verify';

const ESTATE = '0193a1b2-0000-7000-8000-000000000001';
const OTHER_ESTATE = '0193a1b2-0000-7000-8000-000000000099';
const GATE = '0193a1b2-0000-7000-8000-0000000000a1';
const OTHER_GATE = '0193a1b2-0000-7000-8000-0000000000a2';
const PASS = '0193a1b2-0000-7000-8000-0000000000b1';
const NOW = new Date('2026-11-19T10:00:00Z'); // Thursday 11:00 WAT

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function uuidBytes(uuid: string): number[] {
  const hex = uuid.replace(/-/g, '');
  return Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
}

/** Same layout as the API's signPassToken. */
function signToken(
  secret: Uint8Array,
  claims: { passId: string; estateId: string; from: Date; to: Date; maxUses: number; key: number },
): string {
  const body = new Uint8Array(45);
  const view = new DataView(body.buffer);
  body[0] = 1;
  body.set(uuidBytes(claims.passId), 1);
  body.set(uuidBytes(claims.estateId), 17);
  view.setUint32(33, Math.floor(claims.from.getTime() / 1000));
  view.setUint32(37, Math.floor(claims.to.getTime() / 1000));
  view.setUint16(41, claims.maxUses);
  view.setUint16(43, claims.key);
  const signature = ed25519.sign(body, secret);
  const all = new Uint8Array(109);
  all.set(body);
  all.set(signature, 45);
  return base64Url(all);
}

const secret = ed25519.utils.randomPrivateKey();
const publicKey = base64Url(ed25519.getPublicKey(secret));
const window = {
  from: new Date('2026-11-19T08:00:00Z'),
  to: new Date('2026-11-19T18:00:00Z'),
};

function expectedPass(overrides: Partial<ExpectedPass> = {}): ExpectedPass {
  return {
    id: PASS,
    type: 'one_time',
    visitorName: 'Ada Obi',
    vehiclePlate: 'LND-123-AB',
    unitCode: 'B2-04',
    validFrom: window.from.toISOString(),
    validTo: window.to.toISOString(),
    recurrence: null,
    gateIds: [],
    maxUses: 1,
    usesCount: 0,
    pinDigest: pinDigest(PASS, '482913'),
    ...overrides,
  };
}

function cache(overrides: Partial<OfflineCache> = {}): OfflineCache {
  return {
    estateId: ESTATE,
    gateId: GATE,
    keys: [{ keyIndex: 1, publicKey, activeFrom: '2026-01-01T00:00:00Z', activeTo: null }],
    expected: { generatedAt: NOW.toISOString(), passes: [expectedPass()], restricted: [] },
    revokedPassIds: new Set(),
    pendingUses: new Map(),
    ...overrides,
  };
}

const token = signToken(secret, {
  passId: PASS,
  estateId: ESTATE,
  ...window,
  maxUses: 1,
  key: 1,
});

describe('pass token', () => {
  it('decodes base64url and rejects foreign characters', () => {
    expect(Array.from(base64UrlDecode('AQID') ?? [])).toEqual([1, 2, 3]);
    expect(base64UrlDecode('AQ+D')).toBeNull();
  });

  it('parses the claims the API signs', () => {
    const parsed = parsePassToken(token);
    expect(parsed?.claims).toEqual({
      passId: PASS,
      estateId: ESTATE,
      notBefore: window.from,
      notAfter: window.to,
      maxUses: 1,
      keyIndex: 1,
    });
  });

  it('verifies a token signed the way the API signs it (node:crypto, raw key from SPKI)', () => {
    const pair = generateKeyPairSync('ed25519');
    const spki = pair.publicKey.export({ format: 'der', type: 'spki' });
    const raw = base64UrlDecode(token) as Uint8Array;
    const body = raw.subarray(0, 45);
    const signature = sign(null, body, pair.privateKey);
    const all = new Uint8Array(109);
    all.set(body);
    all.set(signature, 45);
    const serverKey = base64Url(new Uint8Array(spki.subarray(spki.length - 32)));
    const result = verifyOffline(
      cache({
        keys: [
          { keyIndex: 1, publicKey: serverKey, activeFrom: NOW.toISOString(), activeTo: null },
        ],
      }),
      { qr: base64Url(all) },
      'in',
      NOW,
    );
    expect(result.decision).toBe('allow');
  });

  it('rejects malformed tokens', () => {
    expect(parsePassToken('not a token')).toBeNull();
    expect(parsePassToken(token.slice(0, 100))).toBeNull();
  });
});

describe('verifyOffline (QR)', () => {
  it('allows a valid signed pass from the expected list', () => {
    const result = verifyOffline(cache(), { qr: token }, 'in', NOW);
    expect(result.decision).toBe('allow');
    expect(result.pass?.visitorName).toBe('Ada Obi');
    expect(result.offline).toBe(true);
  });

  it('denies a tampered token', () => {
    const raw = base64UrlDecode(token) as Uint8Array;
    raw[40] = (raw[40] ?? 0) ^ 0xff; // extend notAfter
    const result = verifyOffline(cache(), { qr: base64Url(raw) }, 'in', NOW);
    expect(result).toMatchObject({ decision: 'deny', reasons: ['invalid_qr'] });
  });

  it('denies a token signed by another key', () => {
    const other = signToken(ed25519.utils.randomPrivateKey(), {
      passId: PASS,
      estateId: ESTATE,
      ...window,
      maxUses: 1,
      key: 1,
    });
    expect(verifyOffline(cache(), { qr: other }, 'in', NOW).reasons).toEqual(['invalid_qr']);
  });

  it('denies an unknown key index', () => {
    expect(verifyOffline(cache({ keys: [] }), { qr: token }, 'in', NOW).reasons).toEqual([
      'invalid_qr',
    ]);
  });

  it('denies a pass from another estate', () => {
    const foreign = signToken(secret, {
      passId: PASS,
      estateId: OTHER_ESTATE,
      ...window,
      maxUses: 1,
      key: 1,
    });
    expect(verifyOffline(cache(), { qr: foreign }, 'in', NOW).reasons).toEqual(['wrong_estate']);
  });

  it('denies a pass revoked before the last sync', () => {
    const result = verifyOffline(
      cache({ revokedPassIds: new Set([PASS]) }),
      { qr: token },
      'in',
      NOW,
    );
    expect(result).toMatchObject({ decision: 'deny', reasons: ['revoked'] });
  });

  it('counts entries waiting to sync as uses', () => {
    const result = verifyOffline(
      cache({ pendingUses: new Map([[PASS, 1]]) }),
      { qr: token },
      'in',
      NOW,
    );
    expect(result).toMatchObject({ decision: 'deny', reasons: ['no_uses_left'] });
  });

  it('always lets people leave', () => {
    const result = verifyOffline(
      cache({ revokedPassIds: new Set([PASS]) }),
      { qr: token },
      'out',
      NOW,
    );
    expect(result.decision).toBe('allow');
  });

  it('shows CHECK, never ALLOW, for a signed pass missing from the list', () => {
    const result = verifyOffline(cache({ expected: null }), { qr: token }, 'in', NOW);
    expect(result).toMatchObject({ decision: 'check', reasons: ['not_in_offline_list'] });
  });

  it('still denies an expired pass missing from the list', () => {
    const late = new Date(window.to.getTime() + 60 * 60_000);
    const result = verifyOffline(cache({ expected: null }), { qr: token }, 'in', late);
    expect(result).toMatchObject({ decision: 'deny', reasons: ['expired'] });
  });

  it('denies a restricted visitor by plate', () => {
    const restricted = cache({
      expected: {
        generatedAt: NOW.toISOString(),
        passes: [expectedPass()],
        restricted: [{ phone: null, plate: 'lnd 123 ab', name: null }],
      },
    });
    expect(verifyOffline(restricted, { qr: token }, 'in', NOW).reasons).toEqual([
      'restricted_visitor',
    ]);
  });
});

describe('verifyOffline (PIN)', () => {
  it('matches a typed PIN against the digest', () => {
    expect(verifyOffline(cache(), { pin: '482913' }, 'in', NOW).decision).toBe('allow');
    expect(verifyOffline(cache(), { pin: '000000' }, 'in', NOW).reasons).toEqual(['unknown_pass']);
  });

  it('ignores revoked passes for PIN lookup', () => {
    const result = verifyOffline(
      cache({ revokedPassIds: new Set([PASS]) }),
      { pin: '482913' },
      'in',
      NOW,
    );
    expect(result.reasons).toEqual(['unknown_pass']);
  });

  it('answers CHECK when two live passes share a PIN', () => {
    const second = '0193a1b2-0000-7000-8000-0000000000b2';
    const shared = cache({
      expected: {
        generatedAt: NOW.toISOString(),
        passes: [
          expectedPass(),
          expectedPass({ id: second, pinDigest: pinDigest(second, '482913') }),
        ],
        restricted: [],
      },
    });
    expect(verifyOffline(shared, { pin: '482913' }, 'in', NOW)).toMatchObject({
      decision: 'check',
      reasons: ['ambiguous_pin'],
    });
  });
});

describe('verifyListed', () => {
  it('is never stronger than CHECK for a pass picked by name', () => {
    expect(verifyListed(cache(), PASS, 'in', NOW)).toMatchObject({
      decision: 'check',
      reasons: ['picked_from_list'],
    });
  });

  it('keeps DENY rules', () => {
    expect(
      verifyListed(cache({ revokedPassIds: new Set([PASS]) }), PASS, 'in', NOW).reasons,
    ).toEqual(['revoked']);
    expect(
      verifyListed(cache(), '0193a1b2-0000-7000-8000-0000000000ff', 'in', NOW).reasons,
    ).toEqual(['unknown_pass']);
  });
});

describe('decideEntry', () => {
  const facts: PassFacts = {
    validFrom: window.from,
    validTo: window.to,
    recurrence: null,
    maxUses: null,
    usesCount: 0,
    revoked: false,
    gateIds: [],
  };
  const at = (iso: string) => ({ now: new Date(iso), gateId: GATE, restricted: false });

  it('allows inside the window', () => {
    expect(decideEntry(facts, at('2026-11-19T10:00:00Z'))).toEqual({
      decision: 'allow',
      reasons: [],
    });
  });

  it('checks within the 15 minute grace (device clock slightly off)', () => {
    expect(decideEntry(facts, at('2026-11-19T07:50:00Z')).reasons).toEqual(['slightly_early']);
    expect(decideEntry(facts, at('2026-11-19T18:10:00Z')).reasons).toEqual(['slightly_late']);
  });

  it('denies beyond the grace', () => {
    expect(decideEntry(facts, at('2026-11-19T07:40:00Z')).reasons).toEqual(['too_early']);
    expect(decideEntry(facts, at('2026-11-19T18:20:00Z')).reasons).toEqual(['expired']);
  });

  it('denies at another gate', () => {
    expect(
      decideEntry({ ...facts, gateIds: [OTHER_GATE] }, at('2026-11-19T10:00:00Z')).reasons,
    ).toEqual(['wrong_gate']);
  });

  it('enforces recurring days and hours in WAT', () => {
    const staff = { ...facts, recurrence: { days: [4], from: '08:00', to: '17:00' } };
    // 11:00 WAT Thursday
    expect(decideEntry(staff, at('2026-11-19T10:00:00Z')).decision).toBe('allow');
    // 17:10 WAT: inside grace
    expect(decideEntry(staff, at('2026-11-19T16:10:00Z')).reasons).toEqual(['outside_hours_grace']);
    // 17:30 WAT: outside
    expect(decideEntry(staff, at('2026-11-19T16:30:00Z')).reasons).toEqual(['outside_hours']);
    expect(
      decideEntry(
        { ...staff, validTo: new Date('2026-12-31T00:00:00Z') },
        at('2026-11-20T10:00:00Z'),
      ).reasons,
    ).toEqual(['not_scheduled_today']);
  });

  it('computes minutes outside the recurring window', () => {
    const rec = { days: [4], from: '08:00', to: '17:00' };
    expect(minutesOutsideRecurrence(rec, new Date('2026-11-19T06:30:00Z'))).toBe(30);
    expect(minutesOutsideRecurrence(rec, new Date('2026-11-18T10:00:00Z'))).toBe(Infinity);
  });

  it('normalises plates like the API', () => {
    expect(normalisePlate(' lnd-123 ab ')).toBe('LND123AB');
  });
});
