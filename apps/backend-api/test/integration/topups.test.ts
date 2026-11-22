import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../../src/common/ids/uuidv7';
import { FakeTopUpProvider, TopUpProvider } from '../../src/integrations/bills/topup-provider';
import { FakePaymentGateway } from '../../src/integrations/payments/fake-payment.gateway';
import { PaymentGateway } from '../../src/integrations/payments/payment-gateway';
import { TopupsService } from '../../src/modules/utilities/topups/topups.service';
import { signIn, startTestStack, type TestStack } from './support/app';

/** Airtime and data (ADR-0025) on real Postgres: paid, delivered, pending then requeried, refunded. */
describe('airtime and data', () => {
  let stack: TestStack;
  let gateway: FakePaymentGateway;
  let provider: FakeTopUpProvider;
  let topups: TopupsService;
  let estateId: string;
  let estateB: string;
  let resident: string;
  let outsider: string;
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const url = (path = '') => `/v1/estates/${estateId}/topups${path}`;
  const buy = (body: Record<string, unknown>, key = uuidv7()) =>
    stack.http.post(url()).set(as(resident)).set('Idempotency-Key', key).send(body);
  const pay = async (id: string) => {
    const reference = [...gateway.charges.entries()].find(
      ([, c]) => c.input.metadata.topupId === id,
    )?.[0];
    if (!reference) throw new Error('no charge');
    gateway.complete(reference);
    return stack.http
      .post(url(`/${id}/verify`))
      .set(as(resident))
      .expect(200);
  };

  beforeAll(async () => {
    stack = await startTestStack();
    gateway = stack.app.get(PaymentGateway) as FakePaymentGateway;
    provider = stack.app.get(TopUpProvider) as FakeTopUpProvider;
    topups = stack.app.get(TopupsService);
    estateId = await stack.createEstate('Topup Estate');
    estateB = await stack.createEstate('Other Estate');
    await stack.addMember(estateId, await stack.createUser('+2348090000010'), 'tenant');
    resident = (await signIn(stack, '+2348090000010')).accessToken;
    await stack.addMember(estateB, await stack.createUser('+2348090000011'), 'tenant');
    outsider = (await signIn(stack, '+2348090000011')).accessToken;
  }, 300_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('sells airtime on Safezone’s account and delivers it after the payment is verified', async () => {
    expect(
      (await stack.http.get(url('/limits')).set(as(resident)).expect(200)).body.data,
    ).toMatchObject({
      available: true,
      airtimeMinKobo: 5_000,
    });
    expect(
      (
        await buy({
          kind: 'airtime',
          network: 'mtn',
          phone: '08031234567',
          amountKobo: 4_000,
        }).expect(422)
      ).body.error.code,
    ).toBe('AMOUNT_INVALID');
    const key = uuidv7();
    const started = await buy(
      { kind: 'airtime', network: 'mtn', phone: '08031234567', amountKobo: 50_000, saveCard: true },
      key,
    ).expect(201);
    expect(started.body.data).toMatchObject({
      status: 'created',
      totalKobo: 50_000,
      phone: '+2348031234567',
    });
    expect(
      (
        await buy(
          { kind: 'airtime', network: 'mtn', phone: '08031234567', amountKobo: 50_000 },
          key,
        ).expect(201)
      ).body.data.id,
    ).toBe(started.body.data.id);
    const charge = [...gateway.charges.values()].find(
      (c) => c.input.metadata.topupId === started.body.data.id,
    );
    expect(charge?.input.subaccountCode).toBeNull();

    expect((await pay(started.body.data.id)).body.data.status).toBe('paid');
    await topups.deliver(estateId, started.body.data.id);
    const done = await stack.http
      .get(url(`/${started.body.data.id}`))
      .set(as(resident))
      .expect(200);
    expect(done.body.data.status).toBe('delivered');
    const request = [...provider.requests.values()].at(-1);
    expect(request).toMatchObject({ phone: '+2348031234567', amountKobo: 50_000 });
  });

  it('prices data from the plan, never from the client, and pays with the saved card', async () => {
    const plans = await stack.http
      .get(url('/data-plans?network=glo'))
      .set(as(resident))
      .expect(200);
    const plan = plans.body.data.find((p: { amountKobo: number }) => p.amountKobo === 50_000);
    await buy({
      kind: 'data',
      network: 'glo',
      phone: '08031234567',
      planCode: 'glo-nonexistent',
    }).expect(422);
    const card = (await stack.http.get('/v1/me/payment-methods').set(as(resident)).expect(200)).body
      .data[0];
    const bought = await buy({
      kind: 'data',
      network: 'glo',
      phone: '08031234567',
      planCode: plan.code,
      amountKobo: 1,
      paymentMethodId: card.id,
    }).expect(201);
    expect(bought.body.data).toMatchObject({
      status: 'paid',
      totalKobo: 50_000,
      planName: plan.name,
      authorizationUrl: null,
    });
    await topups.deliver(estateId, bought.body.data.id);
    expect(
      (
        await stack.http
          .get(url(`/${bought.body.data.id}`))
          .set(as(resident))
          .expect(200)
      ).body.data.status,
    ).toBe('delivered');
  });

  it('requeries a pending delivery instead of refunding it', async () => {
    const started = await buy({
      kind: 'airtime',
      network: 'airtel',
      phone: '08031239999',
      amountKobo: 20_000,
    }).expect(201);
    await pay(started.body.data.id);
    await topups.deliver(estateId, started.body.data.id);
    expect(
      (
        await stack.http
          .get(url(`/${started.body.data.id}`))
          .set(as(resident))
          .expect(200)
      ).body.data.status,
    ).toBe('delivering');
    await topups.requery(estateId, started.body.data.id);
    expect(
      (
        await stack.http
          .get(url(`/${started.body.data.id}`))
          .set(as(resident))
          .expect(200)
      ).body.data.status,
    ).toBe('delivering');
    const requestId = [...provider.requests.entries()].find(
      ([, r]) => r.phone === '+2348031239999',
    )?.[0];
    if (!requestId) throw new Error('no request');
    provider.settle(requestId);
    await topups.requery(estateId, started.body.data.id);
    expect(
      (
        await stack.http
          .get(url(`/${started.body.data.id}`))
          .set(as(resident))
          .expect(200)
      ).body.data.status,
    ).toBe('delivered');
  });

  it('refunds in full when the aggregator fails the delivery', async () => {
    const started = await buy({
      kind: 'airtime',
      network: 'glo',
      phone: '08031230000',
      amountKobo: 10_000,
    }).expect(201);
    await pay(started.body.data.id);
    await topups.deliver(estateId, started.body.data.id);
    expect(
      (
        await stack.http
          .get(url(`/${started.body.data.id}`))
          .set(as(resident))
          .expect(200)
      ).body.data.status,
    ).toBe('refund_pending');
    expect(await topups.refund(estateId, started.body.data.id)).toBe('refunded');
    expect(await topups.refund(estateId, started.body.data.id)).toBe('skip');
    const reference = [...gateway.charges.entries()].find(
      ([, c]) => c.input.metadata.topupId === started.body.data.id,
    )?.[0];
    expect(gateway.refunds).toContainEqual({ transactionReference: reference, amountKobo: 10_000 });
    expect(
      (
        await stack.http
          .get(url(`/${started.body.data.id}`))
          .set(as(resident))
          .expect(200)
      ).body.data.status,
    ).toBe('refunded');
  });

  it('keeps purchases private to the buyer and the estate', async () => {
    const mine = await stack.http.get(url()).set(as(resident)).expect(200);
    expect(mine.body.data.length).toBe(4);
    await stack.http.get(url()).set(as(outsider)).expect(404);
    expect(
      (await stack.http.get(`/v1/estates/${estateB}/topups`).set(as(outsider)).expect(200)).body
        .data,
    ).toEqual([]);
    await stack.http
      .get(`/v1/estates/${estateB}/topups/${mine.body.data[0].id}`)
      .set(as(outsider))
      .expect(404);
  });
});
