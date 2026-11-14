import { describe, expect, it, vi } from 'vitest';
import { ApiExceptionFilter } from './api-exception.filter';
import { DomainError, RateLimitedError } from './domain-error';

function hostFor() {
  const json = vi.fn();
  const setHeader = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const response = { status, setHeader };
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({ getResponse: () => response }),
  };
  return { host: host as never, status, json, setHeader };
}

describe('ApiExceptionFilter', () => {
  const filter = new ApiExceptionFilter();

  it('maps domain errors to the envelope', () => {
    const { host, status, json } = hostFor();
    filter.catch(new DomainError('VISITOR_PASS_EXPIRED', 'Visitor pass has expired', 422), host);
    expect(status).toHaveBeenCalledWith(422);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'VISITOR_PASS_EXPIRED', message: 'Visitor pass has expired', statusCode: 422 },
    });
  });

  it('hides internal errors', () => {
    const { host, status, json } = hostFor();
    filter.catch(new Error('connection to 10.0.0.5 refused for user +2348031234567'), host);
    expect(status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0]?.[0] as { error: { message: string; code: string } };
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(body)).not.toMatch(/10\.0\.0\.5|stack|2348031234567/);
  });

  it('sets Retry-After on rate limits', () => {
    const { host, setHeader } = hostFor();
    filter.catch(new RateLimitedError(120), host);
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '120');
  });
});
