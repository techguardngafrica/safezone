import { describe, expect, it } from 'vitest';
import { maxBytesFor } from './purposes';
import { contentMatchesType } from './sniff';
import { stripImageMetadata } from './strip-metadata';

function segment(marker: number, payload: Buffer): Buffer {
  const header = Buffer.from([0xff, marker, 0, 0]);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

const exif = Buffer.concat([
  Buffer.from('Exif\0\0'),
  Buffer.from('GPSLatitude=6.4281N;GPSLongitude=3.4219E'),
]);
const jpeg = Buffer.concat([
  Buffer.from([0xff, 0xd8]),
  segment(0xe0, Buffer.from('JFIF\0\x01\x01')),
  segment(0xe1, exif),
  segment(0xfe, Buffer.from('comment with device name')),
  segment(0xdb, Buffer.alloc(65, 1)),
  Buffer.from([0xff, 0xda, 0x00, 0x04, 0x01, 0x02]),
  Buffer.from([0x11, 0x22, 0x33, 0xff, 0xd9]),
]);

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  pngChunk('IHDR', Buffer.alloc(13)),
  pngChunk('eXIf', Buffer.from('GPS 6.42N 3.42E')),
  pngChunk('tEXt', Buffer.from('Author\0Someone')),
  pngChunk('IDAT', Buffer.alloc(10, 5)),
  pngChunk('IEND', Buffer.alloc(0)),
]);

describe('stripImageMetadata', () => {
  it('removes EXIF/GPS and comments from JPEG but keeps image data', () => {
    const stripped = stripImageMetadata(jpeg, 'image/jpeg');
    expect(stripped.includes(Buffer.from('GPSLatitude'))).toBe(false);
    expect(stripped.includes(Buffer.from('device name'))).toBe(false);
    expect(stripped.includes(Buffer.from('JFIF'))).toBe(true);
    expect(stripped.subarray(-5).equals(Buffer.from([0x11, 0x22, 0x33, 0xff, 0xd9]))).toBe(true);
    expect(contentMatchesType(stripped, 'image/jpeg')).toBe(true);
  });

  it('removes eXIf and text chunks from PNG', () => {
    const stripped = stripImageMetadata(png, 'image/png');
    expect(stripped.includes(Buffer.from('GPS'))).toBe(false);
    expect(stripped.includes(Buffer.from('Author'))).toBe(false);
    expect(stripped.includes(Buffer.from('IDAT'))).toBe(true);
    expect(stripped.includes(Buffer.from('IEND'))).toBe(true);
  });

  it('rejects malformed images', () => {
    expect(() =>
      stripImageMetadata(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]), 'image/jpeg'),
    ).toThrow();
    expect(() => stripImageMetadata(Buffer.from('not a png'), 'image/png')).toThrow();
  });
});

describe('content sniffing and limits', () => {
  it('matches magic bytes to the declared type', () => {
    expect(contentMatchesType(Buffer.from('%PDF-1.7\n'), 'application/pdf')).toBe(true);
    expect(contentMatchesType(Buffer.from('MZ\x90\x00'), 'application/pdf')).toBe(false);
    expect(contentMatchesType(Buffer.from('a,b\n1,2\n'), 'text/csv')).toBe(true);
    expect(contentMatchesType(Buffer.from([0x61, 0x00, 0x62]), 'text/csv')).toBe(false);
  });

  it('applies per-purpose type and size limits', () => {
    expect(maxBytesFor('pass_photo', 'image/jpeg')).toBe(2 * 1024 * 1024);
    expect(maxBytesFor('pass_photo', 'image/png')).toBeNull();
    expect(maxBytesFor('document', 'application/pdf')).toBe(20 * 1024 * 1024);
  });
});
