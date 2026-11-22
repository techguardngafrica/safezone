import { describe, expect, it } from 'vitest';
import { nairaToKobo, residentActions, vendorActions, watInstant } from './marketplace';

describe('marketplace helpers', () => {
  it('reads naira into kobo', () => {
    expect(nairaToKobo('15,000')).toBe(1_500_000);
    expect(nairaToKobo('₦2500.50')).toBe(250_050);
    for (const bad of ['', '0', 'abc', '1.234', '-5']) expect(nairaToKobo(bad)).toBeNull();
  });

  it('builds a WAT instant and refuses impossible dates', () => {
    expect(watInstant('2026-12-01', '09:30')).toBe('2026-12-01T09:30:00+01:00');
    expect(watInstant('2026-02-30', '09:30')).toBeNull();
    expect(watInstant('2026-12-01', '24:00')).toBeNull();
    expect(watInstant('1/12/2026', '09:30')).toBeNull();
  });

  it('offers residents only actions the order allows', () => {
    expect(residentActions({ status: 'quoted', paid: false, amountKobo: null })).toMatchObject({
      acceptQuote: true,
      pay: false,
      cancel: true,
    });
    expect(residentActions({ status: 'accepted', paid: false, amountKobo: 100 })).toMatchObject({
      pay: true,
      dispute: false,
    });
    expect(residentActions({ status: 'in_progress', paid: true, amountKobo: 100 })).toMatchObject({
      cancel: false,
      dispute: true,
    });
    expect(residentActions({ status: 'completed', paid: true, amountKobo: 100 }).review).toBe(true);
  });

  it('keeps service personnel to start and complete, and work behind payment', () => {
    const accepted = { status: 'accepted' as const, paid: false, amountKobo: 100 };
    expect(vendorActions(accepted, true).start).toBe(false);
    expect(vendorActions({ ...accepted, paid: true }, false)).toMatchObject({
      start: true,
      schedule: false,
      cancel: false,
    });
    expect(
      vendorActions({ status: 'requested', paid: false, amountKobo: null }, true),
    ).toMatchObject({
      accept: false,
      quote: true,
    });
  });
});
