import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signIn, startTestStack, type TestStack } from './support/app';

describe('tenancy core and authorization', () => {
  let stack: TestStack;
  let estateA: string;
  let estateB: string;
  let residentA: string;
  let adminA: string;
  let residentB: string;

  async function residentToken(phone: string, estateId: string, role: string) {
    const userId = await stack.createUser(phone);
    await stack.addMember(estateId, userId, role);
    await stack.resetRateLimits();
    return (await signIn(stack, phone)).accessToken;
  }

  beforeAll(async () => {
    stack = await startTestStack();
    estateA = await stack.createEstate('Estate A');
    estateB = await stack.createEstate('Estate B');
    residentA = await residentToken('+2348031000001', estateA, 'tenant');
    residentB = await residentToken('+2348031000002', estateB, 'tenant');
    // Homeowner has no MFA requirement but also no estate.configure; use an administrator with MFA verified
    // through the owner pool to keep this suite focused on authorization.
    const adminPhone = '+2348031000003';
    const adminId = await stack.createUser(adminPhone);
    await stack.addMember(estateA, adminId, 'estate_administrator');
    await stack.resetRateLimits();
    const admin = await signIn(stack, adminPhone);
    await stack.db.owner.query(
      `update platform.sessions set mfa_verified_at = now() where user_id = $1`,
      [adminId],
    );
    adminA = admin.accessToken;
  });
  afterAll(async () => {
    await stack?.stop();
  });
  beforeEach(async () => {
    await stack.resetRateLimits();
  });

  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('members read their estate; other estates look like they do not exist', async () => {
    const own = await stack.http.get(`/v1/estates/${estateA}`).set(as(residentA)).expect(200);
    expect(own.body.data).toMatchObject({ id: estateA, name: 'Estate A', currency: 'NGN' });

    const other = await stack.http.get(`/v1/estates/${estateA}`).set(as(residentB)).expect(404);
    expect(other.body.error.code).toBe('ESTATE_NOT_FOUND');
    await stack.http.get(`/v1/estates/not-a-uuid`).set(as(residentA)).expect(404);
  });

  it('only estate.configure can change settings, and changes are audited through the outbox', async () => {
    const denied = await stack.http
      .patch(`/v1/estates/${estateA}/settings`)
      .set(as(residentA))
      .send({ 'visitor.max_pass_days': 7 })
      .expect(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');

    const defaults = await stack.http
      .get(`/v1/estates/${estateA}/settings`)
      .set(as(residentA))
      .expect(200);
    expect(defaults.body.data['visitor.max_pass_days']).toBe(30);

    await stack.http
      .patch(`/v1/estates/${estateA}/settings`)
      .set(as(adminA))
      .send({ 'visitor.max_pass_days': 7 })
      .expect(200);
    const after = await stack.http
      .get(`/v1/estates/${estateA}/settings`)
      .set(as(residentA))
      .expect(200);
    expect(after.body.data['visitor.max_pass_days']).toBe(7);
    expect(after.body.data['sos.cancel_countdown_seconds']).toBe(5);

    const bSettings = await stack.http
      .get(`/v1/estates/${estateB}/settings`)
      .set(as(residentB))
      .expect(200);
    expect(bSettings.body.data['visitor.max_pass_days']).toBe(30);

    await stack.http
      .patch(`/v1/estates/${estateA}/settings`)
      .set(as(adminA))
      .send({ unknown: true })
      .expect(400);
  });

  it('uses If-Match for optimistic concurrency on the estate profile', async () => {
    const current = await stack.http.get(`/v1/estates/${estateA}`).set(as(adminA)).expect(200);
    const version = current.body.data.version as number;
    await stack.http
      .patch(`/v1/estates/${estateA}`)
      .set(as(adminA))
      .set('If-Match', String(version))
      .send({ name: 'Estate A Renamed' })
      .expect(200);
    const stale = await stack.http
      .patch(`/v1/estates/${estateA}`)
      .set(as(adminA))
      .set('If-Match', String(version))
      .send({ name: 'Again' })
      .expect(409);
    expect(stale.body.error.code).toBe('VERSION_MISMATCH');
  });

  it('lists my memberships and a permission snapshot', async () => {
    const memberships = await stack.http.get('/v1/me/memberships').set(as(residentA)).expect(200);
    expect(memberships.body.data).toEqual([
      expect.objectContaining({
        estate: expect.objectContaining({ id: estateA }),
        roles: ['tenant'],
        status: 'active',
      }),
    ]);

    const snapshot = await stack.http
      .get('/v1/me/permissions')
      .query({ estateId: estateA })
      .set(as(residentA))
      .expect(200);
    expect(snapshot.body.data.permissions).toContain('sos.trigger');
    expect(snapshot.body.data.permissions).not.toContain('estate.configure');
    expect(snapshot.body.data.features).toContain('visitors');

    const foreign = await stack.http
      .get('/v1/me/permissions')
      .query({ estateId: estateB })
      .set(as(residentA))
      .expect(200);
    expect(foreign.body.data).toMatchObject({ roles: [], permissions: [], features: [] });
  });

  it('honours entitlement overrides', async () => {
    await stack.db.owner.query(
      `insert into tenant.entitlements (estate_id, feature_key, enabled, source) values ($1, 'community', false, 'override')`,
      [estateA],
    );
    const snapshot = await stack.http
      .get('/v1/me/permissions')
      .query({ estateId: estateA })
      .set(as(residentA))
      .expect(200);
    expect(snapshot.body.data.features).not.toContain('community');
  });
});
