import { describe, expect, it } from 'vitest';
import { parseRoom } from './room-auth';

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
