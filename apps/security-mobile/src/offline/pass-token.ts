import { ed25519 } from '@noble/curves/ed25519';

/**
 * Offline reader for the signed QR token (ADR-0010, visitor.md §3). Mirrors
 * apps/backend-api/src/modules/visitor/domain/pass-token.ts byte for byte:
 *   v(1) | passId(16) | estateId(16) | notBefore(4) | notAfter(4) | maxUses(2) | keyIndex(2) | sig(64)
 */
export const TOKEN_VERSION = 1;
const BODY_LENGTH = 1 + 16 + 16 + 4 + 4 + 2 + 2;
const SIGNATURE_LENGTH = 64;

export interface PassClaims {
  passId: string;
  estateId: string;
  notBefore: Date;
  notAfter: Date;
  /** 0 = unlimited (recurring and staff passes). */
  maxUses: number;
  keyIndex: number;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const LOOKUP = new Map([...ALPHABET].map((char, index) => [char, index]));

/** base64url (no padding) to bytes. Null when the text has characters outside the alphabet. */
export function base64UrlDecode(text: string): Uint8Array | null {
  const clean = text.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 6) / 8));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const char of clean) {
    const value = LOOKUP.get(char);
    if (value === undefined) return null;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (buffer >> bits) & 0xff;
    }
  }
  return out;
}

function toUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function uint32(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] ?? 0) << 24) >>> 0) +
    ((bytes[offset + 1] ?? 0) << 16) +
    ((bytes[offset + 2] ?? 0) << 8) +
    (bytes[offset + 3] ?? 0)
  );
}

function uint16(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) + (bytes[offset + 1] ?? 0);
}

export interface ParsedToken {
  claims: PassClaims;
  body: Uint8Array;
  signature: Uint8Array;
}

/** Parses without verifying (to find the key index). Null when malformed. */
export function parsePassToken(token: string): ParsedToken | null {
  const trimmed = token.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) return null;
  const raw = base64UrlDecode(trimmed);
  if (!raw || raw.length !== BODY_LENGTH + SIGNATURE_LENGTH || raw[0] !== TOKEN_VERSION)
    return null;
  const body = raw.subarray(0, BODY_LENGTH);
  return {
    body,
    signature: raw.subarray(BODY_LENGTH),
    claims: {
      passId: toUuid(body.subarray(1, 17)),
      estateId: toUuid(body.subarray(17, 33)),
      notBefore: new Date(uint32(body, 33) * 1000),
      notAfter: new Date(uint32(body, 37) * 1000),
      maxUses: uint16(body, 41),
      keyIndex: uint16(body, 43),
    },
  };
}

/** True when `signature` over `body` matches the raw 32-byte Ed25519 key (base64url, from gate/keys). */
export function signatureValid(parsed: ParsedToken, publicKeyBase64Url: string): boolean {
  const key = base64UrlDecode(publicKeyBase64Url);
  if (!key || key.length !== 32) return false;
  try {
    return ed25519.verify(parsed.signature, parsed.body, key);
  } catch {
    return false;
  }
}
