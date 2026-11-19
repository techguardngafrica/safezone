#!/usr/bin/env node
/**
 * Runs the integration and isolation suites against the local (host) PostgreSQL and Redis, without
 * Docker. Reads apps/backend-api/.env for the connection details unless TEST_* variables are already set:
 *   TEST_PG_ADMIN_URL    superuser URL; defaults to DATABASE_MIGRATION_URL with the database set to `postgres`
 *   TEST_PG_APP_PASSWORD safezone_app password; defaults to the one in DATABASE_URL
 *   TEST_REDIS_URL       defaults to REDIS_URL with database index 15
 * Each test file creates and drops its own `safezone_test_<random>` database; dev data is never touched.
 * Usage: pnpm --filter @safezone/backend-api test:integration:host [vitest args, e.g. a file path]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readEnv(file) {
  if (!existsSync(file)) return {};
  const values = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match) values[match[1]] = match[2].replace(/\s+#.*$/, '').replace(/^['"]|['"]$/g, '');
  }
  return values;
}

// Only connection details are taken from .env; the tests set the rest of their own environment.
const dotenv = readEnv(path.join(root, '.env'));
const source = { ...dotenv, ...process.env };
const env = { ...process.env };
for (const key of ['TEST_PG_ADMIN_URL', 'TEST_PG_APP_PASSWORD', 'TEST_REDIS_URL'])
  if (source[key] !== undefined) env[key] = source[key];

if (!env.TEST_PG_ADMIN_URL) {
  if (!source.DATABASE_MIGRATION_URL) {
    console.error('Set TEST_PG_ADMIN_URL or DATABASE_MIGRATION_URL in apps/backend-api/.env');
    process.exit(1);
  }
  const admin = new URL(source.DATABASE_MIGRATION_URL);
  admin.pathname = '/postgres';
  env.TEST_PG_ADMIN_URL = admin.toString();
}
if (env.TEST_PG_APP_PASSWORD === undefined && source.DATABASE_URL) {
  env.TEST_PG_APP_PASSWORD = decodeURIComponent(new URL(source.DATABASE_URL).password);
}
if (!env.TEST_REDIS_URL) {
  const redis = new URL(source.REDIS_URL ?? 'redis://127.0.0.1:6379');
  redis.pathname = '/15';
  env.TEST_REDIS_URL = redis.toString();
}

/** Drops databases left by a crashed run. Only names this harness creates are touched. */
function sweep() {
  const sql = "select datname from pg_database where datname ~ '^safezone_test_[0-9a-f]{16}$'";
  const list = spawnSync('psql', [env.TEST_PG_ADMIN_URL, '-Atc', sql], { encoding: 'utf8' });
  for (const name of (list.stdout ?? '')
    .split('\n')
    .filter((line) => /^safezone_test_[0-9a-f]{16}$/.test(line)))
    spawnSync(
      'psql',
      [env.TEST_PG_ADMIN_URL, '-c', `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`],
      {
        stdio: 'ignore',
      },
    );
}

sweep();
const result = spawnSync(
  'pnpm',
  ['exec', 'vitest', 'run', '--config', 'vitest.integration.config.ts', ...process.argv.slice(2)],
  { cwd: root, env, stdio: 'inherit' },
);
sweep();
process.exit(result.status ?? 1);
