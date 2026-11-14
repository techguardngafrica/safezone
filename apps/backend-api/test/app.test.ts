import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { compareVersions } from '../src/common/app-config/compare-versions';
import { DatabaseService } from '../src/common/database/database.service';
import { RedisService } from '../src/common/redis/redis.module';
import { FeatureFlagsService } from '../src/modules/platform/feature-flags.service';

describe('backend-api http core', () => {
  let app: INestApplication;
  let databaseReady = true;

  beforeAll(async () => {
    process.env.APP_MIN_VERSION = '1.2.0';
    process.env.APP_RECOMMENDED_VERSION = '1.4.0';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService)
      .useValue({ isReady: async () => databaseReady })
      .overrideProvider(FeatureFlagsService)
      .useValue({
        appConfig: async (_app: string, _platform: string, version: string) => {
          const [major, minor] = version.split('.').map(Number);
          const v = (major ?? 0) * 100 + (minor ?? 0);
          return {
            minVersion: '1.2.0',
            recommendedVersion: '1.4.0',
            update: v < 102 ? 'hard' : v < 104 ? 'soft' : 'none',
            message: null,
            flags: {},
          };
        },
      })
      .overrideProvider(RedisService)
      .useValue({ isReady: async () => true, client: {} })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('wraps success in the envelope and sets a request id', async () => {
    const response = await request(app.getHttpServer()).get('/health/live').expect(200);
    expect(response.body).toEqual({ success: true, data: { status: 'ok' } });
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('keeps a well-formed incoming request id', async () => {
    const response = await request(app.getHttpServer())
      .get('/health/live')
      .set('X-Request-Id', 'client-req-12345')
      .expect(200);
    expect(response.headers['x-request-id']).toBe('client-req-12345');
  });

  it('reports readiness and 503 when the database is down', async () => {
    await request(app.getHttpServer()).get('/health/ready').expect(200);
    databaseReady = false;
    const response = await request(app.getHttpServer()).get('/health/ready').expect(503);
    expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
    databaseReady = true;
  });

  it('GET /v1/public/app-config asks old apps to update', async () => {
    const hard = await request(app.getHttpServer())
      .get('/v1/public/app-config')
      .query({ app: 'resident-mobile', platform: 'android', version: '1.1.9' })
      .expect(200);
    expect(hard.body.data.update).toBe('hard');

    const soft = await request(app.getHttpServer())
      .get('/v1/public/app-config')
      .query({ app: 'resident-mobile', platform: 'android', version: '1.3.0' })
      .expect(200);
    expect(soft.body.data.update).toBe('soft');
  });

  it('returns validation errors in the error envelope with field details', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/public/app-config')
      .query({ app: 'resident-mobile' })
      .expect(400);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_FAILED', statusCode: 400 },
    });
    const paths = (response.body.error.details as { path: string }[]).map((d) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['query.platform', 'query.version']));
    expect(response.body.error.requestId).toBeTypeOf('string');
  });

  it('returns a generic 404 for unknown routes without echoing the path', async () => {
    const response = await request(app.getHttpServer()).get('/v1/nope/secret-path').expect(404);
    expect(response.body.error).toMatchObject({ code: 'NOT_FOUND', message: 'Not found' });
    expect(JSON.stringify(response.body)).not.toContain('secret-path');
  });
});

describe('compareVersions', () => {
  it('orders semantic versions', () => {
    expect(compareVersions('1.2.0', '1.10.0')).toBe(-1);
    expect(compareVersions('2.0.0', '1.99.99')).toBe(1);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });
});
