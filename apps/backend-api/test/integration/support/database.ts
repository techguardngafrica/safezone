import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
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

/**
 * Host mode (no Docker): set TEST_PG_ADMIN_URL to a superuser connection on a local PostgreSQL. Each test
 * file gets a fresh `safezone_test_<random>` database that is dropped afterwards; no other database is
 * touched. The cluster-wide safezone_app role is reused as it is (never altered), so its password comes
 * from TEST_PG_APP_PASSWORD (empty for trust auth).
 */
const HOST_ADMIN_URL = process.env.TEST_PG_ADMIN_URL;
const TEST_DB_NAME = /^safezone_test_[0-9a-f]{16}$/;

interface Provisioned {
  ownerUrl: string;
  appPassword: string;
  /** Fresh cluster: enable login for safezone_app with the test password. */
  enableAppLogin: boolean;
  release(): Promise<void>;
}

async function provisionContainer(): Promise<Provisioned> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer('postgres:17-alpine')
    .withDatabase('safezone')
    .withUsername('safezone')
    .withPassword('safezone')
    .start();
  return {
    ownerUrl: container.getConnectionUri(),
    appPassword: APP_PASSWORD,
    enableAppLogin: true,
    release: async () => {
      await container.stop();
    },
  };
}

async function provisionHost(adminUrl: string): Promise<Provisioned> {
  const name = `safezone_test_${randomBytes(8).toString('hex')}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  const ownerUrl = new URL(adminUrl);
  ownerUrl.pathname = `/${name}`;
  return {
    ownerUrl: ownerUrl.toString(),
    appPassword: process.env.TEST_PG_APP_PASSWORD ?? '',
    enableAppLogin: false,
    release: async () => {
      if (!TEST_DB_NAME.test(name)) throw new Error(`refusing to drop ${name}`);
      const cleanup = new pg.Client({ connectionString: adminUrl });
      await cleanup.connect();
      try {
        await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      } finally {
        await cleanup.end();
      }
    },
  };
}

export async function startTestDatabase(): Promise<TestDatabase> {
  const provisioned = HOST_ADMIN_URL
    ? await provisionHost(HOST_ADMIN_URL)
    : await provisionContainer();
  const { ownerUrl } = provisioned;
  runPrisma(ownerUrl, ['migrate', 'deploy']);

  const owner = new pg.Pool({ connectionString: ownerUrl, max: 2 });
  if (provisioned.enableAppLogin)
    await owner.query(`ALTER ROLE safezone_app WITH LOGIN PASSWORD '${APP_PASSWORD}'`);

  const appUrlObject = new URL(ownerUrl);
  appUrlObject.username = 'safezone_app';
  appUrlObject.password = provisioned.appPassword;
  const appUrl = appUrlObject.toString();

  const clients: PrismaClient[] = [];
  const createAppClient = (options: { max?: number } = {}): PrismaClient => {
    const client = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: appUrl,
        max: options.max ?? 5,
        options: '-c TimeZone=UTC',
      }),
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
      await provisioned.release();
    },
  };
}
