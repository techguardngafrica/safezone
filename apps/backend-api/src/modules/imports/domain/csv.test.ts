import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';

describe('parseCsv', () => {
  it('parses headers, quoted fields, escaped quotes and CRLF', () => {
    const csv =
      'code,name,unit_type\r\n"A-101","Flat ""A"" 101, Block A",flat\r\nA-102,Flat 102,house\r\n';
    const result = parseCsv(csv);
    expect(result.headers).toEqual(['code', 'name', 'unit_type']);
    expect(result.rows).toEqual([
      { code: 'A-101', name: 'Flat "A" 101, Block A', unit_type: 'flat' },
      { code: 'A-102', name: 'Flat 102', unit_type: 'house' },
    ]);
  });

  it('skips empty lines and strips UTF-8 BOM', () => {
    const csv = '\uFEFFcode,name\n\nB-1,Unit B1\n\n';
    const result = parseCsv(csv);
    expect(result.headers).toEqual(['code', 'name']);
    expect(result.rows).toEqual([{ code: 'B-1', name: 'Unit B1' }]);
  });
});
