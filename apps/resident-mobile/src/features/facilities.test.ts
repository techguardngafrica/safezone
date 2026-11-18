import { describe, expect, it } from 'vitest';
import {
  type Availability,
  bookableDates,
  bookingPrice,
  durationOptions,
  freeStartTimes,
} from './facilities';

describe('bookingPrice', () => {
  it('charges started hours and days in full, like the backend', () => {
    expect(bookingPrice({ basis: 'hourly', amount: 500_000 }, 90)).toBe(1_000_000);
    expect(bookingPrice({ basis: 'daily', amount: 2_000_000 }, 1500)).toBe(4_000_000);
    expect(bookingPrice({ basis: 'flat', amount: 300_000 }, 600)).toBe(300_000);
    expect(bookingPrice({ basis: 'free' }, 60)).toBe(0);
  });
});

describe('durationOptions', () => {
  const policy = (minMinutes: number, maxMinutes: number) => ({ minMinutes, maxMinutes }) as never;
  it('steps by 30 minutes for short ranges', () => {
    expect(durationOptions(policy(60, 120))).toEqual([60, 90, 120]);
  });
  it('steps by an hour for long ranges and caps at 8 options', () => {
    expect(durationOptions(policy(60, 480))).toEqual([60, 120, 180, 240, 300, 360, 420, 480]);
  });
});

describe('freeStartTimes', () => {
  // 08:00 to 12:00 WAT on 20 Nov 2026, booked 09:00 to 10:00.
  const availability: Availability = {
    date: '2026-11-20',
    open: [{ from: '2026-11-20T07:00:00.000Z', to: '2026-11-20T11:00:00.000Z' }],
    busy: [{ from: '2026-11-20T08:00:00.000Z', to: '2026-11-20T09:00:00.000Z', kind: 'booking' }],
  };
  const early = Date.parse('2026-11-19T00:00:00Z');
  it('skips times that would overlap a booking', () => {
    expect(freeStartTimes(availability, 60, 0, early)).toEqual([
      '2026-11-20T07:00:00.000Z',
      '2026-11-20T09:00:00.000Z',
      '2026-11-20T09:30:00.000Z',
      '2026-11-20T10:00:00.000Z',
    ]);
  });
  it('keeps the buffer clear and drops past times', () => {
    expect(freeStartTimes(availability, 60, 30, Date.parse('2026-11-20T07:15:00Z'))).toEqual([
      '2026-11-20T09:30:00.000Z',
      '2026-11-20T10:00:00.000Z',
    ]);
  });
});

describe('bookableDates', () => {
  it('starts today in WAT and respects advance days', () => {
    expect(bookableDates(2, 14, Date.parse('2026-11-19T23:30:00Z'))).toEqual([
      '2026-11-20',
      '2026-11-21',
      '2026-11-22',
    ]);
  });
});
