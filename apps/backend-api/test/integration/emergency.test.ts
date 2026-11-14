import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OutboxRelay } from '../../src/common/outbox/outbox-relay';
import { EmailSender, FakeEmailSender } from '../../src/integrations/email/email-sender';
import { FakePushSender, PushSender } from '../../src/integrations/push/push-sender';
import { FakeSmsSender } from '../../src/integrations/sms/fake-sms.sender';
import { SmsSender } from '../../src/integrations/sms/sms-sender';
import { SosConsumer } from '../../src/modules/emergency/sos.consumer';
import { WorkerModule } from '../../src/worker/worker.module';
import { countRows, signIn, startTestStack, type TestStack, WEB_DEVICE } from './support/app';

async function waitFor(check: () => Promise<boolean>, timeoutMs = 20_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('condition not met in time');
}

describe('emergency: SOS', () => {
  let stack: TestStack;
  let worker: INestApplicationContext;
  let relay: OutboxRelay;
  let sosWorker: SosConsumer;
  const workerSms = new FakeSmsSender();
  let estateId: string;
  let guardToken: string;
  let supervisorToken: string;
  let managerToken: string;
  let residentToken: string;
  let kidToken: string;
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const url = (path: string) => `/v1/estates/${estateId}${path}`;
  const sos = (token: string, body: Record<string, unknown> = {}, key: string = randomUUID()) =>
    stack.http.post(url('/sos')).set(as(token)).set('Idempotency-Key', key).send(body);

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

  beforeAll(async () => {
    stack = await startTestStack();
    process.env.OUTBOX_RELAY_DISABLED = 'true';
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(SmsSender)
      .useValue(workerSms)
      .overrideProvider(PushSender)
      .useValue(new FakePushSender())
      .overrideProvider(EmailSender)
      .useValue(new FakeEmailSender())
      .compile();
    worker = moduleRef.createNestApplication();
    await (worker as unknown as { init(): Promise<void> }).init();
    relay = worker.get(OutboxRelay);
    sosWorker = worker.get(SosConsumer);

    estateId = await stack.createEstate('SOS Estate');
    guardToken = await staff('+2348031000001', 'security_officer');
    supervisorToken = await staff('+2348031000002', 'security_supervisor');
    managerToken = await staff('+2348031000003', 'estate_manager');
    const unit = await stack.http
      .post(url('/spaces'))
      .set(as(managerToken))
      .send({ type: 'unit', code: 'S1', unitType: 'house' })
      .expect(201);
    const household = await stack.http
      .post(url('/occupancies'))
      .set(as(managerToken))
      .send({
        spaceId: unit.body.data.id,
        type: 'owner_occupier',
        head: { fullName: 'Rita Resident', phone: '+2348031000010' },
      })
      .expect(201);
    residentToken = (await signIn(stack, '+2348031000010')).accessToken;
    await stack.http
      .post(url(`/households/${household.body.data.id}/members`))
      .set(as(residentToken))
      .send({
        fullName: 'Kid Member',
        phone: '+2348031000011',
        relationship: 'child',
        permissions: { triggerSos: false },
      })
      .expect(201);
    kidToken = (await signIn(stack, '+2348031000011')).accessToken;
    await stack.http
      .post('/v1/me/emergency-contacts')
      .set(as(residentToken))
      .send({
        name: 'Brother',
        phone: '+2348031000099',
        relationship: 'brother',
        consentConfirmed: true,
      })
      .expect(201);
  });

  afterAll(async () => {
    await worker?.close();
    await stack?.stop();
  });

  it('fans out to guards and contacts, is idempotent, and keeps one active alert per household', async () => {
    await stack.http.post(url('/sos')).set(as(residentToken)).send({}).expect(400);
    await sos(kidToken).expect(403);

    const key = randomUUID();
    const started = Date.now();
    const alert = await sos(
      residentToken,
      { category: 'security_threat', location: { lat: 6.45, lng: 3.47, accuracyM: 12 } },
      key,
    ).expect(201);
    expect(Date.now() - started).toBeLessThan(1500);
    expect(alert.body.data).toMatchObject({
      status: 'triggered',
      unitCode: 'S1',
      reused: false,
      isDrill: false,
    });
    const replay = await sos(residentToken, { category: 'security_threat' }, key).expect(201);
    expect(replay.body.data).toMatchObject({ id: alert.body.data.id, reused: true });
    const again = await sos(residentToken, { category: 'medical' }).expect(201);
    expect(again.body.data).toMatchObject({ id: alert.body.data.id, reused: true });

    await waitFor(async () => {
      await relay.relayBatch();
      return (
        workerSms.lastTo('+2348031000001') !== undefined &&
        workerSms.lastTo('+2348031000099') !== undefined
      );
    });
    expect(workerSms.lastTo('+2348031000001')?.body).toMatch(/SOS: security threat at unit S1/);
    expect(workerSms.lastTo('+2348031000002')).toBeDefined();
    expect(workerSms.lastTo('+2348031000099')?.body).toContain('Rita Resident');

    // Guards see it with the emergency contacts while it is active; the resident sees their own.
    const active = await stack.http.get(url('/sos')).set(as(guardToken)).expect(200);
    expect(active.body.data.map((item: { id: string }) => item.id)).toContain(alert.body.data.id);
    const detail = await stack.http
      .get(url(`/sos/${alert.body.data.id}`))
      .set(as(guardToken))
      .expect(200);
    expect(detail.body.data.emergencyContacts).toEqual([
      { name: 'Brother', phone: '+2348031000099', relationship: 'brother' },
    ]);
    expect(detail.body.data.timeline.map((event: { type: string }) => event.type)).toEqual(
      expect.arrayContaining(['triggered', 'retriggered', 'notified']),
    );
    const own = await stack.http
      .get(url(`/sos/${alert.body.data.id}`))
      .set(as(residentToken))
      .expect(200);
    expect(own.body.data.emergencyContacts).toBeNull();

    // Escalation fires while unacknowledged and stops once acknowledged.
    await sosWorker.escalate(estateId, alert.body.data.id, 1);
    await stack.http
      .post(url(`/sos/${alert.body.data.id}/acknowledge`))
      .set(as(residentToken))
      .expect(403);
    await stack.http
      .post(url(`/sos/${alert.body.data.id}/acknowledge`))
      .set(as(guardToken))
      .expect(200);
    await stack.http
      .post(url(`/sos/${alert.body.data.id}/cancel`))
      .set(as(residentToken))
      .expect(409);
    await sosWorker.escalate(estateId, alert.body.data.id, 2);
    expect(
      await countRows(
        stack.db.owner,
        `select count(*) from tenant.sos_events where alert_id = $1 and type = 'escalated'`,
        [alert.body.data.id],
      ),
    ).toBe(1);

    await stack.http
      .post(url(`/sos/${alert.body.data.id}/responding`))
      .set(as(guardToken))
      .expect(200);
    await stack.http
      .post(url(`/sos/${alert.body.data.id}/location`))
      .set(as(residentToken))
      .send({ lat: 6.451, lng: 3.471 })
      .expect(200);
    await stack.http
      .post(url(`/sos/${alert.body.data.id}/resolve`))
      .set(as(guardToken))
      .send({ resolution: 'Intruder left; patrol increased' })
      .expect(200);
    // Location is not collected after resolution.
    await stack.http
      .post(url(`/sos/${alert.body.data.id}/location`))
      .set(as(residentToken))
      .send({ lat: 6.452, lng: 3.472 })
      .expect(409);
    await stack.http
      .post(url(`/sos/${alert.body.data.id}/close`))
      .set(as(guardToken))
      .send({})
      .expect(403);
    const closed = await stack.http
      .post(url(`/sos/${alert.body.data.id}/close`))
      .set(as(supervisorToken))
      .send({ notes: 'Reviewed' })
      .expect(200);
    expect(closed.body.data.status).toBe('closed');
    // The timeline cannot be edited.
    await expect(
      stack.db.owner.query(`delete from tenant.sos_events where alert_id = $1`, [
        alert.body.data.id,
      ]),
    ).rejects.toThrow();
  });

  it('drills never contact outside people; the triggerer can cancel before acknowledgement', async () => {
    await sos(residentToken, { isDrill: true }).expect(403);
    const before = workerSms.sent.filter((message) => message.to === '+2348031000099').length;
    const drill = await sos(supervisorToken, { isDrill: true, category: 'fire' }).expect(201);
    await waitFor(async () => {
      await relay.relayBatch();
      return (
        (await countRows(
          stack.db.owner,
          `select count(*) from tenant.sos_events where alert_id = $1 and type = 'notified'`,
          [drill.body.data.id],
        )) === 1
      );
    });
    expect(workerSms.lastTo('+2348031000001')?.body).toContain('DRILL');
    await sosWorker.escalate(estateId, drill.body.data.id, 2); // contacts step: skipped for drills
    expect(workerSms.sent.filter((message) => message.to === '+2348031000099').length).toBe(before);

    const mistake = await sos(residentToken, { category: 'general' }).expect(201);
    await stack.http
      .post(url(`/sos/${mistake.body.data.id}/cancel`))
      .set(as(guardToken))
      .expect(403);
    const cancelled = await stack.http
      .post(url(`/sos/${mistake.body.data.id}/cancel`))
      .set(as(residentToken))
      .expect(200);
    expect(cancelled.body.data.status).toBe('cancelled');
    await sosWorker.escalate(estateId, mistake.body.data.id, 0);
    expect(
      await countRows(
        stack.db.owner,
        `select count(*) from tenant.sos_events where alert_id = $1 and type = 'escalated'`,
        [mistake.body.data.id],
      ),
    ).toBe(0);
  });

  it('emergency broadcasts reach every member and need broadcast.emergency', async () => {
    await stack.http
      .post(url('/emergency-broadcasts'))
      .set(as(residentToken))
      .send({ title: 'Flooding', body: 'Avoid the main road.', confirm: true })
      .expect(403);
    await stack.http
      .post(url('/emergency-broadcasts'))
      .set(as(managerToken))
      .send({ title: 'Flooding', body: 'Avoid the main road.' })
      .expect(400);
    const sent = await stack.http
      .post(url('/emergency-broadcasts'))
      .set(as(managerToken))
      .send({ title: 'Flooding', body: 'Avoid the main road.', confirm: true })
      .expect(201);
    expect(sent.body.data.recipients).toBe(5);
  });
});
