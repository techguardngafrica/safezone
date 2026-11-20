import { describe, expect, it } from 'vitest';
import { canonicalRoom, parseRoom, staffMayJoin } from './room-auth';

const ESTATE = '0195a000-0000-7000-8000-000000000001';
const GATE = '0195a000-0000-7000-8000-000000000002';

describe('parseRoom', () => {
  it('parses valid estate and channel room names', () => {
    expect(parseRoom(`estate:${ESTATE}:sos`)).toEqual({ kind: 'sos', estateId: ESTATE });
    expect(parseRoom(`estate:${ESTATE}:security`)).toEqual({ kind: 'security', estateId: ESTATE });
    expect(parseRoom(`estate:${ESTATE}:gate:${GATE}`)).toEqual({
      kind: 'gate',
      estateId: ESTATE,
      gateId: GATE,
    });
    expect(parseRoom(`estate:${ESTATE}:dashboard`)).toEqual({
      kind: 'dashboard',
      estateId: ESTATE,
    });
    expect(parseRoom(`estate:${ESTATE}:channel:${GATE}`)).toEqual({
      kind: 'channel',
      estateId: ESTATE,
      channelId: GATE,
    });
  });

  it('rejects malformed or arbitrary rooms', () => {
    expect(parseRoom('')).toBeNull();
    expect(parseRoom('user:123')).toBeNull();
    expect(parseRoom('estate:not-a-uuid:sos')).toBeNull();
    expect(parseRoom(`estate:${ESTATE}:admin`)).toBeNull();
  });
});

describe('canonicalRoom', () => {
  it('lowercases ids so an uppercase join still receives lowercase publishes', () => {
    const parsed = parseRoom(`estate:${ESTATE.toUpperCase()}:gate:${GATE.toUpperCase()}`);
    expect(parsed).not.toBeNull();
    expect(parsed && canonicalRoom(parsed)).toBe(`estate:${ESTATE}:gate:${GATE}`);
  });
});

describe('staffMayJoin', () => {
  it('needs staff permissions for every estate-wide room', () => {
    const none = new Set<string>();
    for (const kind of ['sos', 'security', 'gate', 'dashboard'] as const) {
      expect(staffMayJoin(kind, none)).toBe(false);
    }
  });

  it('lets responders into sos and the dashboard, guards into gate rooms', () => {
    const responder = new Set(['sos.respond']);
    expect(staffMayJoin('sos', responder)).toBe(true);
    expect(staffMayJoin('dashboard', responder)).toBe(true);
    expect(staffMayJoin('security', responder)).toBe(false);
    const guard = new Set(['gate.verify']);
    expect(staffMayJoin('gate', guard)).toBe(true);
    expect(staffMayJoin('sos', guard)).toBe(false);
  });
});
