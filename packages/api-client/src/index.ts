/**
 * @safezone/api-client — the only way apps talk to backend-api.
 * Types come from @safezone/contracts (generated from the backend's OpenAPI document),
 * so calls are checked against the real API at compile time.
 */
import createClient, { type Client, type Middleware } from 'openapi-fetch';
import type { paths } from '@safezone/contracts';
import type { ApiErrorBody, AppName } from '@safezone/types';

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
  /** Web apps pass 'include' so the httpOnly refresh cookie is sent to /v1/auth/refresh. */
  credentials?: RequestCredentials;
}

/** Typed client for the Safezone API (paths from @safezone/contracts). */
export type SafezoneClient = Client<paths>;

export function createSafezoneClient(options: SafezoneClientOptions): SafezoneClient {
  const client = createClient<paths>({
    baseUrl: options.baseUrl,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.credentials ? { credentials: options.credentials } : {}),
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

/** Narrow an unknown response body to the API error envelope. */
export function isApiError(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as { success?: unknown; error?: unknown };
  if (body.success !== false || typeof body.error !== 'object' || body.error === null) return false;
  const error = body.error as { code?: unknown; message?: unknown; statusCode?: unknown };
  return (
    typeof error.code === 'string' &&
    typeof error.message === 'string' &&
    typeof error.statusCode === 'number'
  );
}

/** Creates a unique key for the Idempotency-Key header on retryable mutations. */
export function newIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}

/** Thrown by unwrap() for any non-success response. `code` is the API's stable error code. */
export class ApiClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number,
    readonly details: ReadonlyArray<{ path: string; message: string }> = [],
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

/**
 * Unwraps an openapi-fetch result: returns `data` from the success envelope or throws ApiClientError.
 * Network failures surface as code NETWORK_ERROR so screens can show their offline state.
 *
 *   const me = await unwrap(client.GET('/v1/me'));
 */
/** The `data` inside a success envelope of an openapi-fetch result. */
export type EnvelopeData<R> = R extends { data?: infer B }
  ? [NonNullable<B>] extends [never]
    ? never
    : NonNullable<B> extends { data: infer D }
      ? D
      : never
  : never;

export async function unwrap<R extends { data?: unknown; error?: unknown; response: Response }>(
  call: Promise<R>,
): Promise<EnvelopeData<R>> {
  let result: R;
  try {
    result = await call;
  } catch {
    throw new ApiClientError('NETWORK_ERROR', 'No connection', 0);
  }
  const body = result.data as { success?: unknown; data?: unknown } | undefined;
  if (body && body.success === true) return body.data as EnvelopeData<R>;
  if (isApiError(result.error)) {
    const { code, message, statusCode, details } = result.error.error;
    throw new ApiClientError(code, message, statusCode, details ?? []);
  }
  if (result.response.status === 204) return undefined as EnvelopeData<R>;
  throw new ApiClientError(
    'UNEXPECTED_RESPONSE',
    'Unexpected response from the server',
    result.response.status,
  );
}

export { createAuthApi } from './auth-api';
