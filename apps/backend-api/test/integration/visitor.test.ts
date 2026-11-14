import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OutboxRelay } from '../../src/common/outbox/outbox-relay';
import { EmailSender, FakeEmailSender } from '../../src/integrations/email/email-sender';
import { FakeSmsSender } from '../../src/integrations/sms/fake-sms.sender';
import { SmsSender } from '../../src/integrations/sms/sms-sender';
import { publicKeyFromRaw, verifyPassToken } from '../../src/modules/visitor/domain/pass-token';
import { PassKeysService } from '../../src/modules/visitor/pass-keys.service';
import { WorkerModule } from '../../src/worker/worker.module';
import { countRows, signIn, startTestStack, type TestStack, WEB_DEVICE } from './support/app';

async function waitFor(check: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('condition not met in time');
}

describe('visitor passes and gate', () => {
  let stack: TestStack;
  let worker: INestApplicationContext;
  let relay: OutboxRelay;
  const workerSms = new FakeSmsSender();
  let estateId: string;
  let otherEstateId: string;
  let managerToken: string;
  let guardToken: string;
  let otherGuardToken: string;
  let hostToken: string;
  let memberToken: string;
  let householdId: string;
  let occupancyId: string;
  let gateId: string;
  let gateB: string;
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const url = (path: string) => `/v1/estates/${estateId}${path}`;
  const soon = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

  async function staff(estate: string, phone: string, role: string) {
    const id = await stack.createUser(phone);
    await stack.addMember(estate, id, role);
    const token = (await signIn(stack, phone, WEB_DEVICE)).accessToken;
    await stack.db.owner.query(
      `update platform.sessions set mfa_verified_at = now() where user_id = $1`,
      [id],
    );
    return token;
  }

  const invite = (token: string, body: Record<string, unknown>) =>
    stack.http
      .post(url('/visitor-invitations'))
      .set(as(token))
      .send({
        householdId,
        type: 'one_time',
        validFrom: soon(-5),
        validTo: soon(120),
        visitors: [{ name: 'Femi Visitor', phone: '+2348039000099' }],
        ...body,
      });

  const event = (body: Record<string, unknown>) => ({
    clientUuid: randomUUID(),
    gateId,
    direction: 'in',
    decision: 'allow',
    occurredAt: new Date().toISOString(),
    ...body,
  });

  beforeAll(async () => {
    stack = await startTestStack();
    process.env.OUTBOX_RELAY_DISABLED = 'true';
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(SmsSender)
      .useValue(workerSms)
      .overrideProvider(EmailSender)
      .useValue(new FakeEmailSender())
      .compile();
    worker = moduleRef.createNestApplication();
    await (worker as unknown as { init(): Promise<void> }).init();
    relay = worker.get(OutboxRelay);

    estateId = await stack.createEstate('Gate Estate');
    otherEstateId = await stack.createEstate('Elsewhere');
    managerToken = await staff(estateId, '+2348039000001', 'estate_manager');
    const adminToken = await staff(estateId, '+2348039000002', 'estate_administrator');
    guardToken = await staff(estateId, '+2348039000003', 'security_officer');
    otherGuardToken = await staff(otherEstateId, '+2348039000004', 'security_officer');
    gateId = (
      await stack.http
        .post(url('/gates'))
        .set(as(adminToken))
        .send({ name: 'Main Gate', type: 'both' })
        .expect(201)
    ).body.data.id;
    gateB = (
      await stack.http
        .post(url('/gates'))
        .set(as(adminToken))
        .send({ name: 'Back Gate', type: 'pedestrian' })
        .expect(201)
    ).body.data.id;
    await stack.http
      .post(url('/gates'))
      .set(as(guardToken))
      .send({ name: 'Nope', type: 'both' })
      .expect(403);

    const unit = await stack.http
      .post(url('/spaces'))
      .set(as(managerToken))
      .send({ type: 'unit', code: 'V1', unitType: 'house' })
      .expect(201);
    const household = await stack.http
      .post(url('/occupancies'))
      .set(as(managerToken))
      .send({
        spaceId: unit.body.data.id,
        type: 'tenant',
        head: { fullName: 'Hana Host', phone: '+2348039000010' },
      })
      .expect(201);
    householdId = household.body.data.id;
    occupancyId = household.body.data.occupancy.id;
    hostToken = (await signIn(stack, '+2348039000010')).accessToken;
    const added = await stack.http
      .post(url(`/households/${householdId}/members`))
      .set(as(hostToken))
      .send({
        fullName: 'Mo Member',
        phone: '+2348039000011',
        relationship: 'relative',
        permissions: { inviteVisitors: false },
      })
      .expect(201);
    expect(added.body.data.members).toHaveLength(2);
    memberToken = (await signIn(stack, '+2348039000011')).accessToken;
  });

  afterAll(async () => {
    await worker?.close();
    await stack?.stop();
  });

  it('host invites, guard verifies the QR and records one entry; the pass is then used', async () => {
    await invite(memberToken, {}).expect(403);
    const created = await invite(hostToken, {}).expect(201);
    const pass = created.body.data[0];
    expect(pass).toMatchObject({ status: 'active', maxUses: 1, usesCount: 0, type: 'one_time' });
    expect(pass.pin).toMatch(/^\d{6}$/);
    expect(pass.qr.length).toBeLessThanOrEqual(200);
    expect(pass.passUrl).toMatch(/\/p\/[A-Za-z0-9_-]{54}$/);

    // The QR verifies offline with the published key.
    const keys = await stack.http.get(url('/gate/keys')).set(as(guardToken)).expect(200);
    const key = keys.body.data.find((item: { keyIndex: number }) => item.keyIndex === 1);
    expect(
      verifyPassToken(pass.qr, publicKeyFromRaw(Buffer.from(key.publicKey, 'base64url')))?.passId,
    ).toBe(pass.id);

    const verified = await stack.http
      .post(url('/gate/verify'))
      .set(as(guardToken))
      .send({ gateId, qr: pass.qr })
      .expect(200);
    expect(verified.body.data).toMatchObject({
      decision: 'allow',
      pass: { id: pass.id, unitCode: 'V1', usesLeft: 1 },
    });
    // Residents and other estates' guards cannot verify here.
    await stack.http
      .post(url('/gate/verify'))
      .set(as(hostToken))
      .send({ gateId, qr: pass.qr })
      .expect(403);
    await stack.http
      .post(url('/gate/verify'))
      .set(as(otherGuardToken))
      .send({ gateId, qr: pass.qr })
      .expect(404);
    const foreign = await stack.http
      .post(`/v1/estates/${otherEstateId}/gate/verify`)
      .set(as(otherGuardToken))
      .send({ gateId, qr: pass.qr })
      .expect(404); // the gate is not theirs
    expect(foreign.body.error.code).toBe('GATE_NOT_FOUND');

    const entry = event({ passId: pass.id });
    const recorded = await stack.http
      .post(url('/gate/events'))
      .set(as(guardToken))
      .send(entry)
      .expect(201);
    expect(recorded.body.data).toMatchObject({
      created: true,
      decision: 'allow',
      visitorName: 'Femi Visitor',
    });
    const replay = await stack.http
      .post(url('/gate/events'))
      .set(as(guardToken))
      .send(entry)
      .expect(201);
    expect(replay.body.data.created).toBe(false);

    const again = await stack.http
      .post(url('/gate/verify'))
      .set(as(guardToken))
      .send({ gateId, pin: pass.pin })
      .expect(200);
    expect(again.body.data).toMatchObject({ decision: 'deny', reasons: ['no_uses_left'] });
    const exit = await stack.http
      .post(url('/gate/verify'))
      .set(as(guardToken))
      .send({ gateId, qr: pass.qr, direction: 'out' })
      .expect(200);
    expect(exit.body.data.decision).toBe('allow');

    const inside = await stack.http.get(url('/gate/inside')).set(as(guardToken)).expect(200);
    expect(inside.body.data.map((item: { passId: string }) => item.passId)).toContain(pass.id);
    await stack.http
      .post(url('/gate/events'))
      .set(as(guardToken))
      .send(event({ passId: pass.id, direction: 'out' }))
      .expect(201);
    const after = await stack.http.get(url('/gate/inside')).set(as(guardToken)).expect(200);
    expect(after.body.data.map((item: { passId: string }) => item.passId)).not.toContain(pass.id);

    // Denials and overrides need reasons; gate events cannot be edited.
    await stack.http
      .post(url('/gate/events'))
      .set(as(guardToken))
      .send(event({ decision: 'override' }))
      .expect(422);
    await expect(
      stack.db.owner.query(`update tenant.gate_events set decision = 'deny' where pass_id = $1`, [
        pass.id,
      ]),
    ).rejects.toThrow();

    const log = await stack.http
      .get(url('/gate/events'))
      .query({ passId: pass.id })
      .set(as(managerToken))
      .expect(200);
    expect(log.body.data).toHaveLength(2);
    await stack.http.get(url('/gate/events')).set(as(guardToken)).expect(403);
  });

  it('revocation is immediate online and appears in the offline revocation list', async () => {
    const since = new Date(Date.now() - 1000).toISOString();
    const pass = (
      await invite(hostToken, { type: 'multi_entry', maxUses: 3, gateIds: [gateId] }).expect(201)
    ).body.data[0];
    const wrongGate = await stack.http
      .post(url('/gate/verify'))
      .set(as(guardToken))
      .send({ gateId: gateB, pin: pass.pin })
      .expect(200);
    expect(wrongGate.body.data.reasons).toEqual(['wrong_gate']);

    const expected = await stack.http
      .get(url('/gate/expected'))
      .query({ gateId })
      .set(as(guardToken))
      .expect(200);
    const listed = expected.body.data.passes.find((item: { id: string }) => item.id === pass.id);
    expect(listed.pinDigest).toBe(PassKeysService.pinDigest(pass.id, pass.pin));
    const backList = await stack.http
      .get(url('/gate/expected'))
      .query({ gateId: gateB })
      .set(as(guardToken))
      .expect(200);
    expect(backList.body.data.passes.map((item: { id: string }) => item.id)).not.toContain(pass.id);

    await stack.http
      .post(url(`/visitor-passes/${pass.id}/revoke`))
      .set(as(memberToken))
      .send({ reason: 'Not needed' })
      .expect(404);
    await stack.http
      .post(url(`/visitor-passes/${pass.id}/revoke`))
      .set(as(hostToken))
      .send({ reason: 'Plans changed' })
      .expect(200);
    const denied = await stack.http
      .post(url('/gate/verify'))
      .set(as(guardToken))
      .send({ gateId, qr: pass.qr })
      .expect(200);
    expect(denied.body.data).toMatchObject({ decision: 'deny', reasons: ['revoked'] });
    const revocations = await stack.http
      .get(url('/gate/revocations'))
      .query({ since })
      .set(as(guardToken))
      .expect(200);
    expect(revocations.body.data.revoked.map((item: { passId: string }) => item.passId)).toContain(
      pass.id,
    );

    // The public page stops showing credentials.
    const token = pass.passUrl.split('/p/')[1];
    const page = await stack.http.get(`/v1/public/passes/${token}`).expect(200);
    expect(page.body.data).toMatchObject({
      status: 'revoked',
      pin: null,
      qr: null,
      estateName: 'Gate Estate',
      unitCode: 'V1',
    });
  });

  it('syncs offline events once, flags clock skew, and never exceeds max uses', async () => {
    const pass = (await invite(hostToken, {}).expect(201)).body.data[0];
    const one = event({ passId: pass.id, occurredAt: soon(-30) });
    const two = event({ passId: pass.id, occurredAt: soon(-29) });
    const first = await stack.http
      .post(url('/gate/sync'))
      .set(as(guardToken))
      .send({ deviceNow: soon(-20), events: [one, two] })
      .expect(200);
    expect(first.body.data).toEqual({ accepted: 2, duplicates: 0, rejected: [] });
    const second = await stack.http
      .post(url('/gate/sync'))
      .set(as(guardToken))
      .send({
        deviceNow: new Date().toISOString(),
        events: [one, two, event({ gateId: randomUUID() })],
      })
      .expect(200);
    expect(second.body.data.accepted).toBe(0);
    expect(second.body.data.duplicates).toBe(2);
    expect(second.body.data.rejected).toEqual([
      expect.objectContaining({ code: 'GATE_NOT_FOUND' }),
    ]);
    const rows = await stack.db.owner.query(
      `select clock_skewed, offline from tenant.gate_events where pass_id = $1`,
      [pass.id],
    );
    expect(rows.rows).toEqual([
      { clock_skewed: true, offline: true },
      { clock_skewed: true, offline: true },
    ]);
    const stored = await stack.db.owner.query(
      `select uses_count from tenant.visitor_passes where id = $1`,
      [pass.id],
    );
    expect(stored.rows[0].uses_count).toBe(1);
  });

  it('walk-ins reach the household, need approval and time out to a non-entry', async () => {
    const unitId = (
      await stack.db.owner.query(
        `select id from tenant.spaces where estate_id = $1 and code = 'V1'`,
        [estateId],
      )
    ).rows[0].id;
    const walkin = await stack.http
      .post(url('/walkins'))
      .set(as(guardToken))
      .send({ gateId, spaceId: unitId, visitorName: 'Delivery Dan', purpose: 'Parcel' })
      .expect(201);
    expect(walkin.body.data.status).toBe('pending');
    expect(
      await countRows(
        stack.db.owner,
        `select count(*) from platform.outbox_events where type = 'notifications.request.created' and payload->>'dedupeKey' = $1`,
        [`walkin:${walkin.body.data.id}`],
      ),
    ).toBe(1);
    // Entry before approval is refused.
    await stack.http
      .post(url('/gate/events'))
      .set(as(guardToken))
      .send(event({ walkinId: walkin.body.data.id }))
      .expect(422);
    // The member without inviteVisitors cannot answer; the host can.
    await stack.http
      .post(url(`/walkins/${walkin.body.data.id}/approve`))
      .set(as(memberToken))
      .expect(404);
    await stack.http
      .post(url(`/walkins/${walkin.body.data.id}/approve`))
      .set(as(hostToken))
      .expect(200);
    await stack.http
      .post(url('/gate/events'))
      .set(as(guardToken))
      .send(event({ walkinId: walkin.body.data.id }))
      .expect(201);

    const late = await stack.http
      .post(url('/walkins'))
      .set(as(guardToken))
      .send({ gateId, spaceId: unitId, visitorName: 'Late Larry' })
      .expect(201);
    await stack.db.owner.query(
      `update tenant.walkin_requests set expires_at = now() - interval '1 second' where id = $1`,
      [late.body.data.id],
    );
    const status = await stack.http
      .get(url(`/walkins/${late.body.data.id}`))
      .set(as(guardToken))
      .expect(200);
    expect(status.body.data.status).toBe('timed_out');
    await stack.http
      .post(url(`/walkins/${late.body.data.id}/approve`))
      .set(as(hostToken))
      .expect(409);
  });

  it('restricted visitors are denied; shares go out by SMS; ending the occupancy revokes passes', async () => {
    await stack.http
      .post(url('/restricted-visitors'))
      .set(as(managerToken))
      .send({ phone: '+2348039000077', reason: 'Previous theft' })
      .expect(403); // managers lack security.staff.manage
    const supervisor = await staff(estateId, '+2348039000005', 'security_supervisor');
    await stack.http
      .post(url('/restricted-visitors'))
      .set(as(supervisor))
      .send({ phone: '+2348039000077', reason: 'Previous theft' })
      .expect(201);
    const banned = (
      await invite(hostToken, {
        visitors: [{ name: 'Bad Actor', phone: '+2348039000077' }],
      }).expect(201)
    ).body.data[0];
    const verdict = await stack.http
      .post(url('/gate/verify'))
      .set(as(guardToken))
      .send({ gateId, pin: banned.pin })
      .expect(200);
    expect(verdict.body.data).toMatchObject({ decision: 'deny', reasons: ['restricted_visitor'] });

    const recurring = (
      await invite(hostToken, {
        type: 'recurring',
        validTo: soon(60 * 24 * 7),
        recurrence: { days: [0, 1, 2, 3, 4, 5, 6], from: '00:00', to: '23:59' },
        visitors: [{ name: 'Weekly Wale', phone: '+2348039000088' }],
      }).expect(201)
    ).body.data[0];
    await stack.http
      .post(url(`/visitor-passes/${recurring.id}/share`))
      .set(as(hostToken))
      .expect(202);
    await waitFor(async () => {
      await relay.relayBatch();
      return workerSms.lastTo('+2348039000088') !== undefined;
    });
    expect(workerSms.lastTo('+2348039000088')?.body).toContain(recurring.pin);

    await stack.http
      .post(url(`/occupancies/${occupancyId}/end`))
      .set(as(managerToken))
      .send({ reason: 'Moved out' })
      .expect(200);
    await waitFor(async () => {
      await relay.relayBatch();
      const rows = await stack.db.owner.query(
        `select revoked_at from tenant.visitor_passes where id = $1`,
        [recurring.id],
      );
      return rows.rows[0].revoked_at !== null;
    });
    const verifyAfter = await stack.http
      .post(url('/gate/verify'))
      .set(as(guardToken))
      .send({ gateId, qr: recurring.qr })
      .expect(200);
    expect(verifyAfter.body.data.reasons).toEqual(['revoked']);
  });
});
