import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { E2E } from './config';
import { clearRateLimits } from './redis';
import { type SeededUser, totpCode } from './seed';

/** Files in the API's file outbox (MAIL_TRANSPORT=file), oldest first. */
async function outboxFiles(): Promise<string[]> {
  return (await readdir(E2E.outboxDir).catch(() => [] as string[]))
    .filter((file) => file.endsWith('.txt'))
    .sort();
}

/**
 * Runs `send` (which asks the API for a sign-in code) and returns the code the fake SMS sender wrote to
 * the file outbox for that phone. Only files written after `send` started are read.
 */
export async function captureOtp(phone: string, send: () => Promise<unknown>): Promise<string> {
  const before = new Set(await outboxFiles());
  await send();
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    for (const file of (await outboxFiles()).filter((name) => !before.has(name)).reverse()) {
      const text = await readFile(path.join(E2E.outboxDir, file), 'utf8');
      if (!text.includes(`Subject: SMS to ${phone}\n`)) continue;
      const code = /\b(\d{6})\b/.exec(text.split('\n\n').slice(1).join('\n'))?.[1];
      if (code) return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no sign-in code for ${phone.slice(0, 7)}… in the outbox`);
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(`${status} ${code}: ${message}`);
  }
}

type Json = Record<string, unknown> | unknown[];

/** Signed-in HTTP client for setting up data through the real API (same envelope as the apps). */
export class ApiSession {
  constructor(
    readonly user: SeededUser,
    private readonly accessToken: string,
    private readonly appHeaders: Record<string, string>,
  ) {}

  async request<T = unknown>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    body?: Json,
    headers: Record<string, string> = {},
  ): Promise<T> {
    const response = await fetch(`${E2E.apiUrl}${url}`, {
      method,
      headers: {
        ...this.appHeaders,
        authorization: `Bearer ${this.accessToken}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      data?: T;
      error?: { code?: string; message?: string };
    };
    if (!response.ok || payload.success === false)
      throw new ApiError(
        response.status,
        payload.error?.code ?? 'UNKNOWN',
        payload.error?.message ?? response.statusText,
      );
    return payload.data as T;
  }

  get<T = unknown>(url: string) {
    return this.request<T>('GET', url);
  }

  post<T = unknown>(url: string, body: Json = {}, headers?: Record<string, string>) {
    return this.request<T>('POST', url, body, headers);
  }

  patch<T = unknown>(url: string, body: Json, headers?: Record<string, string>) {
    return this.request<T>('PATCH', url, body, headers);
  }
}

const DEVICES = {
  web: { app: 'public-web', platform: 'web', appVersion: '1.0.0' },
  resident: { app: 'resident-mobile', platform: 'android', appVersion: '1.0.0' },
  security: { app: 'security-mobile', platform: 'android', appVersion: '1.0.0' },
} as const;

export type DeviceKind = keyof typeof DEVICES;

async function post(url: string, body: Json, headers: Record<string, string> = {}) {
  const response = await fetch(`${E2E.apiUrl}${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    data?: Record<string, unknown>;
    error?: { code?: string; message?: string };
  };
  if (!response.ok)
    throw new ApiError(
      response.status,
      payload.error?.code ?? 'UNKNOWN',
      payload.error?.message ?? '',
    );
  return payload.data ?? {};
}

/** Signs a user in through the real OTP flow (and TOTP when seeded) and returns an API session. */
export async function apiSignIn(
  redisUrl: string,
  user: SeededUser,
  device: DeviceKind = 'web',
): Promise<ApiSession> {
  await clearRateLimits(redisUrl);
  const info = DEVICES[device];
  const appHeaders = { 'X-Safezone-App': info.app, 'X-Safezone-App-Version': info.appVersion };
  const code = await captureOtp(user.phone, () =>
    post('/v1/auth/otp/request', { phone: user.phone }, appHeaders),
  );
  const verified = await post(
    '/v1/auth/otp/verify',
    { phone: user.phone, code, device: info },
    appHeaders,
  );
  const accessToken = String(verified.accessToken);
  if (verified.mfaRequired) {
    if (!user.totpSecret) throw new Error(`${user.fullName} needs MFA but has no seeded secret`);
    await post(
      '/v1/auth/mfa/verify',
      { code: await totpCode(user.totpSecret) },
      { ...appHeaders, authorization: `Bearer ${accessToken}` },
    );
  }
  return new ApiSession(user, accessToken, appHeaders);
}
