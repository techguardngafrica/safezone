/**
 * @safezone/api-client — the only way apps talk to backend-api.
 * Types come from @safezone/contracts (generated from the backend's OpenAPI document),
 * so calls are checked against the real API at compile time.
 */
import createClient, { type Middleware } from 'openapi-fetch';
import type { paths } from '@safezone/contracts';
import type { AppName, ProblemDetails } from '@safezone/types';

export interface SafezoneClientOptions {
  /** e.g. https://api.safezone.ng or http://localhost:4000 */
  baseUrl: string;
  /** Which app is calling; sent as X-Safezone-App for logging and version checks. */
  app: AppName;
  appVersion: string;
  /** Returns the current access token, or null when signed out. */
  getAccessToken?: () => string | null | Promise<string | null>;
  /** Called on 401 so the app can refresh tokens or sign the user out. */
  onUnauthorized?: () => void | Promise<void>;
  fetch?: typeof fetch;
}

export function createSafezoneClient(options: SafezoneClientOptions) {
  const client = createClient<paths>({
    baseUrl: options.baseUrl,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  const middleware: Middleware = {
    async onRequest({ request }) {
      request.headers.set('X-Safezone-App', options.app);
      request.headers.set('X-Safezone-App-Version', options.appVersion);
      const token = await options.getAccessToken?.();
      if (token) request.headers.set('Authorization', `Bearer ${token}`);
      return request;
    },
    async onResponse({ response }) {
      if (response.status === 401) await options.onUnauthorized?.();
      return response;
    },
  };
  client.use(middleware);

  return client;
}

export type SafezoneClient = ReturnType<typeof createSafezoneClient>;

/** Narrow an unknown error body to RFC 9457 problem details. */
export function isProblemDetails(value: unknown): value is ProblemDetails {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'status' in value &&
    'title' in value
  );
}

/** Creates a unique key for the Idempotency-Key header on retryable mutations. */
export function newIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}
