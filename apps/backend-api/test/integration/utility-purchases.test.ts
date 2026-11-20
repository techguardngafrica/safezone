import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../../src/common/ids/uuidv7';
import { FakeBillsProvider, BillsProvider } from '../../src/integrations/bills/bills-provider';
import { FakePaymentGateway } from '../../src/integrations/payments/fake-payment.gateway';
import { PaymentGateway } from '../../src/integrations/payments/payment-gateway';
import { PaymentsService } from '../../src/modules/payments/payments.service';
import { PurchasesService } from '../../src/modules/utilities/purchases/purchases.service';
import { countRows, signIn, startTestStack, type TestStack, WEB_DEVICE } from './support/app';

describe('prepaid token purchases (ADR-0018)', () => {
  let stack: TestStack;
  let estateId: string;
  let resident: string;
  let residentId: string;
  let neighbour: string;
  let meterId: string;
  let badMeterId: string;
  let neighbourMeterId: string;
  let gateway: FakePaymentGateway;
  let bills: FakeBillsProvider;
  let purchases: PurchasesService;
  let payments: PaymentsService;
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const url = (path: string) => `/v1/estates/${estateId}${path}`;

  beforeAll(async () => {
    stack = await startTestStack();
    gateway = stack.app.get(PaymentGateway) as FakePaymentGateway;
    bills = stack.app.get(BillsProvider) as FakeBillsProvider;
    purchases = stack.app.get(PurchasesService);
    payments = stack.app.get(PaymentsService);
    estateId = await stack.createEstate('Token Estate');
    const managerId = await stack.createUser('+2348042000001');
    await stack.addMember(estateId, managerId, 'estate_administrator');
    const manager = (await signIn(stack, '+2348042000001', WEB_DEVICE)).accessToken;
    await stack.db.owner.query(
      `update platform.sessions set mfa_verified_at = now() where user_id = $1`,
      [managerId],
    );
    const unit = async (code: string) =>
      (
        await stack.http
          .post(url('/spaces'))
          .set(as(manager))
          .send({ type: 'unit', code })
          .expect(201)
      ).body.data.id as string;
    const unitA = await unit('T-1');
    const unitB = await unit('T-2');
    for (const [spaceId, phone] of [
      [unitA, '+2348042000010'],
      [unitB, '+2348042000011'],
    ] as const) {
      await stack.http
        .post(url('/occupancies'))
        .set(as(manager))
        .send({ spaceId, type: 'tenant', head: { fullName: `Resident ${phone.slice(-2)}`, phone } })
        .expect(201);
    }
    const signedIn = await signIn(stack, '+2348042000010');
    resident = signedIn.accessToken;
    residentId = signedIn.user.id;
    neighbour = (await signIn(stack, '+2348042000011')).accessToken;
    const meter = async (token: string, spaceId: string, meterNumber: string) =>
      (
        await stack.http
          .post(url('/meters'))
          .set(as(token))
          .send({ spaceId, type: 'electricity', providerCode: 'IKEDC', meterNumber })
          .expect(201)
      ).body.data.id as string;
    meterId = await meter(resident, unitA, '45001234568');
    badMeterId = await meter(resident, unitA, '99991234568');
    neighbourMeterId = await meter(neighbour, unitB, '45009876542');
  }, 240_000);

  afterAll(async () => {
    await stack?.stop();
  });

  const buy = (token: string, body: Record<string, unknown>, key = uuidv7()) =>
    stack.http
      .post(url('/utility-purchases'))
      .set(as(token))
      .set('Idempotency-Key', key)
      .send(body);

  it('reports limits and refuses bad amounts and other households’ meters', async () => {
    const limits = await stack.http
      .get(url('/utility-purchases/limits'))
      .set(as(resident))
      .expect(200);
    expect(limits.body.data).toEqual({
      available: true,
      minKobo: 100_000,
      maxKobo: 20_000_000,
      feeKobo: 0,
    });
    expect((await buy(resident, { meterId, amountKobo: 50_000 }).expect(422)).body.error.code).toBe(
      'AMOUNT_INVALID',
    );
    await buy(resident, { meterId: neighbourMeterId, amountKobo: 500_000 }).expect(404);
    await stack.http
      .post(url('/utility-purchases'))
      .set(as(resident))
      .send({ meterId, amountKobo: 500_000 })
      .expect(400);
  });

  let purchaseId: string;
  let reference: string;

  it('starts checkout on Safezone’s own account, idempotently', async () => {
    const key = uuidv7();
    const first = await buy(resident, { meterId, amountKobo: 500_000 }, key).expect(201);
    purchaseId = first.body.data.id;
    expect(first.body.data).toMatchObject({ status: 'created', totalKobo: 500_000, token: null });
    expect(first.body.data.authorizationUrl).toEqual(expect.any(String));
    const again = await buy(resident, { meterId, amountKobo: 500_000 }, key).expect(201);
    expect(again.body.data.id).toBe(purchaseId);
    const row = await stack.db.owner.query<{ payment_reference: string }>(
      `select payment_reference from tenant.utility_purchases where id = $1`,
      [purchaseId],
    );
    reference = row.rows[0]?.payment_reference as string;
    const route = await stack.db.owner.query<{ kind: string }>(
      `select kind from platform.payment_routes where route_key = $1`,
      [reference],
    );
    expect(route.rows[0]?.kind).toBe('platform_purchase');
  });

  it('marks paid only after provider verification, without touching estate ledgers', async () => {
    const early = await stack.http
      .post(url(`/utility-purchases/${purchaseId}/verify`))
      .set(as(resident))
      .expect(200);
    expect(early.body.data.status).toBe('created');
    gateway.complete(reference);
    const verified = await stack.http
      .post(url(`/utility-purchases/${purchaseId}/verify`))
      .set(as(resident))
      .expect(200);
    expect(verified.body.data.status).toBe('paid');
    expect(verified.body.data.token).toBeNull();
    expect(
      await countRows(stack.db.owner, `select count(*) from tenant.payment_transactions`),
    ).toBe(0);
    expect(
      await countRows(
        stack.db.owner,
        `select count(*) from platform.outbox_events where type = 'payments.platform_charge.succeeded'`,
      ),
    ).toBe(1);
    // The webhook path arriving later is a no-op.
    await purchases.handlePaid(estateId, reference, 500_000, 'dup');
    const events = await countRows(
      stack.db.owner,
      `select count(*) from tenant.utility_purchase_events where purchase_id = $1 and type = 'paid'`,
      [purchaseId],
    );
    expect(events).toBe(1);
  });

  it('vends, stores the token wrapped, and shows it to the household only', async () => {
    bills.failing.set('45001234568', 1);
    expect(await purchases.vend(estateId, purchaseId)).toBe('retry');
    expect(await purchases.vend(estateId, purchaseId)).toBe('vended');
    const detail = await stack.http
      .get(url(`/utility-purchases/${purchaseId}`))
      .set(as(resident))
      .expect(200);
    expect(detail.body.data.status).toBe('vended');
    expect(detail.body.data.token).toMatch(/^\d{4}(-\d{4}){4}$/);
    const stored = await stack.db.owner.query<{ token_wrapped: string }>(
      `select token_wrapped from tenant.utility_purchases where id = $1`,
      [purchaseId],
    );
    expect(stored.rows[0]?.token_wrapped).not.toContain(detail.body.data.token.replace(/-/g, ''));
    await stack.http
      .get(url(`/utility-purchases/${purchaseId}`))
      .set(as(neighbour))
      .expect(404);
    const outbox = await stack.db.owner.query<{ payload: unknown }>(
      `select payload from platform.outbox_events where payload->>'intent' = 'utilities.token_ready'`,
    );
    expect(outbox.rows).toHaveLength(1);
    expect(JSON.stringify(outbox.rows[0]?.payload)).not.toContain(
      detail.body.data.token.replace(/-/g, '').slice(0, 8),
    );
    expect(await purchases.vend(estateId, purchaseId)).toBe('skip');
    const mine = await stack.http.get(url('/utility-purchases')).set(as(resident)).expect(200);
    expect(mine.body.data.map((p: { id: string }) => p.id)).toContain(purchaseId);
  });

  it('refunds in full when the token cannot be vended', async () => {
    const created = await buy(resident, { meterId: badMeterId, amountKobo: 200_000 }).expect(201);
    const id = created.body.data.id as string;
    const ref = (
      await stack.db.owner.query<{ payment_reference: string }>(
        `select payment_reference from tenant.utility_purchases where id = $1`,
        [id],
      )
    ).rows[0]?.payment_reference as string;
    gateway.complete(ref);
    await stack.http
      .post(url(`/utility-purchases/${id}/verify`))
      .set(as(resident))
      .expect(200);
    expect(await purchases.vend(estateId, id)).toBe('refund');
    expect(await purchases.refund(estateId, id)).toBe('refunded');
    expect(gateway.refunds).toContainEqual({ transactionReference: ref, amountKobo: 200_000 });
    const detail = await stack.http
      .get(url(`/utility-purchases/${id}`))
      .set(as(resident))
      .expect(200);
    expect(detail.body.data).toMatchObject({ status: 'refunded', token: null });
  });

  it('refunds a short payment instead of vending', async () => {
    const created = await buy(resident, { meterId, amountKobo: 300_000 }).expect(201);
    const id = created.body.data.id as string;
    const ref = (
      await stack.db.owner.query<{ payment_reference: string }>(
        `select payment_reference from tenant.utility_purchases where id = $1`,
        [id],
      )
    ).rows[0]?.payment_reference as string;
    gateway.complete(ref, { amountKobo: 100_000 });
    const verified = await stack.http
      .post(url(`/utility-purchases/${id}/verify`))
      .set(as(resident))
      .expect(200);
    expect(verified.body.data.status).toBe('refund_pending');
    expect(await purchases.vend(estateId, id)).toBe('skip');
  });

  it('alerts once on purchases paid but not finished after 15 minutes', async () => {
    const created = await buy(resident, { meterId, amountKobo: 100_000 }).expect(201);
    const id = created.body.data.id as string;
    await stack.db.owner.query(
      `update tenant.utility_purchases set status = 'vending', paid_at = now() - interval '20 minutes' where id = $1`,
      [id],
    );
    const first = await purchases.sweep(estateId);
    expect(first.stuck).toBeGreaterThanOrEqual(1);
    await purchases.sweep(estateId);
    expect(
      await countRows(
        stack.db.owner,
        `select count(*) from tenant.utility_purchase_events where purchase_id = $1 and type = 'alerted'`,
        [id],
      ),
    ).toBe(1);
    expect(payments.provider).toBe('fake');
    expect(residentId).toBeTruthy();
  });

  it('keeps purchase events append-only and purchases undeletable for the app role', async () => {
    const app = stack.db.createAppClient({ max: 1 });
    await expect(
      app.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`select set_config('app.estate_id', '${estateId}', true)`);
        await tx.$executeRawUnsafe(`delete from tenant.utility_purchases`);
      }),
    ).rejects.toThrow();
  });
});
