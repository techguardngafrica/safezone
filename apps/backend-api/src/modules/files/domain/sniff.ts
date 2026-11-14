/** Checks the first bytes match the declared type, so a renamed executable cannot pass as a PDF. */
export function contentMatchesType(body: Buffer, mimeType: string): boolean {
  const starts = (...bytes: number[]) => bytes.every((byte, index) => body[index] === byte);
  switch (mimeType) {
    case 'image/jpeg':
      return starts(0xff, 0xd8, 0xff);
    case 'image/png':
      return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case 'image/webp':
      return (
        body.subarray(0, 4).toString('latin1') === 'RIFF' &&
        body.subarray(8, 12).toString('latin1') === 'WEBP'
      );
    case 'application/pdf':
      return body.subarray(0, 5).toString('latin1') === '%PDF-';
    case 'video/mp4':
      return body.subarray(4, 8).toString('latin1') === 'ftyp';
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return starts(0x50, 0x4b, 0x03, 0x04);
    case 'text/csv':
      return !body.subarray(0, 8192).includes(0);
    default:
      return false;
  }
}
