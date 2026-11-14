/**
 * Removes metadata that can reveal location or device (documents.md §5.4) without re-encoding the image.
 * JPEG: drops APP1 (EXIF, XMP), APP13 (IPTC/Photoshop) and COM segments.
 * PNG: drops eXIf, tEXt, iTXt and zTXt chunks.
 * Other types are returned unchanged.
 */
export function stripImageMetadata(body: Buffer, mimeType: string): Buffer {
  if (mimeType === 'image/jpeg') return stripJpeg(body);
  if (mimeType === 'image/png') return stripPng(body);
  return body;
}

const JPEG_DROP = new Set([0xe1, 0xed, 0xfe]);

function stripJpeg(body: Buffer): Buffer {
  if (body[0] !== 0xff || body[1] !== 0xd8) throw new Error('Not a JPEG');
  const parts: Buffer[] = [body.subarray(0, 2)];
  let offset = 2;
  while (offset + 4 <= body.length) {
    if (body[offset] !== 0xff) throw new Error('Malformed JPEG segment');
    const marker = body[offset + 1] ?? 0;
    // Start of scan: the rest is image data (up to EOI); copy it unchanged.
    if (marker === 0xda) {
      parts.push(body.subarray(offset));
      return Buffer.concat(parts);
    }
    if (marker === 0xd9) {
      parts.push(body.subarray(offset, offset + 2));
      return Buffer.concat(parts);
    }
    const length = body.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > body.length)
      throw new Error('Malformed JPEG segment length');
    const segment = body.subarray(offset, offset + 2 + length);
    if (!JPEG_DROP.has(marker)) parts.push(segment);
    offset += 2 + length;
  }
  throw new Error('JPEG ended before image data');
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_DROP = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt']);

function stripPng(body: Buffer): Buffer {
  if (!body.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('Not a PNG');
  const parts: Buffer[] = [PNG_SIGNATURE];
  let offset = 8;
  while (offset + 12 <= body.length) {
    const length = body.readUInt32BE(offset);
    const type = body.subarray(offset + 4, offset + 8).toString('latin1');
    const end = offset + 12 + length;
    if (end > body.length) throw new Error('Malformed PNG chunk');
    if (!PNG_DROP.has(type)) parts.push(body.subarray(offset, end));
    offset = end;
    if (type === 'IEND') break;
  }
  return Buffer.concat(parts);
}
