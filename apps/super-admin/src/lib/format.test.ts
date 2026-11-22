import { describe, expect, it } from 'vitest';
import { formatMoney, formatWat, humanizeStatus, statusTone } from './format';

describe('super-admin format helpers', () => {
  it('formats kobo amounts in Naira', () => {
    expect(formatMoney(150_000)).toContain('1,500.00');
  });

  it('formats ISO timestamps in WAT and handles null', () => {
    expect(formatWat(null)).toBe('-');
    expect(formatWat('2026-11-21T12:00:00.000Z')).toMatch(/2026/);
  });

  it('maps statuses to expected tones', () => {
    expect(statusTone('active')).toBe('success');
    expect(statusTone('submitted')).toBe('info');
    expect(statusTone('info_requested')).toBe('warning');
    expect(statusTone('suspended')).toBe('danger');
    expect(statusTone('unknown_value')).toBe('neutral');
  });

  it('humanizes snake_case statuses', () => {
    expect(humanizeStatus('under_review')).toBe('under review');
  });
});
