import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import pg from 'pg';
import { E2E, type StackState } from './config';
import { assertTestRedis, redisCommands } from './redis';

/**
 * Starts the whole stack for the e2e flows on the host (no Docker):
 *   1. builds the backend and a production build of public-web pointed at the e2e ports,
 *   2. creates a throwaway `safezone_e2e_<random>` database, applies the real migrations and seeds the
 *      built-in roles,
 *   3. starts the API and worker processes, then `next start` (the portal does not use realtime).
 * Returns the teardown, which stops every process and drops the database. Nothing else on the host
 * database server is touched: the user's `safezone` database is never opened.
 *
 * Connection details come from apps/backend-api/.env unless set: E2E_PG_ADMIN_URL (superuser URL),
 * E2E_PG_APP_PASSWORD (safezone_app password), E2E_REDIS_URL (a database index other than 0; default 14).
 * E2E_SKIP_BUILD=1 reuses the previous builds.
 */

function readEnvFile(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  const values: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match?.[1] && match[2] !== undefined)
      values[match[1]] = match[2].replace(/\s+#.*$/, '').replace(/^['"]|['"]$/g, '');
  }
  return values;
}

function connectionDetails() {
  const dotenv = readEnvFile(path.join(E2E.backendRoot, '.env'));
  const source = { ...dotenv, ...process.env };
  let adminUrl = source.E2E_PG_ADMIN_URL;
  if (!adminUrl) {
    if (!source.DATABASE_MIGRATION_URL)
      throw new Error('Set E2E_PG_ADMIN_URL or DATABASE_MIGRATION_URL in apps/backend-api/.env');
    const admin = new URL(source.DATABASE_MIGRATION_URL);
    admin.pathname = '/postgres';
    adminUrl = admin.toString();
  }
  const appPassword =
    source.E2E_PG_APP_PASSWORD ??
    (source.DATABASE_URL ? decodeURIComponent(new URL(source.DATABASE_URL).password) : '');
  let redisUrl = source.E2E_REDIS_URL;
  if (!redisUrl) {
    const redis = new URL(source.REDIS_URL ?? 'redis://127.0.0.1:6379');
    redis.pathname = '/14';
    redisUrl = redis.toString();
  }
  assertTestRedis(redisUrl);
  return { adminUrl, appPassword, redisUrl };
}

