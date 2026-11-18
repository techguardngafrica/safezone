import { describe, expect, it } from 'vitest';
import {
  basisPointsToInput,
  koboToInput,
  parseNaira,
  parsePercentToBasisPoints,
  parsePositiveNaira,
} from './money';

describe('parseNaira', () => {
  it('reads whole and decimal naira as exact kobo', () => {
    expect(parseNaira('15000')).toBe(1_500_000);
    expect(parseNaira('15,000.50')).toBe(1_500_050);
    expect(parseNaira('0.29')).toBe(29);
    expect(parseNaira('₦ 2,500.5')).toBe(250_050);
    expect(parseNaira('12.')).toBe(1200);
  });

  it('refuses text that is not an amount', () => {
    for (const text of ['', ' ', 'abc', '-500', '1.234', '1e5', '1.2.3']) {
      expect(parseNaira(text)).toBeNull();
    }
  });

  it('refuses amounts above the API ceiling', () => {
    expect(parseNaira('1000000000')).toBe(100_000_000_000);
    expect(parseNaira('1000000000.01')).toBeNull();
  });

  it('treats zero as not positive', () => {
    expect(parseNaira('0')).toBe(0);
    expect(parsePositiveNaira('0')).toBeNull();
    expect(parsePositiveNaira('0.01')).toBe(1);
  });
});

describe('koboToInput', () => {
  it('round-trips through parseNaira', () => {
    for (const kobo of [0, 1, 29, 1200, 1_500_050, 100_000_000_000]) {
      expect(parseNaira(koboToInput(kobo))).toBe(kobo);
    }
    expect(koboToInput(1_500_000)).toBe('15000');
    expect(koboToInput(1_500_005)).toBe('15000.05');
  });
});

describe('parsePercentToBasisPoints', () => {
  it('reads percentages as basis points', () => {
    expect(parsePercentToBasisPoints('5')).toBe(500);
    expect(parsePercentToBasisPoints('2.5')).toBe(250);
    expect(parsePercentToBasisPoints('0.01%')).toBe(1);
    expect(parsePercentToBasisPoints('50')).toBe(5000);
    expect(basisPointsToInput(250)).toBe('2.5');
  });

  it('refuses values outside the API range', () => {
    for (const text of ['0', '50.01', '-1', '1.234', 'ten', '']) {
      expect(parsePercentToBasisPoints(text)).toBeNull();
    }
  });
});
