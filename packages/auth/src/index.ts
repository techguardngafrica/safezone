/**
 * @safezone/auth — client-side session helpers shared by all apps.
 * Spec: docs/architecture/modules/identity.md.
 *
 * Storage is injected: mobile apps use expo-secure-store, web apps keep the refresh token
 * in an httpOnly cookie set by the API and only hold the access token in memory.
 * Never put tokens in localStorage, logs or analytics.
 */

export interface StoredSession {
  accessToken: string;
  /** Present on mobile only; web relies on the httpOnly refresh cookie. */
  refreshToken?: string;
  /** ISO timestamp from the API. */
  accessTokenExpiresAt: string;
}

export interface SessionStorage {
  get(): Promise<StoredSession | null>;
  set(session: StoredSession): Promise<void>;
  clear(): Promise<void>;
}

/** In-memory storage for web apps and tests. */
export function createMemorySessionStorage(): SessionStorage {
  let current: StoredSession | null = null;
  return {
    async get() {
      return current;
    },
    async set(session) {
      current = session;
    },
    async clear() {
      current = null;
    },
  };
}

/** True when the access token expires within `skewSeconds` (refresh early to avoid 401s). */
export function isAccessTokenExpiring(
  session: Pick<StoredSession, 'accessTokenExpiresAt'>,
  now: Date = new Date(),
  skewSeconds = 60,
): boolean {
  const expiresAt = Date.parse(session.accessTokenExpiresAt);
  if (Number.isNaN(expiresAt)) return true;
  return expiresAt - now.getTime() <= skewSeconds * 1000;
}

/**
 * Wraps a refresh call so concurrent requests share one in-flight refresh
 * (refresh tokens rotate; parallel refreshes would trigger reuse detection).
 */
export function createSingleFlightRefresh<T>(refresh: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null;
  return () => {
    if (!inFlight) {
      inFlight = refresh().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  };
}

/** Masks a phone number for display or logs: +2348031234567 → +234803****567 */
export function maskPhone(phone: string): string {
  if (phone.length < 8) return '****';
  return `${phone.slice(0, 7)}****${phone.slice(-3)}`;
}
