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

  // Both hooks change nothing they would have to return: openapi-fetch requires a returned value to be
  // `instanceof Request/Response`, which fails on React Native, where fetch uses its own classes.
  const middleware: Middleware = {
    async onRequest({ request }) {
      request.headers.set('X-Safezone-App', options.app);
      request.headers.set('X-Safezone-App-Version', options.appVersion);
      const token = await options.getAccessToken?.();
      if (token) request.headers.set('Authorization', `Bearer ${token}`);
      return undefined;
    },
    async onResponse({ response }) {
      if (response.status === 401) await options.onUnauthorized?.();
      return undefined;
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
  const cryptoApi = (globalThis as { crypto?: Partial<Crypto> }).crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  // React Native (Hermes) may lack crypto.randomUUID. A key only has to be unique per attempt, not secret.
  const bytes = new Uint8Array(16);
  if (typeof cryptoApi?.getRandomValues === 'function') cryptoApi.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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

/**
 * Field errors from a VALIDATION_FAILED response, keyed by field path without the request part, for
 * example `{ 'visitors.0.phone': 'Enter a valid…' }`. Empty for any other error, so forms can always
 * call it. The first message per field wins.
 */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiClientError) || error.code !== 'VALIDATION_FAILED') return {};
  const fields: Record<string, string> = {};
  for (const detail of error.details) {
    const path = detail.path.replace(/^(body|query|params)\.?/, '');
    if (path && !(path in fields)) fields[path] = detail.message;
  }
  return fields;
}

/** A cursor page: the rows plus the cursor for the next page (null on the last page). */
export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

/** Like unwrap(), for list endpoints: keeps `meta.nextCursor` so screens can load the next page. */
export async function unwrapPage<R extends { data?: unknown; error?: unknown; response: Response }>(
  call: Promise<R>,
): Promise<CursorPage<EnvelopeData<R> extends readonly (infer T)[] ? T : never>> {
  type Row = EnvelopeData<R> extends readonly (infer T)[] ? T : never;
  let nextCursor: string | null = null;
  const wrapped = call.then((result) => {
    const body = result.data as { success?: unknown; meta?: { nextCursor?: unknown } } | undefined;
    const next = body?.meta?.nextCursor;
    nextCursor = typeof next === 'string' && next.length > 0 ? next : null;
    return result;
  });
  const items = (await unwrap(wrapped)) as unknown as Row[];
  return { items: Array.isArray(items) ? items : [], nextCursor };
}

export { createAuthApi } from './auth-api';
export type { ApiData, ApiRow } from './types';
