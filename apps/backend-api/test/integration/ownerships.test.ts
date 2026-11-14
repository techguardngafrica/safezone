import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signIn, startTestStack, type TestStack, WEB_DEVICE } from './support/app';

describe('ownerships, transfers, owner mode and owner billing', () => {
  let stack: TestStack;
  let estateId: string;
  let admin: string;
  let accountant: string;
  let manager: string;
  let unitId: string;
  let vacantId: string;
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const url = (path: string) => `/v1/estates/${estateId}${path}`;

  async function staff(phone: string, role: string) {
    const userId = await stack.createUser(phone);
    await stack.addMember(estateId, userId, role);
    const token = (await signIn(stack, phone, WEB_DEVICE)).accessToken;
    await stack.db.owner.query(
      `update platform.sessions set mfa_verified_at = now() where user_id = $1`,
      [userId],
    );
    return token;
  }

  beforeAll(async () => {
    stack = await startTestStack();
    estateId = await stack.createEstate('Owners Estate');
    admin = await staff('+2348035000001', 'estate_administrator');
    accountant = await staff('+2348035000002', 'estate_accountant');
    manager = await staff('+2348035000003', 'estate_manager');
    unitId = (
      await stack.http
        .post(url('/spaces'))
        .set(as(admin))
        .send({ type: 'unit', code: 'D-4', unitType: 'flat' })
        .expect(201)
    ).body.data.id;
    vacantId = (
      await stack.http
        .post(url('/spaces'))
        .set(as(admin))
        .send({ type: 'unit', code: 'D-5', unitType: 'flat' })
        .expect(201)
    ).body.data.id;
  }, 240_000);

  afterAll(async () => {
    await stack?.stop();
  });

  let ownerToken: string;

  it('records owners within 100% and gives them owner mode', async () => {
    await stack.http
      .post(url(`/units/${unitId}/ownerships`))
      .set(as(admin))
      .send({
        owner: { type: 'person', fullName: 'Ngozi Owner', phone: '+2348035000010' },
        shareBasisPoints: 6_000,
      })
      .expect(201);
    await stack.http
      .post(url(`/units/${unitId}/ownerships`))
      .set(as(admin))
      .send({
        owner: {
          type: 'company',
          companyName: 'Lagos Homes Ltd',
          contactName: 'Tunde Contact',
          contactPhone: '+2348035000011',
        },
        shareBasisPoints: 4_001,
      })
      .expect(422);
    const company = await stack.http
      .post(url(`/units/${unitId}/ownerships`))
      .set(as(admin))
      .send({
        owner: {
          type: 'company',
          companyName: 'Lagos Homes Ltd',
          contactName: 'Tunde Contact',
          contactPhone: '+2348035000011',
        },
        shareBasisPoints: 4_000,
      })
      .expect(201);
    expect(company.body.data).toMatchObject({
      ownerType: 'company',
      companyName: 'Lagos Homes Ltd',
    });
    await stack.http
      .post(url(`/units/${vacantId}/ownerships`))
      .set(as(admin))
      .send({ owner: { type: 'person', fullName: 'Ngozi Owner', phone: '+2348035000010' } })
      .expect(201);

    ownerToken = (await signIn(stack, '+2348035000010')).accessToken;
    const owned = await stack.http.get(url('/owned-units')).set(as(ownerToken)).expect(200);
    expect(
      owned.body.data.map((unit: { unitCode: string; shareBasisPoints: number }) => [
        unit.unitCode,
        unit.shareBasisPoints,
      ]),
    ).toEqual([
      ['D-4', 6_000],
      ['D-5', 10_000],
    ]);
    const owners = await stack.http
      .get(url(`/units/${unitId}/ownerships`))
      .set(as(ownerToken))
      .expect(200);
    expect(owners.body.data).toHaveLength(2);
    await expect(
      stack.db.owner.query(
        `update tenant.ownerships set share_bp = 9000 where space_id = $1 and owner_type = 'person'`,
        [unitId],
      ),
    ).rejects.toThrow(/exceed 100%/);
  });

  it('routes a tenant join request to the unit owner first', async () => {
    const tenantId = await stack.createUser('+2348035000020', 'Femi Tenant');
    void tenantId;
    const tenant = (await signIn(stack, '+2348035000020')).accessToken;
    const request = await stack.http
      .post('/v1/me/join-requests')
      .set(as(tenant))
      .send({ estateId, spaceId: unitId, relationship: 'tenant', fullName: 'Femi Tenant' })
      .expect(201);
    expect(request.body.data.status).toBe('awaiting_owner');
    const queue = await stack.http.get(url('/join-requests')).set(as(ownerToken)).expect(200);
    expect(queue.body.data.map((item: { id: string }) => item.id)).toContain(request.body.data.id);
    const approved = await stack.http
      .post(url(`/join-requests/${request.body.data.id}/approve`))
      .set(as(ownerToken))
      .send({})
      .expect(200);
    expect(approved.body.data.status).toBe('awaiting_manager');
  });

  it('bills owner charges to the primary owner and skips units without an owner', async () => {
    const charge = await stack.http
      .post(url('/charges'))
      .set(as(accountant))
      .send({
        type: 'development_levy',
        name: 'Owners levy',
        amountRule: { kind: 'fixed', amount: 2_000_000 },
        frequency: 'one_off',
        payer: 'owner',
        startsOn: '2026-01-01',
      })
      .expect(201);
    const extra = await stack.http
      .post(url('/spaces'))
      .set(as(admin))
      .send({ type: 'unit', code: 'D-6' })
      .expect(201);
    void extra;
    const run = await stack.http
      .post(url('/billing-runs'))
      .set(as(accountant))
      .send({
        label: 'Owners levy 2027',
        periodStart: '2027-01-01',
        periodEnd: '2027-12-31',
        dueDate: '2027-02-01',
        chargeIds: [charge.body.data.id],
      })
      .expect(201);
    await stack.http
      .post(url(`/billing-runs/${run.body.data.id}/preview`))
      .set(as(accountant))
      .expect(200);
    const items = await stack.http
      .get(url(`/billing-runs/${run.body.data.id}/items`))
      .set(as(accountant))
      .expect(200);
    expect(
      items.body.data.map(
        (item: {
          unitCode: string;
          payerType: string;
          payerName: string | null;
          skipReason: string | null;
        }) => [item.unitCode, item.payerType, item.payerName, item.skipReason],
      ),
    ).toEqual([
      ['D-4', 'owner', 'Ngozi Owner', null],
      ['D-5', 'owner', 'Ngozi Owner', null],
      ['D-6', 'occupant', null, 'no_owner'],
    ]);
    await stack.http
      .post(url(`/billing-runs/${run.body.data.id}/submit`))
      .set(as(accountant))
      .expect(200);
    await stack.http
      .post(url(`/billing-runs/${run.body.data.id}/approve`))
      .set(as(manager))
      .expect(200);
    await stack.http
      .post(url(`/billing-runs/${run.body.data.id}/issue`))
      .set(as(accountant))
      .expect(200);
    const mine = await stack.http.get(url('/invoices')).set(as(ownerToken)).expect(200);
    expect(mine.body.data).toHaveLength(2);
    expect(mine.body.data[0]).toMatchObject({ payerType: 'owner', total: 2_000_000 });
  });

  it('transfers ownership with seller confirmation and manager approval', async () => {
    const transfer = await stack.http
      .post(url('/ownership-transfers'))
      .set(as(manager))
      .send({
        spaceId: vacantId,
        type: 'sale',
        effectiveOn: '2026-12-01',
        toOwners: [
          {
            owner: { type: 'person', fullName: 'Kemi Buyer', phone: '+2348035000030' },
            shareBasisPoints: 10_000,
          },
        ],
      })
      .expect(201);
    expect(transfer.body.data.status).toBe('requested');
    await stack.http
      .post(url('/ownership-transfers'))
      .set(as(manager))
      .send({
        spaceId: vacantId,
        type: 'sale',
        effectiveOn: '2026-12-01',
        toOwners: [
          {
            owner: { type: 'person', fullName: 'Kemi Buyer', phone: '+2348035000030' },
            shareBasisPoints: 10_000,
          },
        ],
      })
      .expect(409);
    await stack.http
      .post(url(`/ownership-transfers/${transfer.body.data.id}/approve`))
      .set(as(admin))
      .send({})
      .expect(422);
    await stack.http
      .post(url(`/ownership-transfers/${transfer.body.data.id}/confirm`))
      .set(as(ownerToken))
      .expect(200);
    const done = await stack.http
      .post(url(`/ownership-transfers/${transfer.body.data.id}/approve`))
      .set(as(admin))
      .send({})
      .expect(200);
    expect(done.body.data.status).toBe('completed');
    const history = await stack.http
      .get(url(`/units/${vacantId}/ownerships`))
      .set(as(admin))
      .expect(200);
    expect(
      history.body.data.map((row: { ownerName: string; status: string }) => [
        row.ownerName,
        row.status,
      ]),
    ).toEqual([
      ['Kemi Buyer', 'active'],
      ['Ngozi Owner', 'ended'],
    ]);
    const owned = await stack.http.get(url('/owned-units')).set(as(ownerToken)).expect(200);
    expect(owned.body.data.map((unit: { unitCode: string }) => unit.unitCode)).toEqual(['D-4']);
  });
});
