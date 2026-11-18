import { describe, expect, it } from 'vitest';
import { checkMember, checkPlate, checkStaff, normaliseTime } from './household';

const phone = (input: string) =>
  input.replace(/\s/g, '') === '08031234567' ? '+2348031234567' : null;

describe('checkMember', () => {
  it('needs a phone for adults but not for minors', () => {
    expect(checkMember({ fullName: 'Ada', phone: '', isMinor: false }, phone).ok).toBe(false);
    expect(checkMember({ fullName: 'Tobi', phone: '', isMinor: true }, phone)).toEqual({
      ok: true,
      fullName: 'Tobi',
    });
  });
  it('normalises a local phone number', () => {
    expect(checkMember({ fullName: 'Ada', phone: '0803 123 4567', isMinor: false }, phone)).toEqual(
      {
        ok: true,
        fullName: 'Ada',
        phone: '+2348031234567',
      },
    );
  });
});

describe('checkPlate', () => {
  it('upper-cases and removes spaces', () => {
    expect(checkPlate('lnd 123 ab')).toEqual({ ok: true, plate: 'LND123AB' });
    expect(checkPlate('ab').ok).toBe(false);
  });
});

describe('normaliseTime', () => {
  it('accepts common ways of writing a time', () => {
    expect(normaliseTime('8')).toBe('08:00');
    expect(normaliseTime('8:30')).toBe('08:30');
    expect(normaliseTime('0830')).toBe('08:30');
    expect(normaliseTime('17.45')).toBe('17:45');
    expect(normaliseTime('25:00')).toBeNull();
  });
});

describe('checkStaff', () => {
  it('builds the schedule and checks the window', () => {
    expect(
      checkStaff({ name: 'Bisi', phone: '', days: [3, 1], from: '8', to: '17:00' }, phone),
    ).toEqual({
      ok: true,
      name: 'Bisi',
      schedule: { days: [1, 3], from: '08:00', to: '17:00' },
    });
    const bad = checkStaff({ name: 'B', phone: '1', days: [], from: '18:00', to: '9:00' }, phone);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(['days', 'name', 'phone', 'to']);
  });
});
