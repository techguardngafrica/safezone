import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signIn, startTestStack, type TestStack } from './support/app';

describe('feature flags and app versions', () => {
  let stack: TestStack;
  let adminToken: string;
  let residentToken: string;
  let estateId: string;

  beforeAll(async () => {
    stack = await startTestStack();
    const adminId = await stack.createUser('+2348035000001', 'Platform Admin');
    await stack.assignPlatformRole(adminId, 'platform_administrator');
    adminToken = (
      await signIn(stack, '+2348035000001', {
        app: 'super-admin',
        platform: 'web',
        appVersion: '1.0.0',
      })
    ).accessToken;
    await stack.db.owner.query(
      `update platform.sessions set mfa_verified_at = now() where user_id = $1`,
      [adminId],
    );

    estateId = await stack.createEstate();
    const residentId = await stack.createUser('+2348035000002');
    await stack.addMember(estateId, residentId, 'tenant');
    await stack.resetRateLimits();
    residentToken = (await signIn(stack, '+2348035000002')).accessToken;
  });
  afterAll(async () => {
    await stack?.stop();
  });

  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('only platform.config holders can change flags', async () => {
    const body = {
      description: 'New gate screen',
      defaultEnabled: false,
      rules: { estateIds: [estateId] },
      isPublic: false,
    };
    await stack.http
      .put('/v1/platform/feature-flags/new_gate_screen')
      .set(as(residentToken))
      .send(body)
      .expect(403);
    const saved = await stack.http
      .put('/v1/platform/feature-flags/new_gate_screen')
      .set(as(adminToken))
      .send(body)
      .expect(200);
    expect(saved.body.data).toMatchObject({
      key: 'new_gate_screen',
      rules: { estateIds: [estateId] },
    });

    await stack.http
      .put('/v1/platform/feature-flags/Bad-Key')
      .set(as(adminToken))
      .send(body)
      .expect(400);
    await stack.http
      .put('/v1/platform/feature-flags/x_flag')
      .set(as(adminToken))
      .send({ ...body, rules: { percent: 150 } })
      .expect(400);
  });

  it('evaluates flags for the signed-in user and their estate', async () => {
    const mine = await stack.http
      .get('/v1/me/feature-flags')
      .query({ estateId })
      .set(as(residentToken))
      .expect(200);
    expect(mine.body.data.new_gate_screen).toBe(true);
    const noEstate = await stack.http
      .get('/v1/me/feature-flags')
      .set(as(residentToken))
      .expect(200);
    expect(noEstate.body.data.new_gate_screen).toBe(false);
  });

  it('serves version policy and public flags before sign-in', async () => {
    await stack.http
      .put('/v1/platform/feature-flags/maintenance_banner')
      .set(as(adminToken))
      .send({
        description: 'Show maintenance banner',
        defaultEnabled: true,
        rules: {},
        isPublic: true,
      })
      .expect(200);
    await stack.http
      .put('/v1/platform/app-versions/resident-mobile/android')
      .set(as(adminToken))
      .send({
        minVersion: '1.2.0',
        recommendedVersion: '1.4.0',
        message: 'Update for faster gate passes',
      })
      .expect(200);
    await stack.http
      .put('/v1/platform/app-versions/resident-mobile/android')
      .set(as(adminToken))
      .send({ minVersion: '2.0.0', recommendedVersion: '1.0.0' })
      .expect(400);

    const old = await stack.http
      .get('/v1/public/app-config')
      .query({ app: 'resident-mobile', platform: 'android', version: '1.1.0' })
      .expect(200);
    expect(old.body.data).toMatchObject({
      update: 'hard',
      message: 'Update for faster gate passes',
    });
    expect(old.body.data.flags).toEqual({ maintenance_banner: true });

    const ios = await stack.http
      .get('/v1/public/app-config')
      .query({ app: 'resident-mobile', platform: 'ios', version: '1.1.0' })
      .expect(200);
    expect(ios.body.data.update).toBe('none');
  });
});
