import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OutboxRelay } from '../../src/common/outbox/outbox-relay';
import { FakePushSender, PushSender } from '../../src/integrations/push/push-sender';
import { FakeSmsSender } from '../../src/integrations/sms/fake-sms.sender';
import { SmsSender } from '../../src/integrations/sms/sms-sender';
import { DeliveryService } from '../../src/modules/notifications/delivery.service';
import { WorkerModule } from '../../src/worker/worker.module';
import { countRows, signIn, startTestStack, type TestStack } from './support/app';

async function waitFor(check: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('condition not met in time');
}

describe('notifications core', () => {
  let stack: TestStack;
  let worker: INestApplicationContext;
  let relay: OutboxRelay;
  let delivery: DeliveryService;
  const push = new FakePushSender();
  const workerSms = new FakeSmsSender();

  beforeAll(async () => {
    stack = await startTestStack();
    process.env.OUTBOX_RELAY_DISABLED = 'true';
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(PushSender)
      .useValue(push)
      .overrideProvider(SmsSender)
      .useValue(workerSms)
      .compile();
    worker = moduleRef.createNestApplication();
    await (worker as unknown as { init(): Promise<void> }).init();
    relay = worker.get(OutboxRelay);
    delivery = worker.get(DeliveryService);
  });

  afterAll(async () => {
    await worker?.close();
    await stack?.stop();
  });

  it('alerts the user on refresh-token reuse: push when registered, in-app always', async () => {
    const session = await signIn(stack, '+2348033000001');
    const auth = { Authorization: `Bearer ${session.accessToken}` };
    await stack.http
      .post('/v1/me/push-tokens')
      .set(auth)
      .send({ token: 'ExponentPushToken[abc123]', app: 'resident-mobile' })
      .expect(200);
    await stack.http
      .post('/v1/me/push-tokens')
      .set(auth)
      .send({ token: 'not-a-token', app: 'resident-mobile' })
      .expect(400);

    const rotated = await stack.http
      .post('/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(200);
    await stack.http
      .post('/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(401);
    expect(rotated.body.data.accessToken).toBeTypeOf('string');

    while ((await relay.relayBatch()) > 0) {
      /* drain */
    }
    await waitFor(async () => push.sent.some((m) => m.to === 'ExponentPushToken[abc123]'));
    expect(push.sent.at(-1)).toMatchObject({
      title: 'Security alert',
      priority: 'high',
      channelId: 'critical',
    });
    // Push was accepted, so no SMS fallback.
    expect(workerSms.lastTo('+2348033000001')).toBeUndefined();

    // The session was revoked, so read the centre with a fresh sign-in.
    await stack.resetRateLimits();
    const fresh = await signIn(stack, '+2348033000001');
    const list = await stack.http
      .get('/v1/me/notifications')
      .set({ Authorization: `Bearer ${fresh.accessToken}` })
      .expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({
      intent: 'account.security_alert',
      priority: 'critical',
      readAt: null,
    });

    await stack.http
      .post(`/v1/me/notifications/${list.body.data[0].id}/read`)
      .set({ Authorization: `Bearer ${fresh.accessToken}` })
      .expect(204);
    const after = await stack.http
      .get('/v1/me/notifications')
      .set({ Authorization: `Bearer ${fresh.accessToken}` })
      .expect(200);
    expect(after.body.data[0].readAt).not.toBeNull();
  });

  it('falls back to SMS for critical intents when there is no push token, and never duplicates', async () => {
    const session = await signIn(stack, '+2348033000002');
    await stack.http
      .post('/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(200);
    await stack.http
      .post('/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(401);
    while ((await relay.relayBatch()) > 0) {
      /* drain */
    }
    await waitFor(async () => workerSms.lastTo('+2348033000002') !== undefined);
    expect(workerSms.lastTo('+2348033000002')?.body).toMatch(/^Safezone: we signed out a device/);

    // Re-delivering the same request is a no-op.
    await delivery.deliver({
      intent: 'account.security_alert',
      userIds: [session.user.id],
      estateId: null,
      data: {},
      dedupeKey: (
        await stack.db.owner.query(
          `select dedupe_key from platform.notifications where user_id = $1`,
          [session.user.id],
        )
      ).rows[0].dedupe_key,
    });
    expect(
      await countRows(
        stack.db.owner,
        `select count(*) from platform.notifications where user_id = $1`,
        [session.user.id],
      ),
    ).toBe(1);
    expect(workerSms.sent.filter((m) => m.to === '+2348033000002')).toHaveLength(1);
  });

  it('processes Expo receipts and drops dead tokens', async () => {
    const pushRow = (
      await stack.db.owner.query(
        `select d.id, d.provider_ref, d.to_address from platform.notification_deliveries d where d.channel = 'push' limit 1`,
      )
    ).rows[0];
    push.receiptsById.set(pushRow.provider_ref, { status: 'error', error: 'DeviceNotRegistered' });
    await stack.db.owner.query(
      `update platform.notification_deliveries set sent_at = now() - interval '5 minutes' where id = $1`,
      [pushRow.id],
    );

    expect(await delivery.checkPushReceipts()).toBe(1);
    const token = await stack.db.owner.query(
      `select invalid_at from platform.push_tokens where id = $1`,
      [pushRow.to_address],
    );
    expect(token.rows[0].invalid_at).not.toBeNull();
    const status = await stack.db.owner.query(
      `select status, error from platform.notification_deliveries where id = $1`,
      [pushRow.id],
    );
    expect(status.rows[0]).toEqual({ status: 'failed', error: 'DeviceNotRegistered' });
  });

  it('refuses to turn off mandatory categories', async () => {
    await stack.resetRateLimits();
    const session = await signIn(stack, '+2348033000003');
    const response = await stack.http
      .put('/v1/me/notification-preferences')
      .set({ Authorization: `Bearer ${session.accessToken}` })
      .send([{ category: 'security', channel: 'push', enabled: false }])
      .expect(422);
    expect(response.body.error.code).toBe('PREFERENCE_MANDATORY');
  });
});
