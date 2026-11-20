import { createCipheriv, createHash, createHmac, randomBytes, randomInt } from 'node:crypto';
import type pg from 'pg';
import { E2E } from './config';

/**
 * Test data written straight to the throwaway database as the schema owner, mirroring
 * apps/backend-api/test/integration/support/app.ts and src/scripts/seed-dev.ts. Only what has no API
 * yet (the estate itself, staff accounts and their seeded authenticator) is created this way; flows
 * create everything else through the API or the UI.
 */

/** RFC 9562 UUIDv7 (same layout as the backend's src/common/ids/uuidv7.ts). */
export function uuidv7(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  const ms = BigInt(now);
  for (let i = 0; i < 6; i += 1) bytes[i] = Number((ms >> BigInt(40 - i * 8)) & 0xffn);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Same deterministic id as the backend's builtInRoleId (src/scripts/seed-roles.ts). */
export function builtInRoleId(key: string): string {
  const hex = createHash('sha256').update(`safezone-role:${key}`).digest('hex');
  const variant = ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}

// --- TOTP (RFC 6238, as in the backend's identity/domain/totp.ts) -----------------------------------

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of input) {
    value = (value << 5) | BASE32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function hotp(secret: Buffer, counter: number): string {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(buffer).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    (((digest[offset + 1] ?? 0) & 0xff) << 16) |
    (((digest[offset + 2] ?? 0) & 0xff) << 8) |
    ((digest[offset + 3] ?? 0) & 0xff);
  return (binary % 1_000_000).toString().padStart(6, '0');
}

/** Last step used per secret: the API accepts each 30-second step once (replay protection). */
const lastStep = new Map<string, number>();

/**
 * A fresh TOTP code for the seeded secret. Uses the current step, or the next one (the API accepts
 * ±1 step) when the current one was already used; waits only if both were.
 */
export async function totpCode(secret: string): Promise<string> {
  for (;;) {
    const current = Math.floor(Date.now() / 30_000);
    const used = lastStep.get(secret) ?? -1;
    const step = Math.max(current, used + 1);
    if (step <= current + 1) {
      lastStep.set(secret, step);
      return hotp(base32Decode(secret), step);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

/** AES-256-GCM like the backend's encryptSecret: iv.tag.ciphertext, base64url. */
function encryptSecret(keyBase64: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyBase64, 'base64'), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
}

// --- Rows ----------------------------------------------------------------------------------------

export interface SeededUser {
  id: string;
  /** E.164, e.g. +2348031234567. */
  phone: string;
  /** National digits after +234 (what the sign-in field takes). */
  national: string;
  fullName: string;
  /** Base32 TOTP secret when MFA was seeded. */
  totpSecret?: string;
}

export type EstateStatus = 'approved' | 'active';

export class Seeder {
  constructor(private readonly owner: pg.Pool) {}

  async estate(name: string, status: EstateStatus = 'active'): Promise<string> {
    const id = uuidv7();
    const code = Array.from(
      { length: 6 },
      () => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[randomInt(31)],
    ).join('');
    await this.owner.query(
      `insert into platform.estates (id, name, slug, code, type, address, state, lga, status, onboarding_mode, activated_at, updated_at)
       values ($1, $2, $3, $4, 'gated_houses', '1 Test Close, Lekki', 'Lagos', 'Eti-Osa', $5, 'assisted', $6, now())`,
      [id, name, `e2e-${id}`, code, status, status === 'active' ? new Date() : null],
    );
    return id;
  }

  /** A verified user. `mfa: true` seeds a confirmed TOTP factor, as staff sign-in requires. */
  async user(fullName: string, options: { mfa?: boolean } = {}): Promise<SeededUser> {
    const national = `803${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
    const phone = `+234${national}`;
    const id = uuidv7();
    await this.owner.query(
      `insert into platform.users (id, phone_e164, phone_verified_at, full_name, mfa_enabled, updated_at)
       values ($1, $2, now(), $3, $4, now())`,
      [id, phone, fullName, Boolean(options.mfa)],
    );
    let totpSecret: string | undefined;
    if (options.mfa) {
      totpSecret = base32Encode(randomBytes(20));
      await this.owner.query(
        `insert into platform.mfa_factors (id, user_id, type, secret_encrypted, confirmed_at)
         values ($1, $2, 'totp', $3, now())`,
        [uuidv7(), id, encryptSecret(E2E.secrets.MFA_ENCRYPTION_KEY, totpSecret)],
      );
    }
    return { id, phone, national, fullName, ...(totpSecret ? { totpSecret } : {}) };
  }

  /** Active membership plus a built-in role in the estate. */
  async member(estateId: string, userId: string, roleKey: string): Promise<void> {
    await this.owner.query(
      `insert into tenant.estate_memberships (id, estate_id, user_id, status) values ($1, $2, $3, 'active')
       on conflict (estate_id, user_id) do nothing`,
      [uuidv7(), estateId, userId],
    );
    await this.owner.query(
      `insert into platform.role_assignments (id, user_id, role_id, estate_id, reason)
       values ($1, $2, $3, $4, 'e2e seed')`,
      [uuidv7(), userId, builtInRoleId(roleKey), estateId],
    );
  }

  /** Staff member with MFA in an estate, ready to sign in. */
  async staff(estateId: string, roleKey: string, fullName: string): Promise<SeededUser> {
    const user = await this.user(fullName, { mfa: true });
    await this.member(estateId, user.id, roleKey);
    return user;
  }

  async query<T extends pg.QueryResultRow>(sql: string, values: unknown[] = []): Promise<T[]> {
    return (await this.owner.query<T>(sql, values)).rows;
  }
}
