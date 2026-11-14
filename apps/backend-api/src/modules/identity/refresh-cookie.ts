import type { Request, Response } from 'express';

/** Web apps keep the refresh token in this cookie; JavaScript never sees it. */
export const REFRESH_COOKIE = 'sz_rt';
const COOKIE_PATH = '/v1/auth';

export function setRefreshCookie(
  response: Response,
  token: string,
  maxAgeSeconds: number,
  secure: boolean,
): void {
  response.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: COOKIE_PATH,
    maxAge: maxAgeSeconds * 1000,
  });
}

export function clearRefreshCookie(response: Response, secure: boolean): void {
  response.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: COOKIE_PATH,
  });
}

/** Minimal cookie read (no cookie-parser dependency): returns the refresh cookie value, if any. */
export function readRefreshCookie(request: Request): string | undefined {
  const header = request.header('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === REFRESH_COOKIE) {
      try {
        return decodeURIComponent(rest.join('='));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
