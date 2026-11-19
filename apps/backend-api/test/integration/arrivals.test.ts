import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../../src/common/ids/uuidv7';
import { countRows, signIn, startTestStack, type TestStack, WEB_DEVICE } from './support/app';

describe('deliveries and event guest lists', () => {
  let stack: TestStack;
  let estateId: string;
  let manager: string;
  let guard: string;
  let resident: string;
  let neighbour: string;
  let unitId: string;
  let gateId: string;
  let otherGateId: string;
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
    estateId = await stack.createEstate('Arrivals Estate');
    manager = await staff('+2348041000001', 'estate_manager');
    guard = await staff('+2348041000002', 'security_officer');
    const admin = await staff('+2348041000003', 'estate_administrator');
    const unit = async (code: string) =>
      (
        await stack.http
          .post(url('/spaces'))
          .set(as(admin))
          .send({ type: 'unit', code })
          .expect(201)
      ).body.data.id as string;
    unitId = await unit('D-1');
    const other = await unit('D-2');
    for (const [spaceId, phone] of [
      [unitId, '+2348041000010'],
      [other, '+2348041000011'],
    ] as const) {
      await stack.http
        .post(url('/occupancies'))
        .set(as(manager))
        .send({ spaceId, type: 'tenant', head: { fullName: `Resident ${phone.slice(-2)}`, phone } })
        .expect(201);
    }
    resident = (await signIn(stack, '+2348041000010')).accessToken;
    neighbour = (await signIn(stack, '+2348041000011')).accessToken;
    const gate = async (name: string) =>
      (await stack.http.post(url('/gates')).set(as(admin)).send({ name, type: 'both' }).expect(201))
        .body.data.id as string;
    gateId = await gate('Main gate');
    otherGateId = await gate('Side gate');
  }, 240_000);

  afterAll(async () => {
    await stack?.stop();
  });

  let deliveryId: string;

  it('lets a guard log a parcel at the gate and tells the household', async () => {
    await stack.http
      .post(url('/deliveries'))
      .set(as(resident))
      .send({ gateId, spaceId: unitId, company: 'Jumia' })
      .expect(403);
    const created = await stack.http
      .post(url('/deliveries'))
      .set(as(guard))
      .send({
        gateId,
        spaceId: unitId,
        company: 'Jumia',
        riderName: 'Tunde',
        vehiclePlate: 'kja 123 ab',
      })
      .expect(201);
    deliveryId = created.body.data.id;
    expect(created.body.data).toMatchObject({
      status: 'at_gate',
      unitCode: 'D-1',
      gateName: 'Main gate',
      vehiclePlate: 'KJA123AB',
    });
    expect(
      await countRows(
        stack.db.owner,
        `select count(*) from platform.outbox_events where type = 'notifications.request.created'
           and payload->>'intent' = 'visitor.delivery_at_gate'`,
      ),
    ).toBe(1);
  });

  it('shows residents only their own parcels', async () => {
    const mine = await stack.http.get(url('/deliveries')).set(as(resident)).expect(200);
    expect(mine.body.data.map((d: { id: string }) => d.id)).toEqual([deliveryId]);
    const theirs = await stack.http.get(url('/deliveries')).set(as(neighbour)).expect(200);
    expect(theirs.body.data).toEqual([]);
    const atGate = await stack.http
      .get(url('/deliveries'))
      .query({ status: 'at_gate' })
      .set(as(guard))
      .expect(200);
    expect(atGate.body.data).toHaveLength(1);
  });

  it('closes a parcel once', async () => {
    const closed = await stack.http
      .post(url(`/deliveries/${deliveryId}/close`))
      .set(as(guard))
      .send({ outcome: 'collected', note: 'Collected by Ada' })
      .expect(200);
    expect(closed.body.data).toMatchObject({ status: 'collected', closedNote: 'Collected by Ada' });
    const again = await stack.http
      .post(url(`/deliveries/${deliveryId}/close`))
      .set(as(guard))
      .send({ outcome: 'returned', note: 'Twice' })
      .expect(409);
    expect(again.body.error.code).toBe('DELIVERY_CLOSED');
  });

  let passId: string;

  it('creates an event pass with a guest list', async () => {
    const households = await stack.http.get(url('/households/mine')).set(as(resident)).expect(200);
    const householdId = households.body.data[0].id as string;
    const start = new Date(Date.now() - 30 * 60_000);
    const end = new Date(Date.now() + 4 * 3_600_000);
    await stack.http
      .post(url('/visitor-invitations'))
      .set(as(resident))
      .send({
        householdId,
        type: 'event',
        validFrom: start.toISOString(),
        validTo: end.toISOString(),
        gateIds: [gateId],
      })
      .expect(400);
    const created = await stack.http
      .post(url('/visitor-invitations'))
      .set(as(resident))
      .send({
        householdId,
        type: 'event',
        validFrom: start.toISOString(),
        validTo: end.toISOString(),
        gateIds: [gateId],
        event: { name: 'Birthday party', guests: ['Bola Ade', 'Chika Obi', 'Dayo Bello'] },
      })
      .expect(201);
    expect(created.body.data).toHaveLength(1);
    passId = created.body.data[0].id;
    expect(created.body.data[0]).toMatchObject({ type: 'event', visitorName: 'Birthday party' });
  });

  it('lists the event at its gate only, and checks a guest in once', async () => {
    const events = await stack.http
      .get(url('/gate/event-passes'))
      .query({ gateId })
      .set(as(guard))
      .expect(200);
    expect(events.body.data).toHaveLength(1);
    expect(events.body.data[0]).toMatchObject({ eventName: 'Birthday party', unitCode: 'D-1' });
    expect(events.body.data[0].guests).toHaveLength(3);
    const side = await stack.http
      .get(url('/gate/event-passes'))
      .query({ gateId: otherGateId })
      .set(as(guard))
      .expect(200);
    expect(side.body.data).toEqual([]);

    const guestId = events.body.data[0].guests[0].id as string;
    const wrongGate = await stack.http
      .post(url(`/event-guests/${guestId}/check-in`))
      .set(as(guard))
      .send({ gateId: otherGateId, clientUuid: uuidv7() })
      .expect(422);
    expect(wrongGate.body.error.code).toBe('EVENT_PASS_NOT_VALID');
    const checked = await stack.http
      .post(url(`/event-guests/${guestId}/check-in`))
      .set(as(guard))
      .send({ gateId, clientUuid: uuidv7() })
      .expect(200);
    expect(checked.body.data.checkedInAt).toBeTruthy();
    await stack.http
      .post(url(`/event-guests/${guestId}/check-in`))
      .set(as(guard))
      .send({ gateId, clientUuid: uuidv7() })
      .expect(409);
    expect(
      await countRows(
        stack.db.owner,
        `select count(*) from tenant.gate_events where pass_id = $1 and direction = 'in'`,
        [passId],
      ),
    ).toBe(1);
  });

  it('shows the host their guest list and hides it from others', async () => {
    const guests = await stack.http
      .get(url(`/visitor-passes/${passId}/guests`))
      .set(as(resident))
      .expect(200);
    expect(
      guests.body.data.filter((g: { checkedInAt: string | null }) => g.checkedInAt),
    ).toHaveLength(1);
    await stack.http
      .get(url(`/visitor-passes/${passId}/guests`))
      .set(as(neighbour))
      .expect(404);
  });

  it('stops check-ins once the event pass is revoked', async () => {
    await stack.http
      .post(url(`/visitor-passes/${passId}/revoke`))
      .set(as(resident))
      .send({ reason: 'Party cancelled' })
      .expect(200);
    const guests = await stack.http
      .get(url(`/visitor-passes/${passId}/guests`))
      .set(as(resident))
      .expect(200);
    const waiting = guests.body.data.find((g: { checkedInAt: string | null }) => !g.checkedInAt);
    await stack.http
      .post(url(`/event-guests/${waiting.id}/check-in`))
      .set(as(guard))
      .send({ gateId, clientUuid: uuidv7() })
      .expect(422);
  });
});
