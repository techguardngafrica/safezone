import { createHash, createHmac } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { KeyObject } from 'node:crypto';
import type { Tx } from '../../common/database/tenant-context';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { KeyVault } from '../../integrations/keys/key-vault';
import {
  generateSigningKey,
  type PassClaims,
  privateKeyFromDer,
  publicKeyFromRaw,
  signPassToken,
  verifyPassToken,
  parsePassToken,
} from './domain/pass-token';

function uuidBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}

/**
 * Estate signing keys and pass credentials (ADR-0010). Usable from the API and the worker.
 * - QR: Ed25519 over compact claims, re-signed on demand (Ed25519 signatures are deterministic).
 * - PIN: stored wrapped by the KeyVault, looked up by HMAC so it is unique among live passes.
 * - Pass page token: estate id + HMAC of the pass id; derived, never stored (only its SHA-256).
 */
@Injectable()
export class PassKeysService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly vault: KeyVault,
  ) {}

  /** The estate's current key, created on first use. Inside the caller's estate transaction. */
  async currentKey(tx: Tx, estateId: string): Promise<{ keyIndex: number; privateKey: KeyObject }> {
    const now = new Date();
    let row = await tx.estateSigningKey.findFirst({
      where: {
        estateId,
        activeFrom: { lte: now },
        OR: [{ activeTo: null }, { activeTo: { gt: now } }],
      },
      orderBy: { keyIndex: 'desc' },
    });
    if (!row) {
      const key = generateSigningKey();
      const last = await tx.estateSigningKey.findFirst({
        where: { estateId },
        orderBy: { keyIndex: 'desc' },
      });
      await tx.estateSigningKey.createMany({
        data: [
          {
            estateId,
            keyIndex: (last?.keyIndex ?? 0) + 1,
            publicKey: key.publicKeyRaw.toString('base64url'),
            privateKeyWrapped: this.vault.wrap(key.privateKeyDer),
          },
        ],
        skipDuplicates: true,
      });
      row = await tx.estateSigningKey.findFirstOrThrow({
        where: { estateId },
        orderBy: { keyIndex: 'desc' },
      });
    }
    return {
      keyIndex: row.keyIndex,
      privateKey: privateKeyFromDer(this.vault.unwrap(row.privateKeyWrapped)),
    };
  }

  async sign(tx: Tx, claims: Omit<PassClaims, 'keyIndex'> & { keyIndex: number }): Promise<string> {
    const row = await tx.estateSigningKey.findFirstOrThrow({
      where: { estateId: claims.estateId, keyIndex: claims.keyIndex },
    });
    return signPassToken(claims, privateKeyFromDer(this.vault.unwrap(row.privateKeyWrapped)));
  }

  /** Verified claims for this estate, or null (bad signature, unknown key, other estate). */
  async verify(tx: Tx, estateId: string, token: string): Promise<PassClaims | null> {
    const parsed = parsePassToken(token);
    if (!parsed || parsed.claims.estateId !== estateId) return null;
    const row = await tx.estateSigningKey.findFirst({
      where: { estateId, keyIndex: parsed.claims.keyIndex },
    });
    if (!row) return null;
    return verifyPassToken(token, publicKeyFromRaw(Buffer.from(row.publicKey, 'base64url')));
  }

  async publicKeys(tx: Tx, estateId: string) {
    const rows = await tx.estateSigningKey.findMany({
      where: { estateId },
      orderBy: { keyIndex: 'asc' },
    });
    return rows.map((row) => ({
      keyIndex: row.keyIndex,
      publicKey: row.publicKey,
      activeFrom: row.activeFrom.toISOString(),
      activeTo: row.activeTo?.toISOString() ?? null,
    }));
  }

  pinLookup(estateId: string, pin: string): string {
    return createHmac('sha256', this.env.OTP_HMAC_SECRET)
      .update(`visitor-pin:v1:${estateId}:${pin}`)
      .digest('hex');
  }

  wrapPin(pin: string): string {
    return this.vault.wrap(Buffer.from(pin, 'utf8'));
  }

  unwrapPin(wrapped: string): string {
    return this.vault.unwrap(wrapped).toString('utf8');
  }

  /** Pass page token: base64url(estateId(16) | HMAC(passId)[0..24]) = 54 characters. */
  publicToken(estateId: string, passId: string): string {
    const mac = createHmac('sha256', this.env.OTP_HMAC_SECRET)
      .update(`visitor-pass:v1:${passId}`)
      .digest();
    return Buffer.concat([uuidBytes(estateId), mac.subarray(0, 24)]).toString('base64url');
  }

  static hashPublicToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** The estate id inside a pass page token, or null when malformed. */
  static estateOfPublicToken(token: string): string | null {
    const raw = Buffer.from(token, 'base64url');
    if (raw.length !== 40) return null;
    const hex = raw.subarray(0, 16).toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  passUrl(estateId: string, passId: string): string {
    return `${this.env.PUBLIC_WEB_URL.replace(/\/$/, '')}/p/${this.publicToken(estateId, passId)}`;
  }

  /** What an offline device compares a typed PIN against. */
  static pinDigest(passId: string, pin: string): string {
    return createHash('sha256').update(`${passId}:${pin}`).digest('hex');
  }
}
