import { z } from 'zod';

/**
 * Environment validation — the process fails fast on boot if configuration is invalid.
 * Keep in sync with /.env.example (AGENTS.md §9 step 5). Phase 0 task 3 extends this to every variable.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  APP_PROCESS: z.enum(['api', 'worker', 'realtime']).default('api'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  REALTIME_PORT: z.coerce.number().int().positive().default(4001),
  DATABASE_URL: z.string().default('postgres://safezone:safezone@localhost:5432/safezone'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000,http://localhost:3001,http://localhost:3002')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  /** Minimum and recommended versions per app for forced/soft update prompts. Moves to the platform module later. */
  APP_MIN_VERSION: z.string().default('0.0.0'),
  APP_RECOMMENDED_VERSION: z.string().default('0.0.0'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `  - ${issue.path.join('.')}: ${issue.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`);
  }
  if (parsed.data.NODE_ENV === 'production' && source.DATABASE_URL === undefined) {
    throw new Error('DATABASE_URL must be set in production');
  }
  return parsed.data;
}