async function withAdmin<T>(adminUrl: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Drops databases left by a crashed run. Only names this harness creates are touched. */
async function sweep(adminUrl: string): Promise<void> {
  await withAdmin(adminUrl, async (client) => {
    const { rows } = await client.query<{ datname: string }>(
      "select datname from pg_database where datname ~ '^safezone_e2e_pw_[0-9a-f]{16}$'",
    );
    for (const { datname } of rows) {
      if (E2E.databasePattern.test(datname))
        await client.query(`DROP DATABASE IF EXISTS ${datname} WITH (FORCE)`);
    }
  });
}

function run(label: string, command: string, args: string[], cwd: string, env = process.env) {
  const started = Date.now();
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', stdio: 'pipe' });
  writeFileSync(
    path.join(E2E.logDir, `${label}.log`),
    `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
  );
  if (result.status !== 0)
    throw new Error(`${label} failed (exit ${result.status}); see e2e/.run/logs/${label}.log`);
  process.stdout.write(`[e2e] ${label} done in ${Math.round((Date.now() - started) / 1000)} s\n`);
}

async function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, () => server.close(() => resolve(true)));
  });
}

async function waitForHttp(url: string, child: ChildProcess, label: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(
        `${label} exited early (code ${child.exitCode}); see e2e/.run/logs/${label}.log`,
      );
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} did not answer ${url} within ${timeoutMs / 1000} s`);
}

function start(
  label: string,
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
) {
  const log = createWriteStream(path.join(E2E.logDir, `${label}.log`));
  // Own process group, so the teardown can stop `next start` and anything it forks.
  const child = spawn(command, args, {
    cwd,
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  return child;
}

function stop(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.pid === undefined) return resolve();
    const timer = setTimeout(() => {
      try {
        process.kill(-(child.pid as number), 'SIGKILL');
      } catch {
        // Already gone.
      }
    }, 10_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      process.kill(-(child.pid as number), 'SIGTERM');
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const { adminUrl, appPassword, redisUrl } = connectionDetails();
  rmSync(E2E.outboxDir, { recursive: true, force: true });
  rmSync(E2E.storageDir, { recursive: true, force: true });
  for (const dir of [E2E.runDir, E2E.logDir, E2E.outboxDir, E2E.storageDir])
    mkdirSync(dir, { recursive: true });

  for (const port of [E2E.apiPort, E2E.webPort]) {
    if (!(await portFree(port)))
      throw new Error(`Port ${port} is in use. Stop the process using it (an earlier e2e run?).`);
  }

  if (process.env.E2E_SKIP_BUILD !== '1') {
    run('build-backend', 'pnpm', ['--filter', '@safezone/backend-api', 'build'], E2E.repoRoot);
    run('build-web', 'pnpm', ['exec', 'next', 'build'], E2E.webRoot, {
      ...process.env,
      NEXT_DIST_DIR: E2E.nextDistDir,
      NEXT_PUBLIC_API_URL: E2E.apiUrl,
      NEXT_TELEMETRY_DISABLED: '1',
    });
  }

  await sweep(adminUrl);
  const databaseName = `safezone_e2e_pw_${randomBytes(8).toString('hex')}`;
  await withAdmin(adminUrl, (client) => client.query(`CREATE DATABASE ${databaseName}`));
  const owner = new URL(adminUrl);
  owner.pathname = `/${databaseName}`;
  const ownerUrl = owner.toString();
  const app = new URL(ownerUrl);
  app.username = 'safezone_app';
  app.password = appPassword;

  const processes: ChildProcess[] = [];
  const teardown = async () => {
    await Promise.all(processes.map(stop));
    await withAdmin(adminUrl, async (client) => {
      if (E2E.databasePattern.test(databaseName))
        await client.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    }).catch((error: unknown) => console.warn('[e2e] could not drop the test database', error));
  };

  try {
    const prismaCli = createRequire(path.join(E2E.backendRoot, 'package.json')).resolve(
      'prisma/build/index.js',
    );
    run('migrate', process.execPath, [prismaCli, 'migrate', 'deploy'], E2E.backendRoot, {
      ...process.env,
      DATABASE_MIGRATION_URL: ownerUrl,
    });
    // Seeds the built-in roles with the backend's own script. Runs from the run folder, so the
    // developer's apps/backend-api/.env is never loaded.
    run(
      'seed-roles',
      process.execPath,
      [path.join(E2E.backendRoot, 'dist/scripts/seed.js')],
      E2E.runDir,
      {
        PATH: process.env.PATH,
        NODE_ENV: 'development',
        DATABASE_MIGRATION_URL: ownerUrl,
      },
    );
    await redisCommands(redisUrl, [['FLUSHDB']]);

    // Everything the backend reads is set here; the processes run from the run folder, so
    // apps/backend-api/.env (which points at the real local database) is never loaded.
    const backendEnv: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: 'development',
      LOG_LEVEL: 'warn',
      API_PORT: String(E2E.apiPort),
      REALTIME_PORT: String(E2E.realtimePort),
      API_PUBLIC_URL: E2E.apiUrl,
      CORS_ORIGINS: E2E.webUrl,
      MANAGEMENT_WEB_URL: 'http://localhost:3001',
      PUBLIC_WEB_URL: E2E.webUrl,
      DATABASE_URL: app.toString(),
      DATABASE_POOL_MAX: '5',
      REDIS_URL: redisUrl,
      MAIL_TRANSPORT: 'file',
      DEV_OUTBOX_DIR: E2E.outboxDir,
      STORAGE_DRIVER: 'local',
      DEV_STORAGE_DIR: E2E.storageDir,
      SMS_PROVIDER: 'fake',
      PAYMENTS_PROVIDER: 'fake',
      ...E2E.secrets,
    };
    const dist = (file: string) => path.join(E2E.backendRoot, 'dist', file);
    const api = start('api', process.execPath, [dist('main.js')], E2E.runDir, backendEnv);
    processes.push(api);
    const worker = start('worker', process.execPath, [dist('worker.js')], E2E.runDir, {
      ...backendEnv,
      APP_PROCESS: 'worker',
    });
    processes.push(worker);
    const web = start(
      'web',
      'pnpm',
      ['exec', 'next', 'start', '--port', String(E2E.webPort)],
      E2E.webRoot,
      { ...process.env, NEXT_DIST_DIR: E2E.nextDistDir, NEXT_TELEMETRY_DISABLED: '1' },
    );
    processes.push(web);

    await waitForHttp(`${E2E.apiUrl}/health/ready`, api, 'api', 120_000);
    await waitForHttp(E2E.webUrl, web, 'web', 120_000);
    if (worker.exitCode !== null)
      throw new Error('worker exited early; see e2e/.run/logs/worker.log');

    const state: StackState = { ownerUrl, redisUrl, databaseName };
    writeFileSync(E2E.stateFile, JSON.stringify(state), { mode: 0o600 });
    process.stdout.write(`[e2e] stack ready on ${E2E.webUrl} (database ${databaseName})\n`);
  } catch (error) {
    await teardown();
    throw error;
  }
  return teardown;
}
