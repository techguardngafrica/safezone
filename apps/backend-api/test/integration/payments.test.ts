import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakePaymentGateway } from '../../src/integrations/payments/fake-payment.gateway';
import { PaymentGateway } from '../../src/integrations/payments/payment-gateway';
import { PaymentsService } from '../../src/modules/payments/payments.service';
import { countRows, signIn, startTestStack, type TestStack, WEB_DEVICE } from './support/app';

describe('payments', () => {
  let stack: TestStack;
  let gateway: FakePaymentGateway;
  let estateId: string;
  let admin: string;
  let manager: string;
  let accountant: string;
  let resident: string;
  let residentId: string;
  let flatId: string;
  let invoiceId: string;
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

  function webhook(body: unknown, signature?: string) {
    const raw = JSON.stringify(body);
    return stack.http
      .post('/v1/webhooks/payments/fake')
      .set('Content-Type', 'application/json')
      .set('x-fake-signature', signature ?? gateway.sign(raw))
      .send(raw);
  }

  beforeAll(async () => {
    stack = await startTestStack();
    gateway = stack.app.get(PaymentGateway) as FakePaymentGateway;
    estateId = await stack.createEstate('Pay Estate');
    admin = await staff('+2348034000001', 'estate_administrator');
    manager = await staff('+2348034000002', 'estate_manager');
    accountant = await staff('+2348034000003', 'estate_accountant');
    flatId = (
      await stack.http
        .post(url('/spaces'))
        .set(as(admin))
        .send({ type: 'unit', code: 'B-2', unitType: 'flat' })
        .expect(201)
    ).body.data.id;
    await stack.http
      .post(url('/occupancies'))
      .set(as(manager))
      .send({
        spaceId: flatId,
        type: 'tenant',
        head: { fullName: 'Chidi Payer', phone: '+2348034000010' },
      })
      .expect(201);
    const session = await signIn(stack, '+2348034000010');
    resident = session.accessToken;
    residentId = session.user.id;
    invoiceId = (
      await stack.http
        .post(url('/invoices'))
        .set(as(accountant))
        .send({
          spaceId: flatId,
          description: 'Service charge',
          dueDate: '2027-06-30',
          lines: [{ description: 'Q1 service charge', unitAmount: 1_000_000 }],
        })
        .expect(201)
    ).body.data.id;
  }, 240_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('refuses checkout until the estate links a payout account, storing only the last 4 digits', async () => {
    await stack.http
      .post(url('/payment-intents'))
      .set(as(resident))
      .set('Idempotency-Key', 'key-before-setup')
      .send({})
      .expect(422);
    await stack.http
      .post(url('/payout-account'))
      .set(as(manager))
      .send({ bankCode: '058', accountNumber: '0123456789' })
      .expect(403);
    const linked = await stack.http
      .post(url('/payout-account'))
      .set(as(admin))
      .send({ bankCode: '058', accountNumber: '0123456789' })
      .expect(201);
    expect(linked.body.data).toMatchObject({
      accountLast4: '6789',
      bankName: 'Guaranty Trust Bank',
    });
    expect(
      await countRows(
        stack.db.owner,
        `select count(*) from tenant.payout_accounts where row_to_json(payout_accounts)::text like '%0123456789%'`,
      ),
    ).toBe(0);
  });

  let intentId: string;
  let reference: string;

  it('creates an idempotent intent with a server-computed amount', async () => {
    await stack.http.post(url('/payment-intents')).set(as(resident)).send({}).expect(400);
    const first = await stack.http
      .post(url('/payment-intents'))
      .set(as(resident))
      .set('Idempotency-Key', 'pay-attempt-0001')
      .send({ invoiceIds: [invoiceId] })
      .expect(201);
    expect(first.body.data).toMatchObject({ amount: 1_000_000, status: 'pending' });
    expect(first.body.data.authorizationUrl).toContain('checkout.fake.local');
    const again = await stack.http
      .post(url('/payment-intents'))
      .set(as(resident))
      .set('Idempotency-Key', 'pay-attempt-0001')
      .send({ invoiceIds: [invoiceId] })
      .expect(201);
    expect(again.body.data.id).toBe(first.body.data.id);
    intentId = first.body.data.id;
    reference = first.body.data.reference;
    await stack.http
      .post(url('/payment-intents'))
      .set(as(resident))
      .set('Idempotency-Key', 'pay-attempt-0002')
      .send({ callbackUrl: 'https://evil.example/return' })
      .expect(422);
  });

  it('rejects unsigned webhooks and records signed ones once', async () => {
    gateway.complete(reference);
    const body = { id: 'evt_1', event: 'charge.success', data: { reference } };
    await webhook(body, 'bad').expect(401);
    await stack.http.post('/v1/webhooks/payments/fake').send(body).expect(401);
    await stack.http.post('/v1/webhooks/payments/paystack').send(body).expect(404);
    await webhook(body).expect(200);
    await webhook(body).expect(200);
    expect(
      await countRows(
        stack.db.owner,
        `select count(*) from platform.payment_webhook_events where event_id = 'evt_1'`,
      ),
    ).toBe(1);
    expect(
      await countRows(
        stack.db.owner,
        `select count(*) from platform.outbox_events where type = 'payments.webhook.received'`,
      ),
    ).toBe(1);
  });

  it('marks the invoice paid only after server-side verification, exactly once', async () => {
    const pending = await stack.http
      .get(url(`/invoices/${invoiceId}`))
      .set(as(resident))
      .expect(200);
    expect(pending.body.data.status).toBe('issued');
    const payments = stack.app.get(PaymentsService);
    await payments.processWebhookEvent({
      provider: 'fake',
      eventId: 'evt_1',
      type: 'charge.success',
      reference,
    });
    const verified = await stack.http
      .post(url(`/payment-intents/${intentId}/verify`))
      .set(as(resident))
      .expect(200);
    expect(verified.body.data.status).toBe('succeeded');
    expect((await payments.processReference(reference)).outcome).toBe('duplicate');
    const paid = await stack.http
      .get(url(`/invoices/${invoiceId}`))
      .set(as(resident))
      .expect(200);
    expect(paid.body.data).toMatchObject({ status: 'paid', amountPaid: 1_000_000, balance: 0 });
    const mine = await stack.http.get(url('/transactions')).set(as(resident)).expect(200);
    expect(mine.body.data).toHaveLength(1);
    await expect(
      stack.db.owner.query(`update tenant.payment_transactions set amount = 1`),
    ).rejects.toThrow(/append-only/);
  });

  it('matches bank transfers to the payer through a dedicated account and holds credit', async () => {
    const account = await stack.http
      .post(url('/virtual-accounts'))
      .set(as(resident))
      .send({ spaceId: flatId })
      .expect(201);
    expect(account.body.data.accountNumber).toMatch(/^\d{10}$/);
    const again = await stack.http
      .post(url('/virtual-accounts'))
      .set(as(resident))
      .send({ spaceId: flatId })
      .expect(201);
    expect(again.body.data.id).toBe(account.body.data.id);
    const [customerCode] = [...gateway.accounts.keys()];
    const transferRef = gateway.transfer(customerCode as string, 500_000);
    const result = await stack.app.get(PaymentsService).processReference(transferRef);
    expect(result.outcome).toBe('recorded');
    const statement = await stack.http.get(url('/statements')).set(as(resident)).expect(200);
    expect(statement.body.data.unallocatedCredit).toBe(500_000);
  });

  it('refunds only from credit, after a different approver', async () => {
    const transactions = await stack.http.get(url('/transactions')).set(as(accountant)).expect(200);
    const transfer = transactions.body.data.find(
      (item: { channel: string }) => item.channel === 'dedicated_nuban',
    );
    await stack.http
      .post(url('/refunds'))
      .set(as(accountant))
      .send({ transactionId: transfer.id, amount: 600_000, reason: 'Paid twice' })
      .expect(422);
    const refund = await stack.http
      .post(url('/refunds'))
      .set(as(accountant))
      .send({ transactionId: transfer.id, amount: 200_000, reason: 'Paid twice' })
      .expect(201);
    await stack.http
      .post(url(`/refunds/${refund.body.data.id}/approve`))
      .set(as(accountant))
      .send({})
      .expect(403);
    const approved = await stack.http
      .post(url(`/refunds/${refund.body.data.id}/approve`))
      .set(as(manager))
      .send({})
      .expect(200);
    expect(approved.body.data.status).toBe('processing');
    expect(gateway.refunds).toEqual([
      { transactionReference: transfer.reference, amountKobo: 200_000 },
    ]);
    const statement = await stack.http.get(url('/statements')).set(as(resident)).expect(200);
    expect(statement.body.data.unallocatedCredit).toBe(300_000);
  });

  it('applies an approved office payment and keeps the ledger balanced', async () => {
    const recorded = await stack.http
      .post(url('/manual-payments'))
      .set(as(accountant))
      .send({ payerUserId: residentId, amount: 50_000, method: 'cash', receivedOn: '2026-11-14' })
      .expect(201);
    // The approver (billing.run.approve, no payment.reconcile) can see the queue; residents cannot.
    const queue = await stack.http
      .get(url('/manual-payments?status=pending'))
      .set(as(manager))
      .expect(200);
    expect(queue.body.data.map((row: { id: string }) => row.id)).toContain(recorded.body.data.id);
    await stack.http.get(url('/manual-payments')).set(as(resident)).expect(403);
    await stack.http
      .post(url(`/manual-payments/${recorded.body.data.id}/reject`))
      .set(as(resident))
      .send({ reason: 'not mine' })
      .expect(403);
    await stack.http
      .post(url(`/manual-payments/${recorded.body.data.id}/approve`))
      .set(as(manager))
      .send({})
      .expect(200);
    const statement = await stack.http.get(url('/statements')).set(as(resident)).expect(200);
    expect(statement.body.data.unallocatedCredit).toBe(350_000);
    const balances = await stack.http.get(url('/ledger/balances')).set(as(accountant)).expect(200);
    const rows = balances.body.data as {
      debit: number;
      credit: number;
      code: string;
      balance: number;
    }[];
    expect(rows.reduce((total, row) => total + row.balance, 0)).toBe(0);
    expect(rows.find((row) => row.code === 'cash:fake')?.balance).toBe(
      1_000_000 + 500_000 - 200_000,
    );
  });
});
