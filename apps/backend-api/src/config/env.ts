import { z } from 'zod';

/**
 * Environment validation (Phase 0 task 3). Every process calls loadEnv() on boot and exits if the
 * configuration is invalid. Keep in sync with /.env.example and docs/operations/environment-variables.md.
 *
 * Local defaults exist only so `pnpm dev` works against docker-compose. In staging and production every
 * secret and connection string must be set explicitly (see refineDeployed below).
 */

const DURATION_PATTERN = /^(\d+)(s|m|h|d)$/;
const DURATION_UNITS = { s: 1, m: 60, h: 3600, d: 86_400 } as const;

/** "15m" → 900. Seconds. */
export function parseDurationSeconds(value: string): number {
  const match = DURATION_PATTERN.exec(value.trim());
  if (!match) throw new Error(`Invalid duration "${value}" (use e.g. 30s, 15m, 12h, 30d)`);
  const amount = Number(match[1]);
  const unit = match[2] as keyof typeof DURATION_UNITS;
  return amount * DURATION_UNITS[unit];
}

const duration = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .refine((value) => DURATION_PATTERN.test(value.trim()), 'use a duration such as 15m or 30d')
    .transform(parseDurationSeconds);

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });
const optionalString = z
  .string()
  .optional()
  .transform((value) => (value && value.trim() !== '' ? value.trim() : undefined));
const optionalUrl = optionalString.pipe(z.url().optional());
const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .default(fallback ? 'true' : 'false')
    .transform((value) => value === 'true' || value === '1');

/** 32 random bytes, base64. Generate with: openssl rand -base64 32 */
const key32 = z
  .string()
  .refine((value) => Buffer.from(value, 'base64').length === 32, 'must be 32 bytes, base64');

// Local-only placeholder values. refineDeployed rejects them outside development and test.
const LOCAL = {
  jwtAccess: 'local-only-access-secret-change-me-0000000000',
  jwtRefresh: 'local-only-refresh-secret-change-me-000000000',
  otp: 'local-only-otp-secret-change-me-00000000000000',
  mfaKey: Buffer.alloc(32, 7).toString('base64'),
} as const;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  APP_PROCESS: z.enum(['api', 'worker', 'realtime']).default('api'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  REALTIME_PORT: z.coerce.number().int().positive().default(4001),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  /** Number of proxy hops to trust for the client IP (rate limits, audit). 0 locally. */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000,http://localhost:3001,http://localhost:3002')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.url()).min(1)),

  /** Base URL of management-web; invitation links point here (tenancy.md §4.2). */
  MANAGEMENT_WEB_URL: z.url().default('http://localhost:3001'),

  /** Fallback when no app_versions row exists (platform module). */
  APP_MIN_VERSION: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .default('0.0.0'),
  APP_RECOMMENDED_VERSION: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .default('0.0.0'),

  /** Application role (safezone_app, cannot bypass RLS). Used by API, worker and realtime. */
  DATABASE_URL: postgresUrl.default('postgres://safezone_app:safezone_app@localhost:5432/safezone'),
  DATABASE_REPLICA_URL: optionalString.pipe(postgresUrl.optional()),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  /** Schema owner; read by the Prisma CLI only. Listed so a typo is caught. */
  DATABASE_MIGRATION_URL: optionalString.pipe(postgresUrl.optional()),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }).default('redis://localhost:6379'),

  JWT_ACCESS_SECRET: z.string().min(32).default(LOCAL.jwtAccess),
  JWT_ACCESS_TTL: duration('15m'),
  /** HMAC key for refresh token hashes. */
  JWT_REFRESH_SECRET: z.string().min(32).default(LOCAL.jwtRefresh),
  JWT_REFRESH_TTL: duration('30d'),
  /** HMAC key for OTP code hashes. */
  OTP_HMAC_SECRET: z.string().min(32).default(LOCAL.otp),
  /** AES-256-GCM key for TOTP secrets at rest. */
  MFA_ENCRYPTION_KEY: key32.default(LOCAL.mfaKey),

  STORAGE_BUCKET: z.string().min(3).default('safezone-local'),
  STORAGE_REGION: z.string().min(1).default('us-east-1'),
  STORAGE_ENDPOINT: optionalUrl,
  STORAGE_ACCESS_KEY_ID: optionalString,
  STORAGE_SECRET_ACCESS_KEY: optionalString,
  /** MinIO needs path-style URLs. */
  STORAGE_FORCE_PATH_STYLE: bool(true),

  /** Email: Zoho SMTP in staging/production, Mailpit locally. */
  MAIL_SMTP_HOST: z.string().min(1).default('localhost'),
  MAIL_SMTP_PORT: z.coerce.number().int().positive().default(1025),
  MAIL_SMTP_SECURE: bool(false),
  MAIL_SMTP_USER: optionalString,
  MAIL_SMTP_PASSWORD: optionalString,
  MAIL_SMTP_FROM: z.email().default('no-reply@safezone.local'),

  /** Expo push (optional access token when enhanced push security is on in the Expo project). */
  EXPO_ACCESS_TOKEN: optionalString,

  PAYSTACK_SECRET_KEY: optionalString,
  FLUTTERWAVE_SECRET_KEY: optionalString,
  /** `fake` logs a masked delivery instead of sending; never allowed in staging/production. */
  SMS_PROVIDER: z.enum(['fake', 'termii']).default('fake'),
  SMS_API_KEY: optionalString,
  SMS_SENDER_ID: z.string().min(1).max(11).default('Safezone'),
  WHATSAPP_TOKEN: optionalString,
  WHATSAPP_PHONE_NUMBER_ID: optionalString,
  VOICE_PROVIDER: z.enum(['fake', 'africastalking', 'twilio']).default('fake'),
  VOICE_API_KEY: optionalString,
  KYC_PROVIDER: optionalString,
  KYC_API_KEY: optionalString,
  BILLS_PROVIDER: optionalString,
  BILLS_API_KEY: optionalString,
  GOOGLE_MAPS_KEY: optionalString,

  SENTRY_DSN: optionalUrl,
  OTEL_EXPORTER_OTLP_ENDPOINT: optionalUrl,
});

