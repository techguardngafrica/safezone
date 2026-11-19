import { describe, expect, it } from 'vitest';
import {
  afterWrongPin,
  encodeDeviceCredential,
  gateCeiling,
  guardDisplayName,
  parseDeviceCredential,
  pinWeakness,
} from './gate-access';

const ESTATE = '0193a1b2-0000-7000-8000-000000000001';
const DEVICE = '0193a1b2-0000-7000-8000-0000000000d1';
const SECRET = 'A'.repeat(43);

describe('PIN rules', () => {
  it.each(['482913', '905127', '370418'])('accepts %s', (pin) => {
    expect(pinWeakness(pin)).toBeNull();
  });
  it.each(['12345', '1234567', 'abcdef', '12 456'])('rejects the format of %s', (pin) => {
    expect(pinWeakness(pin)).toBe('format');
  });
  it.each(['000000', '999999', '123456', '654321', '345678', '121212'])(
    'rejects weak %s',
    (pin) => {
      expect(pinWeakness(pin)).toBe('weak');
    },
  );
});

describe('device credential', () => {
  it('round-trips estate, device and secret', () => {
    const credential = encodeDeviceCredential(ESTATE, DEVICE, SECRET);
    expect(parseDeviceCredential(credential)).toEqual({
      estateId: ESTATE,
      deviceId: DEVICE,
      secret: SECRET,
    });
  });

  it.each([
    'gd0.abc',
    `gd1.${'0'.repeat(32)}.${'1'.repeat(32)}`,
    `gd1.${'z'.repeat(32)}.${'1'.repeat(32)}.${SECRET}`,
    `gd1.${'0'.repeat(32)}.${'1'.repeat(32)}.${SECRET}.extra`,
    `gd1.${'0'.repeat(32)}.${'1'.repeat(32)}.short`,
  ])('rejects malformed %s', (credential) => {
    expect(parseDeviceCredential(credential)).toBeNull();
  });
});

describe('guard names and lockout', () => {
  it('shows first name and last initial only', () => {
    expect(guardDisplayName('Ada Chioma Obi', 'Guard')).toBe('Ada O.');
    expect(guardDisplayName('Musa', 'Guard')).toBe('Musa');
    expect(guardDisplayName(null, 'Guard 4567')).toBe('Guard 4567');
  });

  it('locks on the fifth wrong PIN', () => {
    expect(afterWrongPin(0)).toEqual({ attempts: 1, locked: false });
    expect(afterWrongPin(3)).toEqual({ attempts: 4, locked: false });
    expect(afterWrongPin(4)).toEqual({ attempts: 5, locked: true });
  });
});

describe('gate session ceiling', () => {
  it('keeps only gate work the guard already has', () => {
    expect([
      ...gateCeiling(new Set(['gate.verify', 'sos.respond', 'security.staff.manage', 'pii.view'])),
    ]).toEqual(['gate.verify', 'sos.respond']);
  });
});
