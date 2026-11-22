import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../../src/common/ids/uuidv7';
import { FakePaymentGateway } from '../../src/integrations/payments/fake-payment.gateway';
import { PaymentGateway } from '../../src/integrations/payments/payment-gateway';
import { countRows, signIn, startTestStack, type TestStack, WEB_DEVICE } from './support/app';

/** Safezone Pay: saved cards and transfers between residents (ADR-0025), on real Postgres. */
describe('safezone pay', () => {
  let stack: TestStack;
  let gateway: FakePaymentGateway;
  let estateA: string;
  let estateB: string;
  let ada: string;
  let bayo: string;
  let chidi: string;
  let bayoId: string;
  let cardId: string;
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const send = (token: string, estateId: string, body: Record<string, unknown>, key = uuidv7()) =>
    stack.http
      .post(`/v1/estates/${estateId}/transfers`)
      .set(as(token))
      .set('Idempotency-Key', key)
      .send(body);

  async function resident(
    estateId: string,
    manager: string,
    code: string,
    phone: string,
    name: string,
  ) {
    const unit = (
      await stack.http
        .post(`/v1/estates/${estateId}/spaces`)
        .set(as(manager))
        .send({ type: 'unit', code })
        .expect(201)
    ).body.data.id as string;
    await stack.http
      .post(`/v1/estates/${estateId}/occupancies`)
      .set(as(manager))
      .send({ spaceId: unit, type: 'tenant', head: { fullName: name, phone } })
      .expect(201);
    return signIn(stack, phone);
  }

  beforeAll(async () => {
    stack = await startTestStack();
    gateway = stack.app.get(PaymentGateway) as FakePaymentGateway;
    estateA = await stack.createEstate('Pay Estate A');
    estateB = await stack.createEstate('Pay Estate B');
    await stack.addMember(
      estateA,
      await stack.createUser('+2348070000001'),
      'estate_administrator',
    );
    await stack.addMember(
      estateB,
      await stack.createUser('+2348070000002'),
      'estate_administrator',
    );
    const managerA = (await signIn(stack, '+2348070000001', WEB_DEVICE)).accessToken;
    const managerB = (await signIn(stack, '+2348070000002', WEB_DEVICE)).accessToken;
    await stack.db.owner.query(`update platform.sessions set mfa_verified_at = now()`);
    ada = (await resident(estateA, managerA, 'P-1', '+2348070000010', 'Ada Obi')).accessToken;
    const b = await resident(estateA, managerA, 'P-2', '+2348070000011', 'Bayo Ade');
    bayo = b.accessToken;
    bayoId = b.user.id;
    chidi = (await resident(estateB, managerB, 'Q-1', '+2348070000012', 'Chidi Eze')).accessToken;
  }, 300_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('links a payout account keeping only the last 4 digits, and finds recipients by unit', async () => {
    expect(
      (await stack.http.get('/v1/me/payout-account').set(as(bayo)).expect(200)).body.data,
    ).toBeNull();
    // Nobody in P-2 accepts transfers yet.
    expect(
      (
        await stack.http
          .get(`/v1/estates/${estateA}/transfers/recipients?unit=P-2`)
          .set(as(ada))
          .expect(200)
      ).body.data,
    ).toEqual([]);
    const linked = await stack.http
      .put('/v1/me/payout-account')
      .set(as(bayo))
      .send({ bankCode: '058', accountNumber: '0123456789' })
      .expect(200);
    expect(linked.body.data).toMatchObject({
      bankName: 'Guaranty Trust Bank',
      accountLast4: '6789',
      acceptTransfers: true,
    });
    expect(JSON.stringify(linked.body)).not.toContain('0123456789');

    const found = await stack.http
      .get(`/v1/estates/${estateA}/transfers/recipients?unit=p-2`)
      .set(as(ada))
      .expect(200);
    expect(found.body.data).toEqual([{ userId: bayoId, firstName: 'Bayo' }]);
    expect(JSON.stringify(found.body)).not.toContain('+234');
    // Bayo looking up his own unit does not find himself.
    expect(
      (
        await stack.http
          .get(`/v1/estates/${estateA}/transfers/recipients?unit=P-2`)
          .set(as(bayo))
          .expect(200)
      ).body.data,
    ).toEqual([]);
  });

  it('sends money through checkout to the recipient’s subaccount and saves the card when asked', async () => {
    const key = uuidv7();
    const started = await send(
      ada,
      estateA,
      { recipientUserId: bayoId, amountKobo: 500_000, note: 'Fan', saveCard: true },
      key,
    ).expect(201);
    expect(started.body.data).toMatchObject({
      direction: 'sent',
      status: 'created',
      counterpartyFirstName: 'Bayo',
    });
    expect(started.body.data.authorizationUrl).toEqual(expect.any(String));
    const again = await send(
      ada,
      estateA,
      { recipientUserId: bayoId, amountKobo: 500_000 },
      key,
    ).expect(201);
    expect(again.body.data.id).toBe(started.body.data.id);

    const reference = [...gateway.charges.keys()].find((k) => k.startsWith('sz_tr_'));
    if (!reference) throw new Error('no transfer charge');
    const charge = gateway.charges.get(reference);
    expect(charge?.input.subaccountCode).toMatch(/^ACCT_fake_6789_/);
    expect(charge?.input.transactionChargeKobo ?? 0).toBe(0);
    gateway.complete(reference);
    const paid = await stack.http
      .post(`/v1/estates/${estateA}/transfers/${started.body.data.id}/verify`)
      .set(as(ada))
      .expect(200);
    expect(paid.body.data.status).toBe('paid');

    const cards = await stack.http.get('/v1/me/payment-methods').set(as(ada)).expect(200);
    expect(cards.body.data).toEqual([expect.objectContaining({ brand: 'visa', last4: '4081' })]);
    expect(JSON.stringify(cards.body)).not.toContain('AUTH_fake');
    cardId = cards.body.data[0].id;
    expect(
      await countRows(
        stack.db.owner,
        `select count(*) from platform.payment_methods where authorization_wrapped like 'AUTH%'`,
      ),
    ).toBe(0);
    // Another user cannot see or remove Ada's card.
    expect(
      (await stack.http.get('/v1/me/payment-methods').set(as(bayo)).expect(200)).body.data,
    ).toEqual([]);
    await stack.http.delete(`/v1/me/payment-methods/${cardId}`).set(as(bayo)).expect(404);
  });

  it('pays with the saved card in one step, and waits when the provider leaves it pending', async () => {
    const quick = await send(ada, estateA, {
      recipientUserId: bayoId,
      amountKobo: 200_000,
      paymentMethodId: cardId,
    }).expect(201);
    expect(quick.body.data).toMatchObject({ status: 'paid', authorizationUrl: null });

    const auth = [...gateway.authorizations.keys()][0];
    if (!auth) throw new Error('no authorization');
    gateway.pendingAuthorizations.add(auth);
    const pending = await send(ada, estateA, {
      recipientUserId: bayoId,
      amountKobo: 100_000,
      paymentMethodId: cardId,
    }).expect(201);
    expect(pending.body.data.status).toBe('created');
    gateway.pendingAuthorizations.delete(auth);
    const reference = [...gateway.charges.entries()].find(
      ([, c]) => c.input.metadata.transferId === pending.body.data.id,
    )?.[0];
    if (!reference) throw new Error('no pending charge');
    gateway.complete(reference);
    const settled = await stack.http
      .post(`/v1/estates/${estateA}/transfers/${pending.body.data.id}/verify`)
      .set(as(ada))
      .expect(200);
    expect(settled.body.data.status).toBe('paid');

    const received = await stack.http
      .get(`/v1/estates/${estateA}/transfers`)
      .set(as(bayo))
      .expect(200);
    expect(
      received.body.data.map((t: { direction: string; counterpartyFirstName: string }) => [
        t.direction,
        t.counterpartyFirstName,
      ]),
    ).toEqual([
      ['received', 'Ada'],
      ['received', 'Ada'],
      ['received', 'Ada'],
    ]);
    expect(
      await countRows(
        stack.db.owner,
        `select count(*) from platform.outbox_events where type = 'notifications.request.created' and payload->>'intent' = 'payments.transfer_received'`,
      ),
    ).toBe(3);
  });

  it('refuses transfers across estates, to self, outside limits and to people who turned it off', async () => {
    await send(chidi, estateB, { recipientUserId: bayoId, amountKobo: 100_000 }).expect(404);
    await stack.http.get(`/v1/estates/${estateA}/transfers`).set(as(chidi)).expect(404);
    expect(
      (await send(bayo, estateA, { recipientUserId: bayoId, amountKobo: 100_000 }).expect(422)).body
        .error.code,
    ).toBe('TRANSFER_TO_SELF');
    await send(ada, estateA, { recipientUserId: bayoId, amountKobo: 5_000 }).expect(400);
    await stack.http
      .post(`/v1/estates/${estateA}/transfers`)
      .set(as(ada))
      .send({ recipientUserId: bayoId, amountKobo: 100_000 })
      .expect(400);

    await stack.http
      .patch('/v1/me/payout-account')
      .set(as(bayo))
      .send({ acceptTransfers: false })
      .expect(200);
    expect(
      (await send(ada, estateA, { recipientUserId: bayoId, amountKobo: 100_000 }).expect(404)).body
        .error.code,
    ).toBe('RECIPIENT_UNAVAILABLE');
    await stack.http
      .patch('/v1/me/payout-account')
      .set(as(bayo))
      .send({ acceptTransfers: true })
      .expect(200);
  });

  it('removes a saved card, after which it cannot be charged', async () => {
    const left = await stack.http
      .delete(`/v1/me/payment-methods/${cardId}`)
      .set(as(ada))
      .expect(200);
    expect(left.body.data).toEqual([]);
    expect(
      (
        await send(ada, estateA, {
          recipientUserId: bayoId,
          amountKobo: 100_000,
          paymentMethodId: cardId,
        }).expect(404)
      ).body.error.code,
    ).toBe('PAYMENT_METHOD_NOT_FOUND');
  });
});
