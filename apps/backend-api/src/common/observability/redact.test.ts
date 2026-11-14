import { describe, expect, it } from 'vitest';
import { JsonLogger } from './json-logger';
import { maskString, REDACTED, redact } from './redact';

describe('redact', () => {
  it('removes secret fields wherever they are', () => {
    const output = redact({
      phone: '+2348031234567',
      otp: '123456',
      nested: { password: 'hunter2', refreshToken: 'abc', items: [{ pin: '1234' }] },
      headers: { authorization: 'Bearer xyz' },
      accountNumber: '0123456789',
    });
    expect(output).toEqual({
      phone: '+234803****567',
      otp: REDACTED,
      nested: { password: REDACTED, refreshToken: REDACTED, items: [{ pin: REDACTED }] },
      headers: { authorization: REDACTED },
      accountNumber: REDACTED,
    });
  });

  it('masks phones, emails, JWTs and long digit runs inside text', () => {
    const text = maskString(
      'call 08031234567 or +2348031234567, mail ada@example.com, token eyJhbGciOi.eyJzdWIi.sig, NIN 12345678901',
    );
    expect(text).not.toMatch(/8031234567|ada@|eyJhbGciOi|12345678901/);
    expect(text).toContain('a***@example.com');
  });

  it('survives cycles', () => {
    const value: Record<string, unknown> = { a: 1 };
    value.self = value;
    expect(redact(value)).toEqual({ a: 1, self: '[Circular]' });
  });
});

describe('JsonLogger', () => {
  it('writes one masked JSON line and respects the level', () => {
    const lines: string[] = [];
    const logger = new JsonLogger('info', 'test', (line) => lines.push(line));
    logger.debug('hidden');
    logger.log({ msg: 'otp sent', phone: '+2348031234567', otp: '654321' }, 'Identity');
    logger.error('failed for +2348031234567', 'Error: stack', 'Identity');

    expect(lines).toHaveLength(2);
    const info = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(info).toMatchObject({
      level: 'info',
      context: 'Identity',
      phone: '+234803****567',
      otp: REDACTED,
    });
    expect(lines.join('')).not.toContain('654321');
    expect(lines.join('')).not.toContain('8031234567');
  });
});
