import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Redis } from 'ioredis';
import pg from 'pg';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { uuidv7 } from '../../../src/common/ids/uuidv7';
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
  const [db, redisContainer] = await Promise.all([
    startTestDatabase(),
    new RedisContainer('redis:7-alpine').start() as Promise<StartedRedisContainer>,
  ]);
  const owner = await db.owner.connect();
  try {
    await seedBuiltInRoles(owner);
  } finally {
    owner.release();
  }

  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = db.appUrl;
  process.env.REDIS_URL = redisContainer.getConnectionUrl();
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
  const app = moduleRef.createNestApplication();
  await app.init();
  const redis = new Redis(redisContainer.getConnectionUrl());
  const ownerQuery = (sql: string, values: unknown[]) => db.owner.query(sql, values);

  return {
    db,
    app,
    http: request(app.getHttpServer()),
    sms,
    email,
    redis,
    async resetRateLimits() {
      await redis.flushall();
    },
    async createEstate(name = 'Test Estate') {
      const id = uuidv7();
      await ownerQuery(
        `insert into platform.estates (id, name, slug, code, type, status, onboarding_mode, updated_at)
         values ($1, $2, $3, $4, 'gated_houses', 'active', 'assisted', now())`,
        [id, name, `estate-${id}`, id.slice(-6).toUpperCase()],
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
      await redisContainer.stop();
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
