import { describe, expect, it } from 'vitest';
import { loadEnv, parseDurationSeconds } from './env';

const productionEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://safezone_app:pw@db.internal:5432/safezone',
  REDIS_URL: 'rediss://cache.internal:6379',
  CORS_ORIGINS: 'https://manage.safezone.ng,https://admin.safezone.ng',
  MANAGEMENT_WEB_URL: 'https://manage.safezone.ng',
  PUBLIC_WEB_URL: 'https://safezone.ng',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
  OTP_HMAC_SECRET: 'c'.repeat(40),
  MFA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  PASS_KEY_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString('base64'),
  ADS_TRACKING_SECRET: 'd'.repeat(40),
  STORAGE_BUCKET: 'safezone-prod',
  STORAGE_ACCESS_KEY_ID: 'id',
  STORAGE_SECRET_ACCESS_KEY: 'secret',
  MAIL_SMTP_HOST: 'smtp.zoho.com',
  MAIL_SMTP_PORT: '465',
  MAIL_SMTP_SECURE: 'true',
  MAIL_SMTP_USER: 'no-reply@safezone.ng',
  MAIL_SMTP_PASSWORD: 'pw',
  MAIL_SMTP_FROM: 'no-reply@safezone.ng',
  SMS_PROVIDER: 'termii',
  SMS_API_KEY: 'key',
  PAYMENTS_PROVIDER: 'paystack',
  PAYSTACK_SECRET_KEY: 'sk_live_x',
};

describe('loadEnv', () => {
  it('boots locally with defaults', () => {
    const env = loadEnv({});
    expect(env.NODE_ENV).toBe('development');
    expect(env.JWT_ACCESS_TTL).toBe(900);
    expect(env.JWT_REFRESH_TTL).toBe(30 * 86_400);
    expect(new URL(env.DATABASE_URL).username).toBe('safezone_app');
    expect(env.MAIL_TRANSPORT).toBe('smtp');
    expect(env.STORAGE_DRIVER).toBe('s3');
  });

  it('allows the Docker-free development adapters locally', () => {
    const env = loadEnv({ MAIL_TRANSPORT: 'file', STORAGE_DRIVER: 'local' });
    expect(env.MAIL_TRANSPORT).toBe('file');
    expect(env.DEV_OUTBOX_DIR).toBe('.dev-outbox');
    expect(env.STORAGE_DRIVER).toBe('local');
    expect(env.DEV_STORAGE_DIR).toBe('.dev-storage');
  });

  it('accepts a complete production configuration', () => {
    expect(() => loadEnv(productionEnv)).not.toThrow();
  });

  it('treats empty strings as unset', () => {
    expect(loadEnv({ SENTRY_DSN: '', STORAGE_ENDPOINT: '' }).SENTRY_DSN).toBeUndefined();
  });

  it.each([
    ['JWT_ACCESS_SECRET', undefined, /JWT_ACCESS_SECRET: required/],
    ['ADS_TRACKING_SECRET', undefined, /ADS_TRACKING_SECRET: required/],
    ['SMS_PROVIDER', 'fake', /SMS_PROVIDER: fake/],
    ['PAYMENTS_PROVIDER', 'fake', /PAYMENTS_PROVIDER: fake/],
    ['MAIL_TRANSPORT', 'file', /MAIL_TRANSPORT: file/],
    ['STORAGE_DRIVER', 'local', /STORAGE_DRIVER: local/],
    ['PAYSTACK_SECRET_KEY', undefined, /PAYSTACK_SECRET_KEY: required/],
    ['CORS_ORIGINS', 'http://manage.safezone.ng', /https origins/],
    ['DATABASE_URL', 'postgres://safezone:pw@db:5432/safezone', /safezone_app/],
    ['JWT_REFRESH_SECRET', 'a'.repeat(40), /must all differ/],
    ['JWT_ACCESS_SECRET', 'change-me-'.repeat(4), /placeholder/],
  ])('rejects production with bad %s', (name, value, message) => {
    const source: Record<string, string | undefined> = { ...productionEnv, [name]: value };
    expect(() => loadEnv(source)).toThrow(message);
  });

  it('never prints secret values in errors', () => {
    const secret = 'short-secret';
    try {
      loadEnv({ JWT_ACCESS_SECRET: secret });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).toContain('JWT_ACCESS_SECRET');
      expect(String(error)).not.toContain(secret);
    }
  });

  it('rejects malformed values', () => {
    expect(() => loadEnv({ JWT_ACCESS_TTL: '15 minutes' })).toThrow(/JWT_ACCESS_TTL/);
    expect(() => loadEnv({ REDIS_URL: 'http://x' })).toThrow(/REDIS_URL/);
    expect(() => loadEnv({ MFA_ENCRYPTION_KEY: 'abc' })).toThrow(/MFA_ENCRYPTION_KEY/);
  });
});

describe('parseDurationSeconds', () => {
  it.each([
    ['30s', 30],
    ['15m', 900],
    ['12h', 43_200],
    ['30d', 2_592_000],
  ])('%s → %d', (input, seconds) => expect(parseDurationSeconds(input)).toBe(seconds));
});
