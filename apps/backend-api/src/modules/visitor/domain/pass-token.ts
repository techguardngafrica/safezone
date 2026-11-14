import {
  generateKeyPairSync,
  randomInt,
  sign,
  verify,
  createPublicKey,
  createPrivateKey,
  type KeyObject,
} from 'node:crypto';

/**
 * Signed QR payload (visitor.md §3, ADR-0010). Binary, then base64url:
 *   v(1) | passId(16) | estateId(16) | notBefore(4, unix s) | notAfter(4) | maxUses(2) | keyIndex(2) | sig(64)
 * 109 bytes → 146 characters, small enough for a low-density QR that cheap phone cameras read.
 * Gate restrictions are not in the token: devices check them against the expected list.
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

function uuidBytes(uuid: string): Buffer {
  const hex = uuid.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error('not a uuid');
  return Buffer.from(hex, 'hex');
}

function bytesUuid(bytes: Buffer): string {
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function encodeClaims(claims: PassClaims): Buffer {
  const body = Buffer.alloc(BODY_LENGTH);
  let offset = body.writeUInt8(TOKEN_VERSION, 0);
  offset += uuidBytes(claims.passId).copy(body, offset);
  offset += uuidBytes(claims.estateId).copy(body, offset);
  offset = body.writeUInt32BE(Math.floor(claims.notBefore.getTime() / 1000), offset);
  offset = body.writeUInt32BE(Math.floor(claims.notAfter.getTime() / 1000), offset);
  offset = body.writeUInt16BE(Math.min(claims.maxUses, 0xffff), offset);
  body.writeUInt16BE(claims.keyIndex, offset);
  return body;
}

export function signPassToken(claims: PassClaims, privateKey: KeyObject): string {
  const body = encodeClaims(claims);
  return Buffer.concat([body, sign(null, body, privateKey)]).toString('base64url');
}

/** Parses without verifying (to find the key index). Null when malformed. */
export function parsePassToken(
  token: string,
): { claims: PassClaims; body: Buffer; signature: Buffer } | null {
  if (!/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const raw = Buffer.from(token, 'base64url');
  if (raw.length !== BODY_LENGTH + SIGNATURE_LENGTH || raw.readUInt8(0) !== TOKEN_VERSION)
    return null;
  const body = raw.subarray(0, BODY_LENGTH);
  return {
    body,
    signature: raw.subarray(BODY_LENGTH),
    claims: {
      passId: bytesUuid(body.subarray(1, 17)),
      estateId: bytesUuid(body.subarray(17, 33)),
      notBefore: new Date(body.readUInt32BE(33) * 1000),
      notAfter: new Date(body.readUInt32BE(37) * 1000),
      maxUses: body.readUInt16BE(41),
      keyIndex: body.readUInt16BE(43),
    },
  };
}

/** Verified claims, or null when malformed or the signature does not match `publicKey`. */
export function verifyPassToken(token: string, publicKey: KeyObject): PassClaims | null {
  const parsed = parsePassToken(token);
  if (!parsed) return null;
  return verify(null, parsed.body, publicKey, parsed.signature) ? parsed.claims : null;
}

export function generateSigningKey(): { publicKeyRaw: Buffer; privateKeyDer: Buffer } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  return {
    // Raw 32-byte key is the last 32 bytes of the SPKI encoding; devices use it directly.
    publicKeyRaw: spki.subarray(spki.length - 32),
    privateKeyDer: privateKey.export({ format: 'der', type: 'pkcs8' }),
  };
}

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export function publicKeyFromRaw(raw: Buffer): KeyObject {
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
    format: 'der',
    type: 'spki',
  });
}

export function privateKeyFromDer(der: Buffer): KeyObject {
  return createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}

/** Six-digit PIN; uniqueness among live passes is enforced by the database. */
export function generatePin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}
