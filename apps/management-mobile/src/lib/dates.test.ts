import { describe, expect, it } from 'vitest';
import { monthToDateWat } from './dates';

describe('monthToDateWat', () => {
  it('uses the WAT calendar date', () => {
    expect(monthToDateWat(new Date('2026-11-21T10:00:00.000Z'))).toEqual({
      from: '2026-11-01',
      to: '2026-11-21',
    });
  });

  it('rolls into the next WAT month an hour before UTC midnight', () => {
    expect(monthToDateWat(new Date('2026-11-30T23:30:00.000Z'))).toEqual({
      from: '2026-12-01',
      to: '2026-12-01',
    });
  });
});
