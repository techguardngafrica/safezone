import { describe, expect, it, vi } from 'vitest';
import { createSafezoneClient, isApiError, newIdempotencyKey, unwrap, unwrapPage } from './index';

describe('createSafezoneClient', () => {
  it('sends the app headers and bearer token', async () => {
    const fetchMock = vi.fn(async (request: Request) => {
      expect(request.headers.get('Authorization')).toBe('Bearer token-123');
      expect(request.headers.get('X-Safezone-App')).toBe('resident-mobile');
      return new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = createSafezoneClient({
      baseUrl: 'http://localhost:4000',
      app: 'resident-mobile',
      appVersion: '1.0.0',
      getAccessToken: () => 'token-123',
      fetch: fetchMock as unknown as typeof fetch,
    });

    const { data } = await client.GET('/health/live');
    expect(data?.status).toBe('ok');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('calls onUnauthorized on 401', async () => {
    const onUnauthorized = vi.fn();
    const client = createSafezoneClient({
      baseUrl: 'http://localhost:4000',
      app: 'management-web',
      appVersion: '1.0.0',
      onUnauthorized,
      fetch: (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch,
    });
    await client.GET('/health/live');
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });
});

describe('isApiError', () => {
  it('recognises the error envelope', () => {
    expect(
      isApiError({ success: false, error: { code: 'X', message: 'Bad', statusCode: 422 } }),
    ).toBe(true);
    expect(isApiError({ success: true, data: {} })).toBe(false);
    expect(isApiError({ message: 'nope' })).toBe(false);
  });
});

describe('unwrap', () => {
  const response = (status: number) => new Response(null, { status });

  it('returns data from the success envelope', async () => {
    await expect(
      unwrap(
        Promise.resolve({
          data: { success: true as const, data: { id: 1 } },
          response: response(200),
        }),
      ),
    ).resolves.toEqual({ id: 1 });
  });

  it('throws ApiClientError with the API code', async () => {
    const error = {
      success: false,
      error: { code: 'OTP_INVALID', message: 'Wrong code', statusCode: 400 },
    };
    await expect(unwrap(Promise.resolve({ error, response: response(400) }))).rejects.toMatchObject(
      {
        name: 'ApiClientError',
        code: 'OTP_INVALID',
        statusCode: 400,
      },
    );
  });

  it('maps network failures to NETWORK_ERROR', async () => {
    await expect(unwrap(Promise.reject(new TypeError('fetch failed')))).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
  });
});

describe('unwrapPage', () => {
  const response = (status: number) => new Response(null, { status });

  it('returns rows and the next cursor', async () => {
    const page = await unwrapPage(
      Promise.resolve({
        data: { success: true as const, data: [{ id: 'a' }], meta: { nextCursor: 'c2' } },
        response: response(200),
      }),
    );
    expect(page).toEqual({ items: [{ id: 'a' }], nextCursor: 'c2' });
  });

  it('returns a null cursor on the last page', async () => {
    const page = await unwrapPage(
      Promise.resolve({
        data: { success: true as const, data: [], meta: { nextCursor: null } },
        response: response(200),
      }),
    );
    expect(page.nextCursor).toBeNull();
  });
});

describe('newIdempotencyKey', () => {
  it('returns a v4 UUID', () => {
    expect(newIdempotencyKey()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('falls back when crypto.randomUUID is missing (Hermes)', () => {
    vi.stubGlobal('crypto', undefined);
    try {
      const a = newIdempotencyKey();
      expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(newIdempotencyKey()).not.toBe(a);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('React Native fetch', () => {
  it('works when fetch returns a response that is not a global Response instance', async () => {
    const body = JSON.stringify({ success: true, data: { status: 'ok' } });
    // Expo/React Native fetch resolves with its own response class, not globalThis.Response.
    const nativeLike = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({
        'content-type': 'application/json',
        'content-length': String(body.length),
      }),
      json: async () => JSON.parse(body) as unknown,
      text: async () => body,
      clone() {
        return this;
      },
    };
    const client = createSafezoneClient({
      baseUrl: 'https://api.example.test',
      app: 'resident-mobile',
      appVersion: '1.0.0',
      fetch: (async () => nativeLike) as unknown as typeof fetch,
    });
    await expect(unwrap(client.GET('/health/live'))).resolves.toEqual({ status: 'ok' });
  });
});
