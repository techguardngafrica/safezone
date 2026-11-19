import { argon2idAsync } from '@noble/hashes/argon2';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';

/**
 * Offline guard PIN check (ADR-0017 point 6). After a successful online PIN sign-in the device keeps a
 * slow Argon2id verifier of that guard's PIN, in the OS keystore (SecureStore), for 7 days. Five wrong
 * offline PINs, a PIN change, a lockout or a reset (seen at the next sync) remove it.
 */
export const VERIFIER_DAYS = 7;
export const MAX_OFFLINE_ATTEMPTS = 5;
/** 8 MiB, 2 passes: about 1 to 2 seconds on a low-end Android phone, done off the UI frame. */
export const VERIFIER_PARAMS = { m: 8192, t: 2, p: 1, dkLen: 32 } as const;

export interface PinVerifier {
  version: 1;
  userId: string;
  displayName: string;
  fullName: string | null;
  salt: string;
  hash: string;
  createdAt: string;
  /** The server's PIN set time when this was made; a newer one means the PIN changed. */
  pinSetAt: string;
  failedAttempts: number;
}

/** Keychain-backed key/value store (SecureStore on the device, a Map in tests). */
export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const keyOf = (userId: string) => `safezone.security.pinv.${userId.replace(/[^0-9a-f-]/gi, '')}`;

function randomSalt(): Uint8Array {
  const bytes = new Uint8Array(16);
  const cryptoApi = (globalThis as { crypto?: Partial<Crypto> }).crypto;
  if (typeof cryptoApi?.getRandomValues === 'function') cryptoApi.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

async function derive(pin: string, salt: Uint8Array): Promise<string> {
  return bytesToHex(await argon2idAsync(utf8ToBytes(pin), salt, VERIFIER_PARAMS));
}

/** Constant-time comparison of two hex strings. */
function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function rememberPin(
  store: SecretStore,
  input: {
    userId: string;
    displayName: string;
    fullName: string | null;
    pin: string;
    pinSetAt: string;
  },
  now: Date = new Date(),
): Promise<void> {
  const salt = randomSalt();
  const verifier: PinVerifier = {
    version: 1,
    userId: input.userId,
    displayName: input.displayName,
    fullName: input.fullName,
    salt: bytesToHex(salt),
    hash: await derive(input.pin, salt),
    createdAt: now.toISOString(),
    pinSetAt: input.pinSetAt,
    failedAttempts: 0,
  };
  await store.set(keyOf(input.userId), JSON.stringify(verifier));
}

export async function readVerifier(
  store: SecretStore,
  userId: string,
  now: Date = new Date(),
): Promise<PinVerifier | null> {
  const raw = await store.get(keyOf(userId));
  if (!raw) return null;
  try {
    const verifier = JSON.parse(raw) as PinVerifier;
    const age = now.getTime() - new Date(verifier.createdAt).getTime();
    if (verifier.version !== 1 || age < 0 || age > VERIFIER_DAYS * 86_400_000) {
      await store.remove(keyOf(userId));
      return null;
    }
    return verifier;
  } catch {
    await store.remove(keyOf(userId));
    return null;
  }
}

export type OfflineCheck = 'ok' | 'wrong' | 'wiped' | 'unavailable';

/** Checks a PIN offline. The fifth wrong PIN wipes the verifier: the guard must then sign in online. */
export async function checkPinOffline(
  store: SecretStore,
  userId: string,
  pin: string,
  now: Date = new Date(),
): Promise<OfflineCheck> {
  const verifier = await readVerifier(store, userId, now);
  if (!verifier) return 'unavailable';
  const hash = await derive(pin, hexToBytes(verifier.salt));
  if (sameHex(hash, verifier.hash)) {
    if (verifier.failedAttempts > 0)
      await store.set(keyOf(userId), JSON.stringify({ ...verifier, failedAttempts: 0 }));
    return 'ok';
  }
  const failedAttempts = verifier.failedAttempts + 1;
  if (failedAttempts >= MAX_OFFLINE_ATTEMPTS) {
    await store.remove(keyOf(userId));
    return 'wiped';
  }
  await store.set(keyOf(userId), JSON.stringify({ ...verifier, failedAttempts }));
  return 'wrong';
}

/**
 * Drops verifiers the server no longer stands behind (from the guard list at each sync): guard gone,
 * PIN locked or not set, or set again since the verifier was made.
 */
export async function reconcileVerifiers(
  store: SecretStore,
  knownUserIds: readonly string[],
  guards: readonly { userId: string; pinSet: boolean; locked: boolean; pinSetAt: string | null }[],
): Promise<void> {
  const byId = new Map(guards.map((guard) => [guard.userId, guard]));
  for (const userId of knownUserIds) {
    const raw = await store.get(keyOf(userId));
    if (!raw) continue;
    const guard = byId.get(userId);
    let verifier: PinVerifier | null;
    try {
      verifier = JSON.parse(raw) as PinVerifier;
    } catch {
      verifier = null;
    }
    const stale =
      !verifier ||
      !guard ||
      !guard.pinSet ||
      guard.locked ||
      (guard.pinSetAt !== null && guard.pinSetAt !== verifier.pinSetAt);
    if (stale) await store.remove(keyOf(userId));
  }
}