type ParsedEnv = z.infer<typeof envSchema>;

/** Rules that only apply where real users and money are involved. */
function deployedIssues(env: ParsedEnv, source: NodeJS.ProcessEnv): string[] {
  if (env.NODE_ENV !== 'staging' && env.NODE_ENV !== 'production') return [];
  const issues: string[] = [];
  const mustBeSet = [
    'DATABASE_URL',
    'REDIS_URL',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'OTP_HMAC_SECRET',
    'MFA_ENCRYPTION_KEY',
    'STORAGE_BUCKET',
    'STORAGE_ACCESS_KEY_ID',
    'STORAGE_SECRET_ACCESS_KEY',
    'MAIL_SMTP_HOST',
    'MAIL_SMTP_USER',
    'MAIL_SMTP_PASSWORD',
    'MAIL_SMTP_FROM',
    'SMS_API_KEY',
  ] as const;
  for (const name of mustBeSet) {
    if (!source[name] || source[name]?.trim() === '')
      issues.push(`${name}: required in ${env.NODE_ENV}`);
  }
  const secrets = [env.JWT_ACCESS_SECRET, env.JWT_REFRESH_SECRET, env.OTP_HMAC_SECRET];
  if (secrets.some((secret) => /change-me|local-only/i.test(secret))) {
    issues.push('JWT/OTP secrets: placeholder values are not allowed');
  }
  if (new Set(secrets).size !== secrets.length) {
    issues.push('JWT_ACCESS_SECRET, JWT_REFRESH_SECRET and OTP_HMAC_SECRET must all differ');
  }
  if (env.MFA_ENCRYPTION_KEY === LOCAL.mfaKey) issues.push('MFA_ENCRYPTION_KEY: placeholder value');
  if (env.SMS_PROVIDER === 'fake') issues.push('SMS_PROVIDER: fake is not allowed');
  if (env.CORS_ORIGINS.some((origin) => !origin.startsWith('https://'))) {
    issues.push('CORS_ORIGINS: only https origins are allowed');
  }
  if (!env.MANAGEMENT_WEB_URL.startsWith('https://')) {
    issues.push('MANAGEMENT_WEB_URL: must be https');
  }
  if (new URL(env.DATABASE_URL).username !== 'safezone_app') {
    issues.push('DATABASE_URL: must connect as safezone_app (RLS cannot be bypassed)');
  }
  return issues;
}

export type Env = ParsedEnv;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    // Paths only: never print values, they may be secrets.
    const issues = parsed.error.issues.map(
      (issue) => `  - ${issue.path.join('.')}: ${issue.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`);
  }
  const issues = deployedIssues(parsed.data, source);
  if (issues.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`,
    );
  }
  return parsed.data;
}
