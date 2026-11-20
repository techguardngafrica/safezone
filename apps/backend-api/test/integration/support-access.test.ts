import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { countRows, signIn, startTestStack, type TestStack, WEB_DEVICE } from './support/app';

/**
 * Support access (platform.md §4, management-web.md §6.13): a Techguard agent reaches an estate only
 * while an estate administrator's approval is active, read-only, with every request audited.
 */
describe('support-access sessions', () => {
  let stack: TestStack;
  let estateId: string;
  let otherEstateId: string;
  let admin: string;
  let agent: string;
  let agentId: string;
  let resident: string;
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function mfaSignIn(
    phone: string,
    userId: string,
    app: { app: string; platform: string; appVersion: string } = WEB_DEVICE,
  ) {
    await stack.resetRateLimits();
    const token = (await signIn(stack, phone, app)).accessToken;
    await stack.db.owner.query(
      `update platform.sessions set mfa_verified_at = now() where user_id = $1`,
      [userId],
    );
    return token;
  }

  async function requestSession(): Promise<string> {
    const response = await stack.http
      .post('/v1/platform/support-sessions')
      .set(as(agent))
      .send({ estateId, reason: 'Investigating a gate sync complaint' })
      .expect(201);
    expect(response.body.data).toMatchObject({ status: 'pending', durationMinutes: 120 });
    return response.body.data.id as string;
  }

  beforeAll(async () => {
    stack = await startTestStack();
    estateId = await stack.createEstate('Support Estate');
    otherEstateId = await stack.createEstate('Other Estate');
    const adminId = await stack.createUser('+2348037200001', 'Estate Admin');
    await stack.addMember(estateId, adminId, 'estate_administrator');
    admin = await mfaSignIn('+2348037200001', adminId);
    agentId = await stack.createUser('+2348037200002', 'Support Agent');
    await stack.assignPlatformRole(agentId, 'platform_support_agent');
    agent = await mfaSignIn('+2348037200002', agentId, {
      app: 'super-admin',
      platform: 'web',
      appVersion: '1.0.0',
    });
    const residentId = await stack.createUser('+2348037200003');
    await stack.addMember(estateId, residentId, 'tenant');
    await stack.resetRateLimits();
    resident = (await signIn(stack, '+2348037200003')).accessToken;
  }, 240_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('only platform support staff can request access, and only to a real estate', async () => {
    await stack.http
      .post('/v1/platform/support-sessions')
      .set(as(resident))
      .send({ estateId, reason: 'I would like to look around' })
      .expect(403);
    await stack.http
      .post('/v1/platform/support-sessions')
      .set(as(agent))
      .send({ estateId: '0195a000-0000-7000-8000-00000000dead', reason: 'Investigating something' })
      .expect(404);
  });

  it('without an approved session the estate stays invisible to the agent', async () => {
    await requestSession();
    await stack.http.get(`/v1/estates/${estateId}/households`).set(as(agent)).expect(404);
  });

  it('only estate administrators decide; residents cannot', async () => {
    const id = await requestSession();
    await stack.http
      .post(`/v1/estates/${estateId}/support-sessions/${id}/approve`)
      .set(as(resident))
      .send({})
      .expect(403);
    // Another estate's routes never see this estate's sessions.
    await stack.http
      .post(`/v1/estates/${otherEstateId}/support-sessions/${id}/approve`)
      .set(as(admin))
      .send({})
      .expect(404);
  });

  it('an approved session admits reads only, audits each one, and revocation ends it', async () => {
    const id = await requestSession();
    const [first, second] = await Promise.all([
      stack.http
        .post(`/v1/estates/${estateId}/support-sessions/${id}/approve`)
        .set(as(admin))
        .send({ durationMinutes: 30 }),
      stack.http
        .post(`/v1/estates/${estateId}/support-sessions/${id}/approve`)
        .set(as(admin))
        .send({ durationMinutes: 30 }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);

    await stack.http.get(`/v1/estates/${estateId}/households`).set(as(agent)).expect(200);
    await stack.http.get(`/v1/estates/${estateId}/audit-events`).set(as(agent)).expect(200);
    const write = await stack.http
      .post(`/v1/estates/${estateId}/spaces`)
      .set(as(agent))
      .send({ type: 'unit', code: 'X-1' })
      .expect(403);
    expect(write.body.error.code).toBe('SUPPORT_SESSION_READ_ONLY');
    // Configuration screens stay closed: estate.configure is outside the support ceiling.
    await stack.http.get(`/v1/estates/${estateId}/support-sessions`).set(as(agent)).expect(403);
    // Other estates stay invisible.
    await stack.http.get(`/v1/estates/${otherEstateId}/households`).set(as(agent)).expect(404);

    expect(
      await countRows(
        stack.db.owner,
        `select count(*) from platform.outbox_events
          where type = 'platform.support_session.accessed' and aggregate_id = $1`,
        [id],
      ),
    ).toBeGreaterThanOrEqual(2);

    await stack.http
      .post(`/v1/estates/${estateId}/support-sessions/${id}/revoke`)
      .set(as(admin))
      .send({ reason: 'Done' })
      .expect(200);
    await stack.http.get(`/v1/estates/${estateId}/households`).set(as(agent)).expect(404);
  });

  it('an expired session no longer admits the agent and is marked expired', async () => {
    const id = await requestSession();
    await stack.http
      .post(`/v1/estates/${estateId}/support-sessions/${id}/approve`)
      .set(as(admin))
      .send({})
      .expect(200);
    await stack.db.owner.query(
      `update tenant.support_sessions set expires_at = now() - interval '1 minute' where id = $1`,
      [id],
    );
    await stack.http.get(`/v1/estates/${estateId}/households`).set(as(agent)).expect(404);
    const list = await stack.http
      .get(`/v1/estates/${estateId}/support-sessions`)
      .set(as(admin))
      .expect(200);
    expect(list.body.data.find((row: { id: string }) => row.id === id)?.status).toBe('expired');
  });
});
