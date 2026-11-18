import { describe, expect, it } from 'vitest';
import { availableWindows, checkVisitor, passValidity } from './passes';

// 10:00 WAT on 14 Nov 2026.
const now = Date.parse('2026-11-14T09:00:00Z');

describe('passValidity', () => {
  it('builds WAT windows for tomorrow', () => {
    expect(passValidity(1, 'morning', now)).toEqual({
      validFrom: '2026-11-15T07:00:00.000Z',
      validTo: '2026-11-15T11:00:00.000Z',
    });
  });

  it('starts today windows no earlier than now', () => {
    expect(passValidity(0, 'morning', now).validFrom).toBe('2026-11-14T09:00:00.000Z');
  });

  it('covers the whole day for all day', () => {
    expect(passValidity(1, 'allDay', now)).toEqual({
      validFrom: '2026-11-14T23:00:00.000Z',
      validTo: '2026-11-15T22:59:00.000Z',
    });
  });
});

describe('availableWindows', () => {
  it('drops windows that are over today', () => {
    const late = Date.parse('2026-11-14T20:00:00Z'); // 21:00 WAT
    expect(availableWindows(0, late)).toEqual(['next2', 'next4', 'evening', 'allDay']);
  });

  it('offers no "next hours" options for later days', () => {
    expect(availableWindows(2, now)).toEqual(['morning', 'afternoon', 'evening', 'allDay']);
  });
});

describe('checkVisitor', () => {
  const normalise = (input: string) =>
    input.replace(/\s/g, '') === '08031234567' ? '+2348031234567' : null;

  it('normalises a local phone number and the plate', () => {
    expect(
      checkVisitor({ name: ' Tunde ', phone: '0803 123 4567', plate: 'lnd 123 ab' }, normalise),
    ).toEqual({
      ok: true,
      visitor: { name: 'Tunde', phone: '+2348031234567', vehiclePlate: 'LND123AB' },
    });
  });

  it('allows the optional fields to be empty', () => {
    expect(checkVisitor({ name: 'Ada', phone: '', plate: '' }, normalise)).toEqual({
      ok: true,
      visitor: { name: 'Ada' },
    });
  });

  it('names every invalid field', () => {
    const result = checkVisitor({ name: 'A', phone: '12345', plate: 'AB' }, normalise);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['name', 'phone', 'plate']);
  });
});
