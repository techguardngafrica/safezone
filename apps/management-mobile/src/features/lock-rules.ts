/** Auto-lock after 5 minutes in the background (management-mobile.md §10). */
export const LOCK_AFTER_MS = 5 * 60_000;

/** True when the app was in the background long enough to ask for biometrics or the device PIN again. */
export function shouldLockOnResume(
  backgroundedAt: number | null,
  now: number,
  timeoutMs = LOCK_AFTER_MS,
): boolean {
  if (backgroundedAt === null) return false;
  return now - backgroundedAt >= timeoutMs;
}

/**
 * The lock never covers the SOS screen: a manager must be able to act on an alert straight from a
 * locked phone (§13). Everything else stays behind the lock.
 */
export function lockCovers(pathname: string): boolean {
  return !pathname.startsWith('/sos/');
}
