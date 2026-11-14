import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MovesService } from '../../src/modules/occupancy/moves/moves.service';
import { signIn, startTestStack, type TestStack, WEB_DEVICE } from './support/app';

describe('move-in, move-out and lease expiry', () => {
  let stack: TestStack;
  let estateId: string;
  let manager: string;
  let accountant: string;
  let guard: string;
  let head: string;
  let unitId: string;
  let occupancyId: string;
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
    estateId = await stack.createEstate('Moving Estate');
    manager = await staff('+2348039000001', 'estate_manager');
    accountant = await staff('+2348039000002', 'estate_accountant');
    guard = await staff('+2348039000003', 'security_officer');
    const admin = await staff('+2348039000004', 'estate_administrator');
    unitId = (
      await stack.http
        .post(url('/spaces'))
        .set(as(admin))
        .send({ type: 'unit', code: 'M-1' })
        .expect(201)
    ).body.data.id;
    await stack.http
      .post(url('/occupancies'))
      .set(as(manager))
      .send({
        spaceId: unitId,
        type: 'tenant',
        head: { fullName: 'Moving Tenant', phone: '+2348039000010' },
        startsOn: '2026-01-01',
        endsOn: '2027-01-13',
      })
      .expect(201);
    head = (await signIn(stack, '+2348039000010')).accessToken;
    const households = await stack.http.get(url('/households/mine')).set(as(head)).expect(200);
    occupancyId = (
      await stack.db.owner.query<{ id: string }>(
        `select id from tenant.occupancies where household_id = $1`,
        [households.body.data[0].id],
      )
    ).rows[0]?.id as string;
    await stack.http
      .post(url('/invoices'))
      .set(as(accountant))
      .send({
        spaceId: unitId,
        description: 'Dues',
        dueDate: '2027-01-01',
        lines: [{ description: 'Dues', unitAmount: 500_000 }],
      })
      .expect(201);
  }, 240_000);

  afterAll(async () => {
    await stack?.stop();
  });

  let moveId: string;

  it('lets the household head schedule a move-out with a balance warning and a gate notice for guards', async () => {
    const move = await stack.http
      .post(url('/moves'))
      .set(as(head))
      .send({
        type: 'move_out',
        occupancyId,
        scheduledOn: '2026-12-20',
        gateNotice: { items: '1 truck', vehicles: ['LND123AB'] },
      })
      .expect(201);
    moveId = move.body.data.id;
    expect(move.body.data).toMatchObject({
      outstandingBalance: 500_000,
      status: 'scheduled',
      unitCode: 'M-1',
    });
    expect(move.body.data.checklist.length).toBeGreaterThan(0);
    await stack.http
      .post(url('/moves'))
      .set(as(head))
      .send({ type: 'move_out', occupancyId, scheduledOn: '2026-12-21' })
      .expect(409);
    const forGuard = await stack.http
      .get(url('/moves'))
      .query({ on: '2026-12-20' })
      .set(as(guard))
      .expect(200);
    expect(forGuard.body.data).toHaveLength(1);
    expect(forGuard.body.data[0]).toMatchObject({
      gateNotice: { items: '1 truck', vehicles: ['LND123AB'] },
      outstandingBalance: 0,
    });
  });

  it('blocks a move-out with a balance when the estate says so, then completes it on the day', async () => {
    await stack.http
      .patch(`/v1/estates/${estateId}/settings`)
      .set(as(await staff('+2348039000005', 'estate_administrator')))
      .send({ 'occupancy.block_move_out_with_balance': true })
      .expect(200);
    await stack.http
      .post(url(`/moves/${moveId}/complete`))
      .set(as(manager))
      .expect(422);
    await stack.db.owner.query(
      `update tenant.estate_settings set value = 'false' where key = 'occupancy.block_move_out_with_balance'`,
    );
    const service = stack.app.get(MovesService);
    expect(await service.daily(estateId, '2026-12-19')).toMatchObject({ completed: 0 });
    expect(await service.daily(estateId, '2026-12-20')).toMatchObject({ completed: 1 });
    const unit = await stack.http
      .get(url(`/spaces/${unitId}`))
      .set(as(manager))
      .expect(200);
    expect(unit.body.data.status).toBe('vacant');
    const households = await stack.http.get(url('/households/mine')).set(as(head));
    expect(households.status === 404 || households.body.data?.length === 0).toBe(true);
  });

  it('sends lease reminders at 30 days and renews', async () => {
    const otherUnit = (
      await stack.http
        .post(url('/spaces'))
        .set(as(await staff('+2348039000006', 'estate_administrator')))
        .send({ type: 'unit', code: 'M-2' })
        .expect(201)
    ).body.data.id;
    await stack.http
      .post(url('/occupancies'))
      .set(as(manager))
      .send({
        spaceId: otherUnit,
        type: 'tenant',
        head: { fullName: 'Lease Tenant', phone: '+2348039000020' },
        startsOn: '2026-01-01',
        endsOn: '2027-02-01',
      })
      .expect(201);
    const service = stack.app.get(MovesService);
    expect((await service.daily(estateId, '2027-01-02')).reminders).toBe(1);
    const lease = (
      await stack.db.owner.query<{ id: string }>(
        `select id from tenant.occupancies where space_id = $1`,
        [otherUnit],
      )
    ).rows[0]?.id;
    await stack.http
      .post(url(`/occupancies/${lease}/renew`))
      .set(as(manager))
      .send({ endsOn: '2028-02-01' })
      .expect(200);
    expect((await service.daily(estateId, '2027-01-02')).reminders).toBe(0);
  });
});
