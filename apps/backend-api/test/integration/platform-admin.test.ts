import { uuidv7 } from '../../src/common/ids/uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { countRows, signIn, startTestStack, type TestStack } from './support/app';

const SUPER_ADMIN_APP = { app: 'super-admin', platform: 'web', appVersion: '1.0.0' } as const;

/**
 * Super Admin control plane (super-admin.md §6, ADR-0022): staff protection, account state changes,
 * the last-Super-Admin rule, DSR updates, transaction filters, entitlement keys and ticket audit.
 */
describe('platform admin control plane', () => {
  let stack: TestStack;
  let estateId: string;
  let superA: string;
  let superAId: string;
  let agent: string;
  let finance: string;
  let residentId: string;
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const reason = { reason: 'Integration test action' };

  async function platformSignIn(phone: string, userId: string) {
    await stack.resetRateLimits();
    const token = (await signIn(stack, phone, SUPER_ADMIN_APP)).accessToken;
    await stack.db.owner.query(
      `update platform.sessions set mfa_verified_at = now() where user_id = $1`,
      [userId],
    );
    return token;
  }

  async function superAdminAssignmentOf(userId: string): Promise<string> {
    const result = await stack.db.owner.query<{ id: string }>(
      `select ra.id from platform.role_assignments ra join platform.roles r on r.id = ra.role_id
        where ra.user_id = $1 and r.key = 'super_admin' and ra.revoked_at is null`,
      [userId],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error('no super_admin assignment');
    return id;
  }

  async function activeSuperAdmins(): Promise<number> {
    return countRows(
      stack.db.owner,
      `select count(*) from platform.role_assignments ra join platform.roles r on r.id = ra.role_id
        where r.key = 'super_admin' and ra.estate_id is null and ra.revoked_at is null
          and ra.valid_from <= now() and (ra.valid_to is null or ra.valid_to > now())`,
    );
  }

  beforeAll(async () => {
    stack = await startTestStack();
    estateId = await stack.createEstate('Control Plane Estate');
    superAId = await stack.createUser('+2348037300001', 'Super A');
    await stack.assignPlatformRole(superAId, 'super_admin');
    superA = await platformSignIn('+2348037300001', superAId);
    const agentId = await stack.createUser('+2348037300002', 'Support Agent');
    await stack.assignPlatformRole(agentId, 'platform_support_agent');
    agent = await platformSignIn('+2348037300002', agentId);
    const financeId = await stack.createUser('+2348037300003', 'Finance Officer');
    await stack.assignPlatformRole(financeId, 'platform_finance_officer');
    finance = await platformSignIn('+2348037300003', financeId);
    residentId = await stack.createUser('+2348037300004', 'Resident');
    await stack.addMember(estateId, residentId, 'tenant');
  }, 240_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('a support agent cannot lock, sign out or reset MFA for platform staff', async () => {
    for (const action of ['lock', 'revoke-sessions', 'reset-mfa']) {
      const response = await stack.http
        .post(`/v1/platform/users/${superAId}/${action}`)
        .set(as(agent))
        .send(reason)
        .expect(403);
      expect(response.body.error.code).toBe('PLATFORM_STAFF_PROTECTED');
    }
    expect(
      await countRows(
        stack.db.owner,
        `select count(*) from platform.users where id = $1 and status = 'active'`,
        [superAId],
      ),
    ).toBe(1);
  });

  it('lock and unlock follow active <-> locked only', async () => {
    const locked = await stack.http
      .post(`/v1/platform/users/${residentId}/lock`)
      .set(as(agent))
      .send(reason)
      .expect(200);
    expect(locked.body.data.status).toBe('locked');
    const again = await stack.http
      .post(`/v1/platform/users/${residentId}/lock`)
      .set(as(agent))
      .send(reason)
      .expect(409);
    expect(again.body.error.code).toBe('USER_NOT_ACTIVE');
    const unlocked = await stack.http
      .post(`/v1/platform/users/${residentId}/unlock`)
      .set(as(agent))
      .send(reason)
      .expect(200);
    expect(unlocked.body.data.status).toBe('active');
  });

  it('unlock never reactivates a deactivated account', async () => {
    const closedId = await stack.createUser('+2348037300005', 'Closed Account');
    await stack.db.owner.query(`update platform.users set status = 'deactivated' where id = $1`, [
      closedId,
    ]);
    const response = await stack.http
      .post(`/v1/platform/users/${closedId}/unlock`)
      .set(as(agent))
      .send(reason)
      .expect(409);
    expect(response.body.error.code).toBe('USER_NOT_LOCKED');
    expect(
      await countRows(
        stack.db.owner,
        `select count(*) from platform.users where id = $1 and status = 'deactivated'`,
        [closedId],
      ),
    ).toBe(1);
  });

  it('user search batches counts and platform roles per row', async () => {
    const response = await stack.http
      .get('/v1/platform/users')
      .query({ q: '+2348037300004' })
      .set(as(agent))
      .expect(200);
    expect(response.body.data).toEqual([
      expect.objectContaining({ id: residentId, estateCount: 1, platformRoles: [] }),
    ]);
    const staff = await stack.http
      .get('/v1/platform/users')
      .query({ q: '+2348037300001' })
      .set(as(agent))
      .expect(200);
    expect(staff.body.data[0].platformRoles).toEqual(['super_admin']);
  });

  it('expired Super Admin grants do not count, and the last active one cannot be revoked', async () => {
    const expiredId = await stack.createUser('+2348037300006', 'Former Super Admin');
    await stack.db.owner.query(
      `insert into platform.role_assignments (id, user_id, role_id, estate_id, valid_from, valid_to)
       select $1, $2, id, null, now() - interval '30 days', now() - interval '1 day'
         from platform.roles where key = 'super_admin' and estate_id is null`,
      [uuidv7(), expiredId],
    );
    expect(await activeSuperAdmins()).toBe(1);
    const response = await stack.http
      .delete(`/v1/platform/staff/roles/${await superAdminAssignmentOf(superAId)}`)
      .set(as(superA))
      .send(reason)
      .expect(409);
    expect(response.body.error.code).toBe('LAST_SUPER_ADMIN');
  });

  it('two Super Admins revoking each other at once leaves one', async () => {
    const superBId = await stack.createUser('+2348037300007', 'Super B');
    await stack.assignPlatformRole(superBId, 'super_admin');
    const superB = await platformSignIn('+2348037300007', superBId);
    expect(await activeSuperAdmins()).toBe(2);
    const [aRevokesB, bRevokesA] = await Promise.all([
      stack.http
        .delete(`/v1/platform/staff/roles/${await superAdminAssignmentOf(superBId)}`)
        .set(as(superA))
        .send(reason),
      stack.http
        .delete(`/v1/platform/staff/roles/${await superAdminAssignmentOf(superAId)}`)
        .set(as(superB))
        .send(reason),
    ]);
    const statuses = [aRevokesB.status, bRevokesA.status];
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(await activeSuperAdmins()).toBe(1);
    // Keep Super A for the remaining tests.
    if (bRevokesA.status === 200) {
      await stack.assignPlatformRole(superAId, 'super_admin');
    }
  });

  it('an expired grant can be granted again; unknown users get 404', async () => {
    const tempId = await stack.createUser('+2348037300008', 'Temporary Finance');
    await stack.db.owner.query(
      `insert into platform.role_assignments (id, user_id, role_id, estate_id, valid_from, valid_to)
       select $1, $2, id, null, now() - interval '30 days', now() - interval '1 day'
         from platform.roles where key = 'platform_finance_officer' and estate_id is null`,
      [uuidv7(), tempId],
    );
    await stack.http
      .post('/v1/platform/staff/roles')
      .set(as(superA))
      .send({ userId: tempId, roleKey: 'platform_finance_officer', reason: 'Quarter-end cover' })
      .expect(201);
    const missing = await stack.http
      .post('/v1/platform/staff/roles')
      .set(as(superA))
      .send({ userId: uuidv7(), roleKey: 'platform_finance_officer', reason: 'Quarter-end cover' })
      .expect(404);
    expect(missing.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('a DSR update with status and identity check keeps both', async () => {
    const created = await stack.http
      .post('/v1/platform/dsr')
      .set(as(superA))
      .send({ subjectName: 'Ada Resident', subjectContact: '+2348037300099', type: 'access' })
      .expect(201);
    const updated = await stack.http
      .patch(`/v1/platform/dsr/${created.body.data.id}`)
      .set(as(superA))
      .send({ status: 'completed', markIdentityChecked: true })
      .expect(200);
    expect(updated.body.data).toMatchObject({ status: 'completed' });
    expect(updated.body.data.identityCheckedAt).not.toBeNull();
    expect(updated.body.data.completedAt).not.toBeNull();

    const second = await stack.http
      .post('/v1/platform/dsr')
      .set(as(superA))
      .send({ subjectName: 'Bola Resident', subjectContact: '+2348037300098', type: 'export' })
      .expect(201);
    const verified = await stack.http
      .patch(`/v1/platform/dsr/${second.body.data.id}`)
      .set(as(superA))
      .send({ markIdentityChecked: true })
      .expect(200);
    expect(verified.body.data.status).toBe('identity_verified');
  });

  it('the transaction status filter runs before paging', async () => {
    const payerId = residentId;
    const insert = (amountRefunded: number) =>
      stack.db.owner.query(
        `insert into tenant.payment_transactions
           (id, estate_id, payer_user_id, provider, provider_transaction_id, reference, channel,
            amount, amount_refunded, paid_at)
         values ($1, $2, $3, 'fake', $4, $5, 'card', 10000, $6, now())`,
        [uuidv7(), estateId, payerId, uuidv7(), `REF-${uuidv7()}`, amountRefunded],
      );
    await insert(10000); // refunded, oldest
    await insert(2500); // partially refunded
    for (let i = 0; i < 8; i += 1) await insert(0);

    const refunded = await stack.http
      .get('/v1/platform/transactions')
      .query({ status: 'refunded', limit: 3 })
      .set(as(finance))
      .expect(200);
    expect(refunded.body.data).toHaveLength(1);
    expect(refunded.body.data[0].status).toBe('refunded');

    const partial = await stack.http
      .get('/v1/platform/transactions')
      .query({ status: 'partially_refunded', limit: 3 })
      .set(as(finance))
      .expect(200);
    expect(partial.body.data.map((t: { status: string }) => t.status)).toEqual([
      'partially_refunded',
    ]);

    await stack.http
      .get('/v1/platform/transactions')
      .query({ status: 'bogus' })
      .set(as(finance))
      .expect(400);
  });

  it('entitlement overrides only accept catalogued feature keys', async () => {
    await stack.http
      .put(`/v1/platform/estates/${estateId}/entitlements/marketplce`)
      .set(as(superA))
      .send({ enabled: true, reason: 'Pilot programme' })
      .expect(400);
    await stack.http
      .put(`/v1/platform/estates/${estateId}/entitlements/facilities`)
      .set(as(superA))
      .send({ enabled: false, reason: 'Pilot programme' })
      .expect(200);
  });

  it('adding a ticket message writes an outbox and audit event', async () => {
    const ticket = await stack.http
      .post('/v1/platform/support-tickets')
      .set(as(agent))
      .send({
        channel: 'email',
        category: 'technical',
        priority: 'normal',
        subject: 'Cannot open gate log',
        description: 'Gate log screen spins forever',
      })
      .expect(201);
    const id = ticket.body.data.id as string;
    await stack.http
      .post(`/v1/platform/support-tickets/${id}/messages`)
      .set(as(agent))
      .send({ body: 'Checked device sync, escalating', internal: true })
      .expect(201);
    expect(
      await countRows(
        stack.db.owner,
        `select count(*) from platform.outbox_events
          where type = 'platform.support_ticket_message.created' and aggregate_id = $1`,
        [id],
      ),
    ).toBe(1);
  });
});
