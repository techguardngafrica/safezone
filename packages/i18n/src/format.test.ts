import { describe, expect, it } from 'vitest';
import { formatElapsed, formatKobo, startOfTodayWat } from './format';

describe('formatElapsed', () => {
  const start = '2026-11-14T10:00:00.000Z';
  const at = (seconds: number) => new Date(start).getTime() + seconds * 1000;
  it('shows seconds, minutes and hours', () => {
    expect(formatElapsed(start, at(9))).toBe('9s');
    expect(formatElapsed(start, at(125))).toBe('2m 05s');
    expect(formatElapsed(start, at(3720))).toBe('1h 2m');
  });
  it('never goes negative', () => {
    expect(formatElapsed(start, at(-5))).toBe('0s');
  });
});

describe('formatKobo', () => {
  it('formats integer kobo as naira', () => {
    expect(formatKobo(1_250_050)).toContain('12,500.50');
  });
});

describe('startOfTodayWat', () => {
  it('returns 23:00 UTC of the previous day for a WAT midnight', () => {
    expect(startOfTodayWat(new Date('2026-11-14T10:00:00Z'))).toBe('2026-11-13T23:00:00.000Z');
  });
  it('rolls over after 23:00 UTC', () => {
    expect(startOfTodayWat(new Date('2026-11-14T23:30:00Z'))).toBe('2026-11-14T23:00:00.000Z');
  });
});
