import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '../../../src/generated/prisma/client';

/**
 * RLS test harness (Phase 0 task 2).
 *
 * Starts PostgreSQL 17, applies the real migrations as the schema owner, enables login for safezone_app
 * and returns clients for both roles. Tests must use `app` for anything that asserts isolation:
 * the owner is a superuser here and bypasses RLS.
 */
export interface TestDatabase {
  /** Prisma client connected as safezone_app (RLS enforced). */
  app: PrismaClient;
  /** Raw pool connected as the owner, for setup and catalogue checks only. */
  owner: pg.Pool;
  appUrl: string;
  ownerUrl: string;
  /** Builds another app-role client, e.g. with a single connection to test setting leaks. */
  createAppClient(options?: { max?: number }): PrismaClient;
  stop(): Promise<void>;
}

const APP_PASSWORD = 'safezone_app_test';
const backendRoot = path.resolve(__dirname, '../../..');

/** Runs the Prisma CLI against the given owner URL. Throws on a non-zero exit code. */
export function runPrisma(ownerUrl: string, args: readonly string[]): string {
  const require = createRequire(__filename);
  const prismaCli = require.resolve('prisma/build/index.js');
  return execFileSync(process.execPath, [prismaCli, ...args], {
    cwd: backendRoot,
    env: { ...process.env, DATABASE_MIGRATION_URL: ownerUrl },
    stdio: 'pipe',
    encoding: 'utf8',
  });
}

export async function startTestDatabase(): Promise<TestDatabase> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer('postgres:17-alpine')
    .withDatabase('safezone')
    .withUsername('safezone')
    .withPassword('safezone')
    .start();

  const ownerUrl = container.getConnectionUri();
  runPrisma(ownerUrl, ['migrate', 'deploy']);

  const owner = new pg.Pool({ connectionString: ownerUrl, max: 2 });
  await owner.query(`ALTER ROLE safezone_app WITH LOGIN PASSWORD '${APP_PASSWORD}'`);

  const appUrlObject = new URL(ownerUrl);
  appUrlObject.username = 'safezone_app';
  appUrlObject.password = APP_PASSWORD;
  const appUrl = appUrlObject.toString();

  const clients: PrismaClient[] = [];
  const createAppClient = (options: { max?: number } = {}): PrismaClient => {
    const client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: appUrl, max: options.max ?? 5 }),
    });
    clients.push(client);
    return client;
  };

  return {
    app: createAppClient(),
    owner,
    appUrl,
    ownerUrl,
    createAppClient,
    async stop() {
      await Promise.all(clients.map((client) => client.$disconnect()));
      await owner.end();
      await container.stop();
    },
  };
}
