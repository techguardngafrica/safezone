import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, generateNumericCode, hmac, safeEqualHex } from './crypto';
import { base32Decode, base32Encode, hotp, otpauthUri, verifyTotp } from './totp';

describe('TOTP (RFC 6238 test vectors, SHA1)', () => {
  // Secret "12345678901234567890" from RFC 6238 appendix B; 8-digit vectors truncated to 6 digits.
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('at %d s gives %s', (seconds, code) => {
    expect(hotp(base32Decode(secret), Math.floor(seconds / 30))).toBe(code);
    expect(verifyTotp(secret, code, seconds * 1000)).toBe(Math.floor(seconds / 30));
  });

  it('accepts one step of drift and rejects more', () => {
    const at = 1111111111 * 1000;
    const previous = hotp(base32Decode(secret), Math.floor(1111111111 / 30) - 1);
    const tooOld = hotp(base32Decode(secret), Math.floor(1111111111 / 30) - 3);
    expect(verifyTotp(secret, previous, at)).not.toBeNull();
    expect(verifyTotp(secret, tooOld, at)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', at)).toBeNull();
  });

  it('round-trips base32 and builds an otpauth URI', () => {
    const bytes = Buffer.from('hello world!');
    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
    expect(otpauthUri('JBSWY3DPEHPK3PXP', '+234803****567')).toMatch(
      /^otpauth:\/\/totp\/Safezone%3A%2B234803\*\*\*\*567\?secret=JBSWY3DPEHPK3PXP&issuer=Safezone/,
    );
  });
});

describe('crypto helpers', () => {
  const key = Buffer.alloc(32, 9).toString('base64');

  it('encrypts and authenticates secrets', () => {
    const sealed = encryptSecret(key, 'JBSWY3DPEHPK3PXP');
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptSecret(key, sealed)).toBe('JBSWY3DPEHPK3PXP');
    const tampered = `${sealed.slice(0, -2)}AA`;
    expect(() => decryptSecret(key, tampered)).toThrow();
  });

  it('compares digests in constant time and rejects different lengths', () => {
    const digest = hmac('secret', 'value');
    expect(safeEqualHex(digest, hmac('secret', 'value'))).toBe(true);
    expect(safeEqualHex(digest, hmac('secret', 'other'))).toBe(false);
    expect(safeEqualHex(digest, 'ab')).toBe(false);
  });

  it('generates 6-digit codes', () => {
    for (let i = 0; i < 50; i += 1) expect(generateNumericCode()).toMatch(/^\d{6}$/);
  });
});
