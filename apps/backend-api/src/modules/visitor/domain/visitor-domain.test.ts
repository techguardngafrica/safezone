import { describe, expect, it } from 'vitest';
import {
  generatePin,
  generateSigningKey,
  parsePassToken,
  privateKeyFromDer,
  publicKeyFromRaw,
  signPassToken,
  verifyPassToken,
} from './pass-token';
import {
  decideEntry,
  defaultMaxUses,
  minutesOutsideRecurrence,
  type PassFacts,
  passStatus,
} from './validity';

const claims = {
  passId: '01936b2e-0000-7000-8000-0000000000aa',
  estateId: '01936b2e-0000-7000-8000-000000000001',
  notBefore: new Date('2026-11-20T08:00:00Z'),
  notAfter: new Date('2026-11-20T20:00:00Z'),
  maxUses: 1,
  keyIndex: 1,
};

describe('pass token', () => {
  const key = generateSigningKey();
  const privateKey = privateKeyFromDer(key.privateKeyDer);
  const publicKey = publicKeyFromRaw(key.publicKeyRaw);

  it('round-trips signed claims in under 200 characters', () => {
    const token = signPassToken(claims, privateKey);
    expect(token.length).toBeLessThanOrEqual(200);
    expect(key.publicKeyRaw).toHaveLength(32);
    expect(verifyPassToken(token, publicKey)).toEqual(claims);
  });

  it('rejects tampering, other keys and garbage', () => {
    const token = signPassToken(claims, privateKey);
    const raw = Buffer.from(token, 'base64url');
    raw.writeUInt16BE(9, 41); // raise max uses
    expect(verifyPassToken(raw.toString('base64url'), publicKey)).toBeNull();
    const other = generateSigningKey();
    expect(verifyPassToken(token, publicKeyFromRaw(other.publicKeyRaw))).toBeNull();
    expect(verifyPassToken('not a token', publicKey)).toBeNull();
    expect(parsePassToken('AAAA')).toBeNull();
  });

  it('makes six-digit PINs', () => {
    for (let index = 0; index < 100; index += 1) expect(generatePin()).toMatch(/^\d{6}$/);
  });
});

const base: PassFacts = {
  type: 'one_time',
  validFrom: new Date('2026-11-20T08:00:00Z'),
  validTo: new Date('2026-11-20T20:00:00Z'),
  recurrence: null,
  maxUses: 1,
  usesCount: 0,
  revokedAt: null,
  gateIds: [],
};
const at = (iso: string) => ({ now: new Date(iso), gateId: 'gate-a', restricted: false });

describe('entry decisions', () => {
  it('allows inside the window and checks within the grace period', () => {
    expect(decideEntry(base, at('2026-11-20T12:00:00Z'))).toEqual({
      decision: 'allow',
      reasons: [],
    });
    expect(decideEntry(base, at('2026-11-20T07:50:00Z'))).toEqual({
      decision: 'check',
      reasons: ['slightly_early'],
    });
    expect(decideEntry(base, at('2026-11-20T20:10:00Z'))).toEqual({
      decision: 'check',
      reasons: ['slightly_late'],
    });
    expect(decideEntry(base, at('2026-11-20T07:30:00Z')).reasons).toEqual(['too_early']);
    expect(decideEntry(base, at('2026-11-20T20:30:00Z')).reasons).toEqual(['expired']);
  });

  it('denies revoked, used, restricted and wrong-gate passes', () => {
    const now = at('2026-11-20T12:00:00Z');
    expect(decideEntry({ ...base, revokedAt: new Date() }, now).reasons).toEqual(['revoked']);
    expect(decideEntry({ ...base, usesCount: 1 }, now).reasons).toEqual(['no_uses_left']);
    expect(decideEntry(base, { ...now, restricted: true }).reasons).toEqual(['restricted_visitor']);
    expect(decideEntry({ ...base, gateIds: ['gate-b'] }, now).reasons).toEqual(['wrong_gate']);
    expect(decideEntry({ ...base, gateIds: ['gate-a'] }, now).decision).toBe('allow');
  });

  it('follows recurring schedules in Lagos time', () => {
    // Mon/Wed/Fri 08:00-16:00 WAT. 2026-11-23 is a Monday.
    const recurring: PassFacts = {
      ...base,
      type: 'domestic_staff',
      validFrom: new Date('2026-11-01T00:00:00Z'),
      validTo: new Date('2027-05-01T00:00:00Z'),
      maxUses: null,
      recurrence: { days: [1, 3, 5], from: '08:00', to: '16:00' },
    };
    expect(decideEntry(recurring, at('2026-11-23T07:30:00Z')).decision).toBe('allow'); // 08:30 WAT
    expect(decideEntry(recurring, at('2026-11-23T06:50:00Z'))).toEqual({
      decision: 'check',
      reasons: ['outside_hours_grace'],
    });
    expect(decideEntry(recurring, at('2026-11-23T05:00:00Z')).reasons).toEqual(['outside_hours']);
    expect(decideEntry(recurring, at('2026-11-24T09:00:00Z')).reasons).toEqual([
      'not_scheduled_today',
    ]);
    expect(minutesOutsideRecurrence(recurring.recurrence!, new Date('2026-11-23T15:30:00Z'))).toBe(
      30,
    );
  });

  it('derives status and default uses', () => {
    expect(passStatus(base, new Date('2026-11-19T00:00:00Z'))).toBe('scheduled');
    expect(passStatus(base, new Date('2026-11-20T10:00:00Z'))).toBe('active');
    expect(passStatus({ ...base, usesCount: 1 }, new Date('2026-11-20T10:00:00Z'))).toBe('used');
    expect(passStatus(base, new Date('2026-11-21T00:00:00Z'))).toBe('expired');
    expect(passStatus({ ...base, revokedAt: new Date() })).toBe('revoked');
    expect(defaultMaxUses('one_time', 9)).toBe(1);
    expect(defaultMaxUses('multi_entry', 3)).toBe(3);
    expect(defaultMaxUses('recurring', undefined)).toBeNull();
  });
});
