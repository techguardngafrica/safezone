import { describe, expect, it, vi } from 'vitest';
import { createSafezoneClient, isApiError, unwrap } from './index';

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
