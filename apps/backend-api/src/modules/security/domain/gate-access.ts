import { GATE_SESSION_PERMISSIONS } from '@safezone/permissions';

/** Gate devices and guard PINs (ADR-0017). Pure functions. */

export const PIN_LENGTH = 6;
/** Wrong PINs before the guard's PIN locks until a supervisor resets it (security-mobile.md §10). */
export const MAX_PIN_ATTEMPTS = 5;
/** Failed sign-ins per device before it is blocked for the window. */
export const DEVICE_FAILURES_LIMIT = 20;
export const DEVICE_FAILURE_WINDOW_SECONDS = 10 * 60;
/** Hard limit of a gate shift session (identity.md §5.3). */
export const GATE_SESSION_HOURS = 12;

const CREDENTIAL_PREFIX = 'gd1.';
const UUID_HEX = /^[0-9a-f]{32}$/;

/** Refuses PINs anyone would try first. */
export function pinWeakness(pin: string): 'format' | 'weak' | null {
  if (!new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin)) return 'format';
  if (/^(\d)\1+$/.test(pin)) return 'weak';
  const digits = [...pin].map(Number);
  const steps = digits.slice(1).map((digit, index) => digit - (digits[index] ?? 0));
  if (steps.every((step) => step === 1) || steps.every((step) => step === -1)) return 'weak';
  if (['121212', '112233', '123123', '696969', '101010', '200000', '000001'].includes(pin))
    return 'weak';
  return null;
}

function uuidHex(uuid: string): string {
  return uuid.replace(/-/g, '').toLowerCase();
}

function hexUuid(hex: string): string {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Device credential: `gd1.<estate hex>.<device hex>.<secret>`. The estate and device ids let the server
 * find the row under that estate's RLS; only the secret is checked (by HMAC, constant time).
 */
export function encodeDeviceCredential(estateId: string, deviceId: string, secret: string): string {
  return `${CREDENTIAL_PREFIX}${uuidHex(estateId)}.${uuidHex(deviceId)}.${secret}`;
}

export function parseDeviceCredential(
  credential: string,
): { estateId: string; deviceId: string; secret: string } | null {
  if (!credential.startsWith(CREDENTIAL_PREFIX)) return null;
  const [estate, device, secret, ...rest] = credential.slice(CREDENTIAL_PREFIX.length).split('.');
  if (rest.length > 0 || !estate || !device || !secret) return null;
  if (!UUID_HEX.test(estate) || !UUID_HEX.test(device)) return null;
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) return null;
  return { estateId: hexUuid(estate), deviceId: hexUuid(device), secret };
}

/** "Ada Obi" → "Ada O."; minimum shown on a shared device (AGENTS.md §6.5). */
export function guardDisplayName(fullName: string | null, fallback: string): string {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  const [first, ...others] = parts;
  if (!first) return fallback;
  const last = others.at(-1);
  return last ? `${first} ${last.charAt(0).toUpperCase()}.` : first;
}

/** After a wrong PIN: the new attempt count and whether the PIN is now locked. */
export function afterWrongPin(failedAttempts: number): { attempts: number; locked: boolean } {
  const attempts = failedAttempts + 1;
  return { attempts, locked: attempts >= MAX_PIN_ATTEMPTS };
}

/** The permissions a gate shift session keeps: the guard's own, cut down to the gate ceiling. */
export function gateCeiling(permissions: ReadonlySet<string>): Set<string> {
  return new Set(GATE_SESSION_PERMISSIONS.filter((permission) => permissions.has(permission)));
}
