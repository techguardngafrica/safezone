import { describe, expect, it, vi } from 'vitest';
import { createSafezoneClient, isProblemDetails } from './index';

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

describe('isProblemDetails', () => {
  it('recognises problem+json bodies', () => {
    expect(isProblemDetails({ type: 'x', title: 'Bad', status: 422, code: 'X' })).toBe(true);
    expect(isProblemDetails({ message: 'nope' })).toBe(false);
  });
});
