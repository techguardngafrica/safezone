import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { builtInRoleId } from '../../src/scripts/seed-roles';
import { countRows, signIn, startTestStack, type TestStack, WEB_DEVICE } from './support/app';

describe('occupancy', () => {
  let stack: TestStack;
  let estateId: string;
  let estateCode: string;
  let managerToken: string;
  let guardToken: string;
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const url = (path: string) => `/v1/estates/${estateId}${path}`;

  async function staff(phone: string, role: string) {
    const id = await stack.createUser(phone);
    await stack.addMember(estateId, id, role);
    const token = (await signIn(stack, phone, WEB_DEVICE)).accessToken;
    await stack.db.owner.query(
      `update platform.sessions set mfa_verified_at = now() where user_id = $1`,
      [id],
    );
    return token;
  }

  async function unit(code: string): Promise<string> {
    const response = await stack.http
      .post(url('/spaces'))
      .set(as(managerToken))
      .send({ type: 'unit', code, unitType: 'flat' })
      .expect(201);
    return response.body.data.id;
  }

  beforeAll(async () => {
    stack = await startTestStack();
    estateId = await stack.createEstate('Occupancy Estate');
    estateCode = (
      await stack.db.owner.query(`select code from platform.estates where id = $1`, [estateId])
    ).rows[0].code;
    managerToken = await staff('+2348038000001', 'estate_manager');
    guardToken = await staff('+2348038000002', 'security_officer');
  });
  afterAll(async () => {
    await stack?.stop();
  });

  it('tenant asks to join, manager approves: household, occupancy, membership and role', async () => {
    const unitId = await unit('A1');
    const tenant = await signIn(stack, '+2348038000010');
    const auth = as(tenant.accessToken);

    const estate = await stack.http
      .get(`/v1/join/estates/${estateCode.toLowerCase()}`)
      .set(auth)
      .expect(200);
    expect(estate.body.data).toEqual({ id: estateId, name: 'Occupancy Estate' });
    await stack.http.get('/v1/join/estates/ZZZZZZ').set(auth).expect(404);
    const units = await stack.http
      .get(`/v1/join/estates/${estateCode}/units`)
      .query({ q: 'a1' })
      .set(auth)
      .expect(200);
    expect(units.body.data).toEqual([{ id: unitId, code: 'A1', name: 'A1' }]);

    // Not a member yet: estate routes are invisible.
    await stack.http.get(url('/households/mine')).set(auth).expect(404);

    const request = await stack.http
      .post('/v1/me/join-requests')
      .set(auth)
      .send({ estateId, spaceId: unitId, relationship: 'tenant', fullName: 'Tola Tenant' })
      .expect(201);
    expect(request.body.data.status).toBe('awaiting_manager');
    await stack.http
      .post('/v1/me/join-requests')
      .set(auth)
      .send({ estateId, spaceId: unitId, relationship: 'tenant', fullName: 'Tola Tenant' })
      .expect(409);

    const queue = await stack.http.get(url('/join-requests')).set(as(managerToken)).expect(200);
    expect(queue.body.data.map((item: { id: string }) => item.id)).toContain(request.body.data.id);
    // A guard is a member but not an approver.
    await stack.http
      .post(url(`/join-requests/${request.body.data.id}/approve`))
      .set(as(guardToken))
      .send({})
      .expect(404);

    const approved = await stack.http
      .post(url(`/join-requests/${request.body.data.id}/approve`))
      .set(as(managerToken))
      .send({})
      .expect(200);
    expect(approved.body.data.status).toBe('approved');
    await stack.http
      .post(url(`/join-requests/${request.body.data.id}/approve`))
      .set(as(managerToken))
      .send({})
      .expect(409);

    const mine = await stack.http.get(url('/households/mine')).set(auth).expect(200);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0]).toMatchObject({
      unit: { id: unitId, code: 'A1' },
      occupancy: { type: 'tenant' },
      members: [
        expect.objectContaining({
          relationship: 'head',
          permissions: expect.objectContaining({ inviteVisitors: true }),
        }),
      ],
    });
    const space = await stack.http
      .get(url(`/spaces/${unitId}`))
      .set(as(managerToken))
      .expect(200);
    expect(space.body.data.status).toBe('occupied');
    expect(
      await countRows(
        stack.db.owner,
        `select count(*) from platform.role_assignments where user_id = $1 and role_id = $2 and revoked_at is null`,
        [tenant.user.id, builtInRoleId('tenant')],
      ),
    ).toBe(1);

    // The unit is taken: another person can only ask to join the household.
    const other = await signIn(stack, '+2348038000011');
    await stack.http
      .post('/v1/me/join-requests')
      .set(as(other.accessToken))
      .send({ estateId, spaceId: unitId, relationship: 'tenant', fullName: 'Second Tenant' })
      .expect(409);
  });

  it('household member requests go to the head; heads manage permissions; ending revokes access', async () => {
    const unitId = await unit('B2');
    const head = await signIn(stack, '+2348038000020');
    await stack.http
      .post('/v1/me/join-requests')
      .set(as(head.accessToken))
      .send({ estateId, spaceId: unitId, relationship: 'owner', fullName: 'Bisi Owner' })
      .expect(201);
    const ownerQueue = await stack.http
      .get(url('/join-requests'))
      .set(as(managerToken))
      .expect(200);
    const ownerRequest = ownerQueue.body.data.find(
      (item: { unit: { id: string } }) => item.unit.id === unitId,
    );
    await stack.http
      .post(url(`/join-requests/${ownerRequest.id}/approve`))
      .set(as(managerToken))
      .send({})
      .expect(200);

    const relative = await signIn(stack, '+2348038000021');
    const joinHousehold = await stack.http
      .post('/v1/me/join-requests')
      .set(as(relative.accessToken))
      .send({
        estateId,
        spaceId: unitId,
        relationship: 'household_member',
        fullName: 'Kemi Relative',
      })
      .expect(201);
    expect(joinHousehold.body.data.status).toBe('awaiting_household_head');

    const headQueue = await stack.http
      .get(url('/join-requests'))
      .set(as(head.accessToken))
      .expect(200);
    expect(headQueue.body.data.map((item: { id: string }) => item.id)).toEqual([
      joinHousehold.body.data.id,
    ]);
    await stack.http
      .post(url(`/join-requests/${joinHousehold.body.data.id}/approve`))
      .set(as(head.accessToken))
      .send({})
      .expect(200);

    const households = await stack.http
      .get(url('/households/mine'))
      .set(as(relative.accessToken))
      .expect(200);
    const household = households.body.data[0];
    const member = household.members.find((m: { userId: string }) => m.userId === relative.user.id);
    expect(member.permissions).toMatchObject({ inviteVisitors: true, payBills: false });

    // Only the head (or a manager) changes permissions.
    await stack.http
      .patch(url(`/household-members/${member.id}`))
      .set(as(relative.accessToken))
      .send({ permissions: { payBills: true } })
      .expect(403);
    const updated = await stack.http
      .patch(url(`/household-members/${member.id}`))
      .set(as(head.accessToken))
      .send({ permissions: { inviteVisitors: false } })
      .expect(200);
    expect(
      updated.body.data.members.find((m: { id: string }) => m.id === member.id).permissions
        .inviteVisitors,
    ).toBe(false);

    // Head adds a minor without an account.
    await stack.http
      .post(url(`/households/${household.id}/members`))
      .set(as(head.accessToken))
      .send({ fullName: 'Little One', relationship: 'child', isMinor: true })
      .expect(201);
    await stack.http
      .post(url(`/households/${household.id}/members`))
      .set(as(head.accessToken))
      .send({ fullName: 'Adult Without Phone', relationship: 'relative' })
      .expect(400);

    // Vehicles: members register, guards look up the minimum, plates are unique.
    await stack.http
      .post(url('/vehicles'))
      .set(as(relative.accessToken))
      .send({ householdId: household.id, plate: 'lag 123-ab', make: 'Toyota', colour: 'Silver' })
      .expect(201);
    await stack.http
      .post(url('/vehicles'))
      .set(as(head.accessToken))
      .send({ householdId: household.id, plate: 'LAG123AB' })
      .expect(409);
    const lookup = await stack.http
      .get(url('/vehicles/lookup'))
      .query({ plate: 'LAG-123 AB' })
      .set(as(guardToken))
      .expect(200);
    expect(lookup.body.data).toEqual({
      plate: 'LAG 123-AB',
      make: 'Toyota',
      model: null,
      colour: 'Silver',
      unitCode: 'B2',
      householdName: 'Bisi Owner household',
    });
    await stack.http
      .get(url('/vehicles/lookup'))
      .query({ plate: 'LAG123AB' })
      .set(as(relative.accessToken))
      .expect(403);

    // Domestic staff need manager approval by default.
    const cleaner = await stack.http
      .post(url('/domestic-staff'))
      .set(as(head.accessToken))
      .send({
        householdId: household.id,
        name: 'Ada Cleaner',
        role: 'cleaner',
        schedule: { days: [1, 3, 5], from: '08:00', to: '16:00' },
      })
      .expect(201);
    expect(cleaner.body.data.status).toBe('pending');
    await stack.http
      .post(url(`/domestic-staff/${cleaner.body.data.id}/status`))
      .set(as(head.accessToken))
      .send({ status: 'active' })
      .expect(403);
    const active = await stack.http
      .post(url(`/domestic-staff/${cleaner.body.data.id}/status`))
      .set(as(managerToken))
      .send({ status: 'active' })
      .expect(200);
    expect(active.body.data.status).toBe('active');

    // Resident directory masks phones for staff without pii.view (security officer has no resident.read).
    const directory = await stack.http
      .get(url('/residents'))
      .query({ q: 'kemi' })
      .set(as(managerToken))
      .expect(200);
    expect(directory.body.data[0]).toMatchObject({
      fullName: 'Kemi Relative',
      phone: '+2348038000021',
    });
    await stack.http.get(url('/residents')).set(as(guardToken)).expect(403);

    // Ending the occupancy: household ends, unit vacant, roles and memberships go.
    await stack.http
      .post(url(`/occupancies/${household.occupancy.id}/end`))
      .set(as(managerToken))
      .send({ reason: 'Sold and moved out' })
      .expect(200);
    await stack.http.get(url('/households/mine')).set(as(relative.accessToken)).expect(404);
    const space = await stack.http
      .get(url(`/spaces/${unitId}`))
      .set(as(managerToken))
      .expect(200);
    expect(space.body.data.status).toBe('vacant');
    expect(
      await stack.http
        .get(url('/vehicles/lookup'))
        .query({ plate: 'LAG123AB' })
        .set(as(guardToken))
        .then((r) => r.body.data),
    ).toBeNull();
    expect(
      await countRows(
        stack.db.owner,
        `select count(*) from platform.role_assignments where user_id = $1 and estate_id = $2 and revoked_at is null`,
        [head.user.id, estateId],
      ),
    ).toBe(0);
  });

  it('manager records residents by phone; they sign in later', async () => {
    const unitId = await unit('C3');
    const created = await stack.http
      .post(url('/occupancies'))
      .set(as(managerToken))
      .send({
        spaceId: unitId,
        type: 'owner_occupier',
        head: { fullName: 'Chuka Owner', phone: '+2348038000030' },
      })
      .expect(201);
    expect(created.body.data.occupancy.type).toBe('owner_occupier');
    await stack.http
      .post(url('/occupancies'))
      .set(as(managerToken))
      .send({
        spaceId: unitId,
        type: 'tenant',
        head: { fullName: 'Late Comer', phone: '+2348038000031' },
      })
      .expect(409);
    const owner = await signIn(stack, '+2348038000030');
    expect(owner.isNewUser).toBe(false);
    const mine = await stack.http
      .get(url('/households/mine'))
      .set(as(owner.accessToken))
      .expect(200);
    expect(mine.body.data[0].unit.code).toBe('C3');
  });

  it('emergency contacts need consent and belong to the user only', async () => {
    const user = await signIn(stack, '+2348038000040');
    const other = await signIn(stack, '+2348038000041');
    await stack.http
      .post('/v1/me/emergency-contacts')
      .set(as(user.accessToken))
      .send({
        name: 'Mum',
        phone: '+2348038000042',
        relationship: 'mother',
        consentConfirmed: false,
      })
      .expect(400);
    const contact = await stack.http
      .post('/v1/me/emergency-contacts')
      .set(as(user.accessToken))
      .send({
        name: 'Mum',
        phone: '+2348038000042',
        relationship: 'mother',
        consentConfirmed: true,
      })
      .expect(201);
    expect(
      (await stack.http.get('/v1/me/emergency-contacts').set(as(other.accessToken)).expect(200))
        .body.data,
    ).toEqual([]);
    await stack.http
      .delete(`/v1/me/emergency-contacts/${contact.body.data.id}`)
      .set(as(other.accessToken))
      .expect(404);
    await stack.http
      .delete(`/v1/me/emergency-contacts/${contact.body.data.id}`)
      .set(as(user.accessToken))
      .expect(204);
  });
});
