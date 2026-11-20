import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signIn, startTestStack, type TestStack, WEB_DEVICE } from './support/app';

/**
 * Staff and custom roles (authz.md §7): no escalation above one's own level, no self-changes, no
 * platform permissions in estate roles, and residents never listed as staff.
 */
describe('staff and custom roles', () => {
  let stack: TestStack;
  let estateId: string;
  let admin: string;
  let adminId: string;
  let manager: string;
  let managerId: string;
  let colleagueId: string;
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const url = (path: string) => `/v1/estates/${estateId}${path}`;

  async function staff(phone: string, role: string) {
    const userId = await stack.createUser(phone, `Staff ${phone.slice(-2)}`);
    await stack.addMember(estateId, userId, role);
    await stack.resetRateLimits();
    const token = (await signIn(stack, phone, WEB_DEVICE)).accessToken;
    await stack.db.owner.query(
      `update platform.sessions set mfa_verified_at = now() where user_id = $1`,
      [userId],
    );
    return { token, userId };
  }

  beforeAll(async () => {
    stack = await startTestStack();
    estateId = await stack.createEstate('Roles Estate');
    ({ token: admin, userId: adminId } = await staff('+2348037300001', 'estate_administrator'));
    ({ token: manager, userId: managerId } = await staff('+2348037300002', 'estate_manager'));
    colleagueId = await stack.createUser('+2348037300003', 'Colleague');
    await stack.addMember(estateId, colleagueId, 'facility_manager');
    // Residents of every kind (including homeowners and property owners) are not staff.
    for (const [phone, role] of [
      ['+2348037300011', 'homeowner'],
      ['+2348037300012', 'tenant'],
      ['+2348037300013', 'property_owner'],
    ] as const) {
      await stack.addMember(estateId, await stack.createUser(phone), role);
    }
  }, 240_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('never accepts platform permissions or permissions the creator lacks in a custom role', async () => {
    const platform = await stack.http
      .post(url('/roles'))
      .set(as(admin))
      .send({ name: 'Sneaky', permissions: ['resident.read', 'platform.config'] })
      .expect(422);
    expect(platform.body.error.code).toBe('PERMISSION_NOT_ASSIGNABLE');

    const notHeld = await stack.http
      .post(url('/roles'))
      .set(as(admin))
      .send({ name: 'Billing combo', permissions: ['billing.run.create', 'billing.run.approve'] })
      .expect(403);
    expect(notHeld.body.error.code).toBe('PERMISSION_NOT_HELD');

    await stack.http
      .post(url('/roles'))
      .set(as(admin))
      .send({ name: 'Front desk', permissions: ['resident.read', 'visitor.log.read'] })
      .expect(201);
  });

  it('forbids changing one’s own roles', async () => {
    const self = await stack.http
      .post(url(`/staff/${adminId}/roles`))
      .set(as(admin))
      .send({ roleKey: 'estate_accountant' })
      .expect(403);
    expect(self.body.error.code).toBe('CANNOT_ASSIGN_SELF');
    const invite = await stack.http
      .post(url('/staff/invite'))
      .set(as(admin))
      .send({ fullName: 'Me Again', phone: '+2348037300001', roleKeys: ['estate_accountant'] })
      .expect(403);
    expect(invite.body.error.code).toBe('CANNOT_ASSIGN_SELF');
  });

  it('lets administrators staff operational roles but not hand out resident roles', async () => {
    await stack.http
      .post(url(`/staff/${colleagueId}/roles`))
      .set(as(admin))
      .send({ roleKey: 'security_officer' })
      .expect(201);
    await stack.http
      .post(url(`/staff/${colleagueId}/roles`))
      .set(as(admin))
      .send({ roleKey: 'homeowner' })
      .expect(404);
  });

  it('blocks granting a management role above the granter’s level', async () => {
    // A custom role with role.assign but without estate.configure, given to the manager.
    const custom = await stack.http
      .post(url('/roles'))
      .set(as(admin))
      .send({ name: 'Staff coordinator', permissions: ['role.assign', 'resident.read'] })
      .expect(201);
    await stack.http
      .post(url(`/staff/${managerId}/roles`))
      .set(as(admin))
      .send({ roleKey: custom.body.data.key })
      .expect(201);
    await stack.resetRateLimits();
    const managerToken = (await signIn(stack, '+2348037300002', WEB_DEVICE)).accessToken;
    await stack.db.owner.query(
      `update platform.sessions set mfa_verified_at = now() where user_id = $1`,
      [managerId],
    );
    manager = managerToken;
    const escalate = await stack.http
      .post(url(`/staff/${colleagueId}/roles`))
      .set(as(manager))
      .send({ roleKey: 'estate_administrator' })
      .expect(403);
    expect(escalate.body.error.code).toBe('PERMISSION_NOT_HELD');
    const suspendAdmin = await stack.http
      .post(url(`/staff/${adminId}/status`))
      .set(as(manager))
      .send({ status: 'suspended', reason: 'Taking over' })
      .expect(403);
    expect(suspendAdmin.body.error.code).toBe('PERMISSION_NOT_HELD');
  });

  it('lists only staff, never residents or owners', async () => {
    const response = await stack.http.get(url('/staff')).set(as(admin)).expect(200);
    const items = (response.body.data.items ?? response.body.data) as {
      assignments: { roleKey: string }[];
    }[];
    const keys = items.flatMap((item) => item.assignments.map((role) => role.roleKey));
    expect(keys).not.toContain('homeowner');
    expect(keys).not.toContain('tenant');
    expect(keys).not.toContain('property_owner');
    expect(keys).toContain('estate_administrator');
  });
});
