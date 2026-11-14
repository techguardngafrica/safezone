import { facilityPolicySchema } from '@safezone/schemas';
import { describe, expect, it } from 'vitest';
import {
  bookingPrice,
  cancellationRefund,
  checkPolicy,
  openWindows,
  usageWindows,
  watInstant,
  withinOpeningHours,
} from './facilities';

const everyDay = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: '08:00', close: '20:00' }));
const policy = facilityPolicySchema.parse({ maxGuests: 50, perHouseholdPerWeek: 2 });
const now = new Date('2027-03-01T08:00:00+01:00');

describe('opening hours (WAT)', () => {
  it('accepts bookings inside a slot and rejects ones that overflow or cross midnight', () => {
    expect(
      withinOpeningHours(
        everyDay,
        watInstant('2027-03-02', '08:00'),
        watInstant('2027-03-02', '20:00'),
      ),
    ).toBe(true);
    expect(
      withinOpeningHours(
        everyDay,
        watInstant('2027-03-02', '19:00'),
        watInstant('2027-03-02', '20:30'),
      ),
    ).toBe(false);
    expect(
      withinOpeningHours(
        everyDay,
        watInstant('2027-03-02', '07:30'),
        watInstant('2027-03-02', '09:00'),
      ),
    ).toBe(false);
    expect(
      withinOpeningHours(
        everyDay,
        watInstant('2027-03-02', '23:00'),
        watInstant('2027-03-03', '01:00'),
      ),
    ).toBe(false);
  });

  it('lists the windows for a date', () => {
    const weekdays = [{ day: 1, open: '09:00', close: '12:00' }];
    expect(openWindows(weekdays, '2027-03-01').map((w) => w.from.toISOString())).toEqual([
      '2027-03-01T08:00:00.000Z',
    ]);
    expect(openWindows(weekdays, '2027-03-02')).toEqual([]);
  });
});

describe('policy', () => {
  const slot = {
    start: watInstant('2027-03-03', '10:00'),
    end: watInstant('2027-03-03', '12:00'),
    guests: 10,
  };
  it('passes a valid request', () => {
    expect(checkPolicy(policy, everyDay, slot, { thisWeek: 1, thisMonth: 1 }, now)).toBeNull();
  });
  it('reports each broken rule', () => {
    expect(
      checkPolicy(
        policy,
        everyDay,
        { ...slot, end: watInstant('2027-03-03', '10:30') },
        { thisWeek: 0, thisMonth: 0 },
        now,
      ),
    ).toBe('too_short');
    expect(
      checkPolicy(
        policy,
        everyDay,
        { ...slot, end: watInstant('2027-03-03', '18:00') },
        { thisWeek: 0, thisMonth: 0 },
        now,
      ),
    ).toBe('too_long');
    expect(
      checkPolicy(policy, everyDay, { ...slot, guests: 51 }, { thisWeek: 0, thisMonth: 0 }, now),
    ).toBe('too_many_guests');
    expect(checkPolicy(policy, everyDay, slot, { thisWeek: 2, thisMonth: 2 }, now)).toBe(
      'weekly_limit',
    );
    expect(
      checkPolicy(
        policy,
        everyDay,
        {
          ...slot,
          start: watInstant('2027-05-03', '10:00'),
          end: watInstant('2027-05-03', '12:00'),
        },
        { thisWeek: 0, thisMonth: 0 },
        now,
      ),
    ).toBe('too_far_ahead');
    expect(
      checkPolicy(
        policy,
        everyDay,
        { ...slot, start: new Date(now.getTime() - 1) },
        { thisWeek: 0, thisMonth: 0 },
        now,
      ),
    ).toBe('in_past');
  });
});

describe('price and refunds', () => {
  const start = watInstant('2027-03-03', '10:00');
  it('charges per started hour or day', () => {
    expect(
      bookingPrice(
        { basis: 'hourly', amount: 500_000 },
        start,
        new Date(start.getTime() + 90 * 60_000),
      ),
    ).toBe(1_000_000);
    expect(
      bookingPrice(
        { basis: 'daily', amount: 2_000_000 },
        start,
        new Date(start.getTime() + 25 * 3_600_000),
      ),
    ).toBe(4_000_000);
    expect(
      bookingPrice(
        { basis: 'flat', amount: 300_000 },
        start,
        new Date(start.getTime() + 3_600_000),
      ),
    ).toBe(300_000);
    expect(bookingPrice({ basis: 'free' }, start, new Date(start.getTime() + 3_600_000))).toBe(0);
  });
  it('refunds by notice given', () => {
    expect(
      cancellationRefund(policy, 10_000, start, new Date(start.getTime() - 25 * 3_600_000)),
    ).toBe(10_000);
    expect(
      cancellationRefund(policy, 10_000, start, new Date(start.getTime() - 3 * 3_600_000)),
    ).toBe(5_000);
    expect(cancellationRefund(policy, 10_000, start, new Date(start.getTime() - 3_600_000))).toBe(
      0,
    );
  });
  it('finds the WAT week (from Monday) and month', () => {
    const windows = usageWindows(watInstant('2027-03-03', '10:00'));
    expect(windows.weekStart.toISOString()).toBe('2027-02-28T23:00:00.000Z');
    expect(windows.monthEnd.toISOString()).toBe('2027-03-31T23:00:00.000Z');
  });
});
