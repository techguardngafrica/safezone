import { createAuthApi, createSafezoneClient } from '@safezone/api-client';
import { createMemorySessionStorage, SessionController } from '@safezone/auth';

/**
 * Session for the Estate Management web app. The access token lives in memory only; the refresh token is an httpOnly
 * cookie set by the API, so nothing sensitive is in localStorage (AGENTS.md §6.1).
 */
const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const appVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? '0.1.0';

const authClient = createSafezoneClient({
  baseUrl,
  app: 'management-web',
  appVersion,
  credentials: 'include',
});

export const session = new SessionController(
  createAuthApi(authClient, { app: 'management-web', platform: 'web', appVersion }),
  createMemorySessionStorage(),
  false,
);

/** API client for signed-in calls: attaches the access token and ends the session on 401. */
export const api = createSafezoneClient({
  baseUrl,
  app: 'management-web',
  appVersion,
  credentials: 'include',
  getAccessToken: session.getAccessToken,
  onUnauthorized: session.handleUnauthorized,
});
