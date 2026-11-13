import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { compareVersions } from '../src/common/app-config/compare-versions';
import { ProblemDetailsFilter } from '../src/common/errors/problem-details.filter';

describe('backend-api', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.APP_MIN_VERSION = '1.2.0';
    process.env.APP_RECOMMENDED_VERSION = '1.4.0';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health/live is ok', async () => {
    const response = await request(app.getHttpServer()).get('/health/live').expect(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('GET /v1/public/app-config asks old apps to update', async () => {
    const hard = await request(app.getHttpServer())
      .get('/v1/public/app-config')
      .query({ app: 'resident-mobile', platform: 'android', version: '1.1.9' })
      .expect(200);
    expect(hard.body.update).toBe('hard');

    const soft = await request(app.getHttpServer())
      .get('/v1/public/app-config')
      .query({ app: 'resident-mobile', platform: 'android', version: '1.3.0' })
      .expect(200);
    expect(soft.body.update).toBe('soft');
  });

  it('returns problem+json errors', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/public/app-config')
      .query({ app: 'resident-mobile' })
      .expect(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body.code).toBe('BAD_REQUEST');
  });
});

describe('compareVersions', () => {
  it('orders semantic versions', () => {
    expect(compareVersions('1.2.0', '1.10.0')).toBe(-1);
    expect(compareVersions('2.0.0', '1.99.99')).toBe(1);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });
});
