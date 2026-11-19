import { describe, expect, it } from 'vitest';
import { checklistSummary, isValidIsoDate, parseVehiclePlates, vehiclePlatesValid } from './moves';

describe('moves helpers', () => {
  it('validates YYYY-MM-DD dates strictly', () => {
    expect(isValidIsoDate('2026-12-01')).toBe(true);
    expect(isValidIsoDate('2026-02-30')).toBe(false);
    expect(isValidIsoDate('01/12/2026')).toBe(false);
    expect(isValidIsoDate('')).toBe(false);
  });

  it('parses comma-separated vehicle plates without dropping any', () => {
    expect(parseVehiclePlates(' kja-123ab, lnd-456cd , x ,')).toEqual([
      'KJA-123AB',
      'LND-456CD',
      'X',
    ]);
  });

  it('flags short plates and more than 5 plates instead of dropping them', () => {
    expect(vehiclePlatesValid(['KJA-123AB', 'LND-456CD'])).toBe(true);
    expect(vehiclePlatesValid(['KJA-123AB', 'X'])).toBe(false);
    expect(vehiclePlatesValid(['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF'])).toBe(false);
    expect(vehiclePlatesValid([])).toBe(true);
  });

  it('counts completed checklist items', () => {
    expect(
      checklistSummary([
        { item: 'Keys returned', done: true },
        { item: 'Meter read', done: false },
        { item: 'Clearance signed', done: true },
      ]),
    ).toEqual({ done: 2, total: 3 });
  });
});
