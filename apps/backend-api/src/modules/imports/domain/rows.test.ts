import { describe, expect, it } from 'vitest';
import { missingHeaders, parseHundredths, rowKey, templateCsv, validateRows } from './rows';

const TODAY = '2026-11-21';

describe('parseHundredths', () => {
  it('converts naira strings to integer kobo without floating point', () => {
    expect(parseHundredths('50000')).toBe(5_000_000);
    expect(parseHundredths('0.1')).toBe(10);
    expect(parseHundredths('19.99')).toBe(1999);
    expect(parseHundredths('1,250,000.50')).toBe(125_000_050);
  });

  it('rejects negatives, extra decimals and junk', () => {
    expect(parseHundredths('-5')).toBeNull();
    expect(parseHundredths('1.234')).toBeNull();
    expect(parseHundredths('1e5')).toBeNull();
    expect(parseHundredths('')).toBeNull();
  });
});

describe('templateCsv / missingHeaders', () => {
  it('produces a header and sample row of equal width for every kind', () => {
    for (const kind of [
      'units',
      'owners',
      'residents',
      'households',
      'vehicles',
      'opening_balances',
    ] as const) {
      const { headers, csv } = templateCsv(kind);
      const [head, sample] = csv.trim().split('\n');
      expect(head?.split(',')).toEqual(headers);
      expect(sample?.split(',')).toHaveLength(headers.length);
      expect(missingHeaders(kind, headers)).toEqual([]);
    }
  });

  it('lists required columns that are absent', () => {
    expect(missingHeaders('owners', ['unit_code', 'phone'])).toEqual(['full_name']);
  });
});

describe('validateRows', () => {
  it('normalises valid units and rejects an imported occupied status', () => {
    const { valid, errors } = validateRows(
      'units',
      [
        { code: 'A-101', name: 'Flat 101', unit_type: 'FLAT', bedrooms: '3', unit_status: '' },
        { code: 'A-102', name: 'Flat 102', unit_status: 'occupied' },
        { code: 'A-103', name: 'Flat 103', unit_status: 'bogus' },
      ],
      TODAY,
    );
    expect(valid).toEqual([
      {
        kind: 'units',
        row: 2,
        code: 'A-101',
        name: 'Flat 101',
        unitType: 'flat',
        bedrooms: 3,
        status: 'vacant',
        externalRef: null,
      },
    ]);
    expect(errors.map((error) => [error.row, error.field])).toEqual([
      [3, 'unit_status'],
      [4, 'unit_status'],
    ]);
  });

  it('requires Nigerian phone numbers for people', () => {
    const { valid, errors } = validateRows(
      'residents',
      [
        { unit_code: 'A-101', full_name: 'Chidi N', phone: '+2348098765432' },
        { unit_code: 'A-101', full_name: 'Ada', phone: '08098765432' },
      ],
      TODAY,
    );
    expect(valid).toHaveLength(1);
    expect(valid[0]).toMatchObject({ occupancyType: 'tenant' });
    expect(errors).toEqual([
      { row: 3, field: 'phone', message: 'Enter a Nigerian phone number in +234 format' },
    ]);
  });

  it('stores owner shares as basis points and caps them at 100%', () => {
    const { valid, errors } = validateRows(
      'owners',
      [
        { unit_code: 'A-1', full_name: 'Adaeze O', phone: '+2348012345678', share_percent: '50.5' },
        { unit_code: 'A-2', full_name: 'Bola T', phone: '+2348012345679', share_percent: '101' },
      ],
      TODAY,
    );
    expect(valid[0]).toMatchObject({ shareBasisPoints: 5050 });
    expect(errors[0]).toMatchObject({ row: 3, field: 'share_percent' });
  });

  it('keeps opening balances in kobo, needs a reference and rejects past due dates', () => {
    const base = { unit_code: 'A-101', description: 'Opening balance' };
    const { valid, errors } = validateRows(
      'opening_balances',
      [
        { ...base, external_ref: 'OB-1', amount_naira: '50000.25', due_date: '2026-12-31' },
        { ...base, external_ref: '', amount_naira: '100', due_date: '2026-12-31' },
        { ...base, external_ref: 'OB-3', amount_naira: '100', due_date: '2026-11-20' },
        { ...base, external_ref: 'OB-4', amount_naira: '100', due_date: '2026-02-30' },
      ],
      TODAY,
    );
    expect(valid).toEqual([
      {
        kind: 'opening_balances',
        row: 2,
        unitCode: 'A-101',
        externalRef: 'OB-1',
        amountKobo: 5_000_025,
        description: 'Opening balance',
        dueDate: '2026-12-31',
      },
    ]);
    expect(errors.map((error) => [error.row, error.field])).toEqual([
      [3, 'external_ref'],
      [4, 'due_date'],
      [5, 'due_date'],
    ]);
  });

  it('flags a row that repeats an earlier key (first one wins)', () => {
    const { valid, errors } = validateRows(
      'vehicles',
      [
        { unit_code: 'A-101', plate: 'LSR-421-AA' },
        { unit_code: 'A-102', plate: 'lsr 421 aa' },
      ],
      TODAY,
    );
    expect(valid).toHaveLength(1);
    expect(errors).toEqual([{ row: 3, field: null, message: 'Duplicate of row 2' }]);
  });
});

describe('rowKey', () => {
  it('matches units case-insensitively and plates without separators', () => {
    expect(
      rowKey({
        kind: 'units',
        row: 2,
        code: 'A-101',
        name: 'x',
        unitType: 'flat',
        bedrooms: null,
        status: 'vacant',
        externalRef: null,
      }),
    ).toBe('unit:a-101');
    expect(
      rowKey({
        kind: 'vehicles',
        row: 2,
        unitCode: 'A',
        plate: 'lsr-421 aa',
        make: null,
        model: null,
        colour: null,
      }),
    ).toBe('vehicle:LSR421AA');
  });
});
