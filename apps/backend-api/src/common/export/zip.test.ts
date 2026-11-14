import { crc32, inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { toCsv, toJson } from './csv';
import { createZip } from './zip';

/** Reads entries back through the central directory, as unzip tools do. */
function readZip(zip: Buffer) {
  const end = zip.length - 22;
  expect(zip.readUInt32LE(end)).toBe(0x06054b50);
  const count = zip.readUInt16LE(end + 10);
  let cursor = zip.readUInt32LE(end + 16);
  const entries: { name: string; data: Buffer }[] = [];
  for (let i = 0; i < count; i += 1) {
    expect(zip.readUInt32LE(cursor)).toBe(0x02014b50);
    const checksum = zip.readUInt32LE(cursor + 16);
    const size = zip.readUInt32LE(cursor + 20);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const local = zip.readUInt32LE(cursor + 42);
    const name = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    const localNameLength = zip.readUInt16LE(local + 26);
    const start = local + 30 + localNameLength;
    const data = inflateRawSync(zip.subarray(start, start + size));
    expect(crc32(data)).toBe(checksum);
    entries.push({ name, data });
    cursor += 46 + nameLength;
  }
  return entries;
}

describe('zip', () => {
  it('round-trips entries with UTF-8 names', () => {
    const zip = createZip([
      { name: 'README.txt', data: Buffer.from('Estate export') },
      { name: 'billing/invoices.csv', data: Buffer.from('a,b\r\n1,₦2\r\n') },
    ]);
    expect(readZip(zip).map((entry) => [entry.name, entry.data.toString()])).toEqual([
      ['README.txt', 'Estate export'],
      ['billing/invoices.csv', 'a,b\r\n1,₦2\r\n'],
    ]);
  });

  it('rejects unsafe or duplicate names', () => {
    expect(() => createZip([{ name: '../x', data: Buffer.alloc(0) }])).toThrow(RangeError);
    expect(() => createZip([{ name: '/abs', data: Buffer.alloc(0) }])).toThrow(RangeError);
    expect(() =>
      createZip([
        { name: 'a', data: Buffer.alloc(0) },
        { name: 'a', data: Buffer.alloc(0) },
      ]),
    ).toThrow(RangeError);
  });
});

describe('csv', () => {
  it('quotes, neutralises formulas and serialises dates and bigints', () => {
    const csv = toCsv([
      { name: 'Ada, "Lovelace"', amount: 12_345n, at: new Date('2027-01-01T00:00:00Z') },
      { name: '=HYPERLINK("x")', note: 'line\nbreak' },
    ]);
    expect(csv).toBe(
      '﻿name,amount,at,note\r\n"Ada, ""Lovelace""",12345,2027-01-01T00:00:00.000Z,\r\n"\'=HYPERLINK(""x"")",,,"line\nbreak"\r\n',
    );
    expect(JSON.parse(toJson([{ amount: 5n, meta: { a: 1 } }]))).toEqual([
      { amount: '5', meta: '{"a":1}' },
    ]);
  });
});
