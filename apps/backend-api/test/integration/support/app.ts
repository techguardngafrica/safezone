import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Redis } from 'ioredis';
import pg from 'pg';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { uuidv7 } from '../../../src/common/ids/uuidv7';
import { generateEstateCode } from '../../../src/modules/tenancy/domain/codes';
import { EmailSender, FakeEmailSender } from '../../../src/integrations/email/email-sender';
import { FakeSmsSender } from '../../../src/integrations/sms/fake-sms.sender';
import { SmsSender } from '../../../src/integrations/sms/sms-sender';
import {
  MemoryObjectStorage,
  ObjectStorage,
} from '../../../src/integrations/storage/object-storage';
import { builtInRoleId, seedBuiltInRoles } from '../../../src/scripts/seed-roles';
import { startTestDatabase, type TestDatabase } from './database';

/**
 * Host mode (no Docker): TEST_REDIS_URL points at a local Redis with a dedicated database index (not 0),
 * e.g. redis://127.0.0.1:6379/15. Only that index is flushed, so dev data in index 0 is never touched.
 */
async function startTestRedis(): Promise<{ url: string; release(): Promise<void> }> {
  const hostUrl = process.env.TEST_REDIS_URL;
  if (hostUrl) {
    const index = Number(new URL(hostUrl).pathname.replace('/', '') || '0');
    if (!Number.isInteger(index) || index === 0)
      throw new Error('TEST_REDIS_URL must name a Redis database index other than 0');
    const client = new Redis(hostUrl);
    await client.flushdb();
    client.disconnect();
    return { url: hostUrl, release: async () => undefined };
  }
  const container = (await new RedisContainer('redis:7-alpine').start()) as StartedRedisContainer;
  return { url: container.getConnectionUrl(), release: async () => void (await container.stop()) };
}

/**
 * Full API against real PostgreSQL 17 and Redis 7 (Testcontainers). SMS and email are fakes so tests
 * can read OTP codes. Each test file gets its own stack.
 */
export interface TestStack {
  db: TestDatabase;
  app: INestApplication;
  http: ReturnType<typeof request>;
  sms: FakeSmsSender;
  email: FakeEmailSender;
  redis: Redis;
  /** Clears rate limits between tests. */
  resetRateLimits(): Promise<void>;
  createEstate(name?: string): Promise<string>;
  createUser(phone: string, fullName?: string): Promise<string>;
  addMember(estateId: string, userId: string, roleKey: string): Promise<void>;
  assignPlatformRole(userId: string, roleKey: string): Promise<void>;
  stop(): Promise<void>;
}

export async function startTestStack(
  options: { env?: Record<string, string>; realStorage?: boolean } = {},
): Promise<TestStack> {
  const [db, redisTarget] = await Promise.all([startTestDatabase(), startTestRedis()]);
  try {
    return await buildStack(db, redisTarget, options);
  } catch (error) {
    // A failed start must not leave a database or Redis data behind.
    await redisTarget.release().catch(() => undefined);
    await db.stop().catch(() => undefined);
    throw error;
  }
}

async function buildStack(
  db: TestDatabase,
  redisTarget: { url: string; release(): Promise<void> },
  options: { env?: Record<string, string>; realStorage?: boolean },
): Promise<TestStack> {
  const redisUrl = redisTarget.url;
  const owner = await db.owner.connect();
  try {
    await seedBuiltInRoles(owner);
  } finally {
    owner.release();
  }

  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = db.appUrl;
  process.env.REDIS_URL = redisUrl;
  process.env.CORS_ORIGINS = 'http://localhost:3001';
  for (const [key, value] of Object.entries(options.env ?? {})) process.env[key] = value;

  const sms = new FakeSmsSender();
  const email = new FakeEmailSender();
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SmsSender)
    .useValue(sms)
    .overrideProvider(EmailSender)
    .useValue(email);
  if (!options.realStorage) {
    builder = builder.overrideProvider(ObjectStorage).useValue(new MemoryObjectStorage());
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  await app.init();
  const redis = new Redis(redisUrl);
  const ownerQuery = (sql: string, values: unknown[]) => db.owner.query(sql, values);

  return {
    db,
    app,
    http: request(app.getHttpServer()),
    sms,
    email,
    redis,
    async resetRateLimits() {
      await redis.flushdb();
    },
    async createEstate(name = 'Test Estate') {
      const id = uuidv7();
      await ownerQuery(
        `insert into platform.estates (id, name, slug, code, type, status, onboarding_mode, activated_at, updated_at)
         values ($1, $2, $3, $4, 'gated_houses', 'active', 'assisted', now(), now())`,
        [id, name, `estate-${id}`, generateEstateCode()],
      );
      return id;
    },
    async createUser(phone, fullName = 'Test User') {
      const id = uuidv7();
      await ownerQuery(
        `insert into platform.users (id, phone_e164, phone_verified_at, full_name, updated_at)
         values ($1, $2, now(), $3, now())`,
        [id, phone, fullName],
      );
      return id;
    },
    async addMember(estateId, userId, roleKey) {
      await ownerQuery(
        `insert into tenant.estate_memberships (id, estate_id, user_id, status) values ($1, $2, $3, 'active')
         on conflict (estate_id, user_id) do nothing`,
        [uuidv7(), estateId, userId],
      );
      await ownerQuery(
        `insert into platform.role_assignments (id, user_id, role_id, estate_id) values ($1, $2, $3, $4)`,
        [uuidv7(), userId, builtInRoleId(roleKey), estateId],
      );
    },
    async assignPlatformRole(userId, roleKey) {
      await ownerQuery(
        `insert into platform.role_assignments (id, user_id, role_id, estate_id) values ($1, $2, $3, null)`,
        [uuidv7(), userId, builtInRoleId(roleKey)],
      );
    },
    async stop() {
      await app.close();
      redis.disconnect();
      await redisTarget.release();
      await db.stop();
    },
  };
}

export const MOBILE_DEVICE = {
  app: 'resident-mobile',
  platform: 'android',
  appVersion: '1.0.0',
} as const;
export const WEB_DEVICE = { app: 'management-web', platform: 'web', appVersion: '1.0.0' } as const;

/** Signs in through the real OTP flow and returns the response body's data. */
export async function signIn(
  stack: TestStack,
  phone: string,
  device: { app: string; platform: string; appVersion: string } = MOBILE_DEVICE,
) {
  await stack.http.post('/v1/auth/otp/request').send({ phone }).expect(200);
  const code = /\b(\d{6})\b/.exec(stack.sms.lastTo(phone)?.body ?? '')?.[1];
  if (!code) throw new Error('no OTP captured');
  const response = await stack.http
    .post('/v1/auth/otp/verify')
    .send({ phone, code, device })
    .expect(200);
  return response.body.data as {
    accessToken: string;
    refreshToken?: string;
    mfaRequired: boolean;
    mfaEnrolled: boolean;
    isNewUser: boolean;
    user: { id: string };
  };
}

/** Pool helper: count rows as the owner (bypasses RLS; assertions only). */
export async function countRows(
  owner: pg.Pool,
  sql: string,
  values: unknown[] = [],
): Promise<number> {
  const result = await owner.query<{ count: string }>(sql, values);
  return Number(result.rows[0]?.count ?? 0);
}
