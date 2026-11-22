import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakePaymentGateway } from '../../src/integrations/payments/fake-payment.gateway';
import { PaymentGateway } from '../../src/integrations/payments/payment-gateway';
import { OrdersService } from '../../src/modules/marketplace/orders.service';
import { countRows, signIn, startTestStack, type TestStack, WEB_DEVICE } from './support/app';

/** Marketplace end to end on real Postgres with RLS (marketplace.md §8, ADR-0023). */
describe('marketplace', () => {
  let stack: TestStack;
  let gateway: FakePaymentGateway;
  let orders: OrdersService;
  let estateA: string;
  let estateB: string;
  let managerA: string;
  let managerB: string;
  let residentA: string;
  let residentA2: string;
  let residentB: string;
  let admin: string;
  let owner: string;
  let personnel: string;
  let vendorId: string;
  let categoryId: string;
  let listingId: string;
  let quoteListingId: string;
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const vendorUrl = (path = '') => `/v1/vendors/${vendorId}${path}`;
  const market = (estateId: string, path: string) => `/v1/estates/${estateId}/marketplace${path}`;

  async function resident(estateId: string, manager: string, code: string, phone: string) {
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
      .send({ spaceId: unit, type: 'tenant', head: { fullName: `Resident ${code}`, phone } })
      .expect(201);
    return (await signIn(stack, phone)).accessToken;
  }

  beforeAll(async () => {
    stack = await startTestStack();
    gateway = stack.app.get(PaymentGateway) as FakePaymentGateway;
    orders = stack.app.get(OrdersService);
    estateA = await stack.createEstate('Market Estate A');
    estateB = await stack.createEstate('Market Estate B');
    await stack.addMember(
      estateA,
      await stack.createUser('+2348050000001'),
      'estate_administrator',
    );
    await stack.addMember(
      estateB,
      await stack.createUser('+2348050000002'),
      'estate_administrator',
    );
    managerA = (await signIn(stack, '+2348050000001', WEB_DEVICE)).accessToken;
    managerB = (await signIn(stack, '+2348050000002', WEB_DEVICE)).accessToken;
    const adminId = await stack.createUser('+2348050000003', 'Techguard Reviewer');
    await stack.assignPlatformRole(adminId, 'platform_administrator');
    admin = (await signIn(stack, '+2348050000003', WEB_DEVICE)).accessToken;
    await stack.db.owner.query(`update platform.sessions set mfa_verified_at = now()`);
    residentA = await resident(estateA, managerA, 'A-1', '+2348050000010');
    residentA2 = await resident(estateA, managerA, 'A-2', '+2348050000011');
    residentB = await resident(estateB, managerB, 'B-1', '+2348050000012');
    await stack.createUser('+2348050000020', 'Bright Owner');
    owner = (await signIn(stack, '+2348050000020')).accessToken;
    await stack.createUser('+2348050000021', 'Field Tech');
    personnel = (await signIn(stack, '+2348050000021')).accessToken;
    const categories = await stack.http.get('/v1/marketplace/categories').expect(200);
    categoryId = categories.body.data.find((c: { slug: string }) => c.slug === 'plumbing').id;
  }, 300_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('takes a vendor application and keeps it out of the market until Techguard approves', async () => {
    const applied = await stack.http
      .post('/v1/vendor-applications')
      .set(as(owner))
      .send({
        name: 'Bright Plumbing',
        type: 'company',
        cacNumber: 'RC 1234567',
        description: 'Plumbing repairs and installations across Lagos',
        contactEmail: 'ops@brightplumbing.ng',
        categoryIds: [categoryId],
        serviceAreas: [{ state: 'Lagos' }],
      })
      .expect(201);
    vendorId = applied.body.data.id;
    expect(applied.body.data).toMatchObject({ status: 'applied', myRole: 'vendor_owner' });
    await stack.http
      .post('/v1/vendor-applications')
      .set(as(owner))
      .send({
        name: 'Second Try',
        type: 'individual',
        description: 'Another vendor account for me',
        contactEmail: 'me@example.ng',
        categoryIds: [categoryId],
        serviceAreas: [{ state: 'Lagos' }],
      })
      .expect(409);

    const draft = await stack.http
      .post(vendorUrl('/listings'))
      .set(as(owner))
      .send({
        categoryId,
        title: 'Fix a leaking tap',
        description: 'Replace washers and seals on one tap',
        priceType: 'fixed',
        priceKobo: 1_500_000,
      })
      .expect(201);
    listingId = draft.body.data.id;
    expect(
      (
        await stack.http
          .patch(vendorUrl(`/listings/${listingId}`))
          .set(as(owner))
          .send({ status: 'active' })
          .expect(403)
      ).body.error.code,
    ).toBe('VENDOR_NOT_APPROVED');

    // Residents and other users cannot reach the vendor's routes or Techguard's.
    await stack.http.get(vendorUrl()).set(as(residentA)).expect(404);
    await stack.http
      .post(`/v1/platform/vendors/${vendorId}/approve`)
      .set(as(owner))
      .send({})
      .expect(403);

    const approved = await stack.http
      .post(`/v1/platform/vendors/${vendorId}/approve`)
      .set(as(admin))
      .send({})
      .expect(200);
    expect(approved.body.data).toMatchObject({ status: 'approved', verified: true });
    await stack.http
      .post(`/v1/platform/vendors/${vendorId}/approve`)
      .set(as(admin))
      .send({})
      .expect(409);
  });

  it('links a payout account keeping only the last 4 digits, and publishes listings', async () => {
    const linked = await stack.http
      .put(vendorUrl('/payout-account'))
      .set(as(owner))
      .send({ bankCode: '058', accountNumber: '0123456789' })
      .expect(200);
    expect(linked.body.data.payout).toEqual({
      ready: true,
      bankName: 'Guaranty Trust Bank',
      accountLast4: '6789',
    });
    expect(JSON.stringify(linked.body)).not.toContain('0123456789');
    await stack.http
      .patch(vendorUrl(`/listings/${listingId}`))
      .set(as(owner))
      .send({ status: 'active' })
      .expect(200);
    quoteListingId = (
      await stack.http
        .post(vendorUrl('/listings'))
        .set(as(owner))
        .send({
          categoryId,
          title: 'Full bathroom replumb',
          description: 'Survey and replace bathroom pipes',
          priceType: 'quote',
          status: 'active',
        })
        .expect(201)
    ).body.data.id;
  });

  it('shows the vendor only to estates that approved it, and never to one that blocked it', async () => {
    const before = await stack.http
      .get(market(estateA, '/listings'))
      .set(as(residentA))
      .expect(200);
    expect(before.body.data).toEqual([]);

    await stack.http
      .put(market(estateA, '/vendor-approvals'))
      .set(as(managerA))
      .send({ vendorId, status: 'approved' })
      .expect(200);
    await stack.http
      .put(market(estateA, '/vendor-approvals'))
      .set(as(residentA))
      .send({ vendorId, status: 'approved' })
      .expect(403);
    await stack.http
      .put(market(estateB, '/vendor-approvals'))
      .set(as(managerB))
      .send({ vendorId, status: 'blocked' })
      .expect(200);

    const shown = await stack.http.get(market(estateA, '/listings')).set(as(residentA)).expect(200);
    expect(shown.body.data.map((l: { id: string }) => l.id).sort()).toEqual(
      [listingId, quoteListingId].sort(),
    );
    expect(shown.body.data[0].vendor).toMatchObject({ name: 'Bright Plumbing', verified: true });
    const blocked = await stack.http
      .get(market(estateB, '/listings'))
      .set(as(residentB))
      .expect(200);
    expect(blocked.body.data).toEqual([]);
    await stack.http
      .post(market(estateB, '/orders'))
      .set(as(residentB))
      .send({ listingId, details: 'Kitchen tap leaking' })
      .expect(404);
    // A resident of Estate B cannot use Estate A's marketplace at all.
    await stack.http.get(market(estateA, '/listings')).set(as(residentB)).expect(404);
  });

  let orderId: string;

  it('runs a fixed-price order: accept, split payment, schedule, work, review', async () => {
    await stack.http
      .post('/v1/platform/commission-rules')
      .set(as(admin))
      .send({ scope: 'default', bps: 1000 })
      .expect(201);

    const placed = await stack.http
      .post(market(estateA, '/orders'))
      .set(as(residentA))
      .send({ listingId, details: 'Kitchen tap leaking' })
      .expect(201);
    orderId = placed.body.data.id;
    expect(placed.body.data).toMatchObject({
      status: 'requested',
      amountKobo: 1_500_000,
      paid: false,
    });

    // Another resident of the same estate cannot see or act on it.
    await stack.http
      .get(market(estateA, `/orders/${orderId}`))
      .set(as(residentA2))
      .expect(404);
    await stack.http
      .post(market(estateA, `/orders/${orderId}/pay`))
      .set(as(residentA))
      .send({})
      .expect(409);

    const vendorView = await stack.http.get(vendorUrl('/orders')).set(as(owner)).expect(200);
    expect(vendorView.body.data.map((o: { id: string }) => o.id)).toContain(orderId);
    await stack.http
      .post(vendorUrl(`/orders/${orderId}/accept`))
      .set(as(owner))
      .expect(200);
    await stack.http
      .post(vendorUrl(`/orders/${orderId}/schedule`))
      .set(as(owner))
      .send({ scheduledAt: new Date(Date.now() + 86_400_000).toISOString() })
      .expect(409);

    const checkout = await stack.http
      .post(market(estateA, `/orders/${orderId}/pay`))
      .set(as(residentA))
      .send({})
      .expect(200);
    expect(checkout.body.data).toMatchObject({ orderId, amountKobo: 1_500_000 });
    const reference = [...gateway.charges.keys()].find((key) => key.startsWith('sz_mkt_'));
    if (!reference) throw new Error('no marketplace charge started');
    const charge = gateway.charges.get(reference);
    expect(charge?.input.subaccountCode).toMatch(/^ACCT_fake_6789_/);
    expect(charge?.input.transactionChargeKobo).toBe(150_000);

    gateway.complete(reference);
    const paid = await stack.http
      .post(market(estateA, `/orders/${orderId}/verify-payment`))
      .set(as(residentA))
      .expect(200);
    expect(paid.body.data).toMatchObject({ paid: true, commissionKobo: null });
    const vendorDetail = await stack.http
      .get(vendorUrl(`/orders/${orderId}`))
      .set(as(owner))
      .expect(200);
    expect(vendorDetail.body.data).toMatchObject({
      commissionKobo: 150_000,
      vendorAmountKobo: 1_350_000,
    });

    await stack.http
      .post(vendorUrl(`/orders/${orderId}/schedule`))
      .set(as(owner))
      .send({ scheduledAt: new Date(Date.now() + 86_400_000).toISOString() })
      .expect(200);
    await stack.http
      .post(vendorUrl(`/orders/${orderId}/start`))
      .set(as(owner))
      .expect(200);
    await stack.http
      .post(market(estateA, `/orders/${orderId}/messages`))
      .set(as(residentA))
      .send({ body: 'Gate code is at the front desk' })
      .expect(201);
    await stack.http
      .post(vendorUrl(`/orders/${orderId}/complete`))
      .set(as(owner))
      .expect(200);
    const reviewed = await stack.http
      .post(market(estateA, `/orders/${orderId}/review`))
      .set(as(residentA))
      .send({ rating: 4, comment: 'Quick and tidy' })
      .expect(200);
    expect(reviewed.body.data.status).toBe('reviewed');
    await stack.http
      .post(market(estateA, `/orders/${orderId}/review`))
      .set(as(residentA))
      .send({ rating: 5 })
      .expect(409);
    const vendor = await stack.http.get(vendorUrl()).set(as(owner)).expect(200);
    expect(vendor.body.data).toMatchObject({ ratingAvg: 4, ratingCount: 1 });
    expect(
      (
        await stack.http
          .get(market(estateA, `/orders/${orderId}`))
          .set(as(residentA))
          .expect(200)
      ).body.data.events.map((e: { toStatus: string }) => e.toStatus),
    ).toEqual([
      'requested',
      'accepted',
      'accepted',
      'scheduled',
      'in_progress',
      'completed',
      'reviewed',
    ]);
  });

  it('quotes, refunds a paid order cancelled by the resident, and scopes service personnel', async () => {
    const placed = await stack.http
      .post(market(estateA, '/orders'))
      .set(as(residentA))
      .send({ listingId: quoteListingId, details: 'Bathroom pipes are old' })
      .expect(201);
    const id = placed.body.data.id as string;
    await stack.http
      .post(vendorUrl(`/orders/${id}/accept`))
      .set(as(owner))
      .expect(409);
    await stack.http
      .post(vendorUrl(`/orders/${id}/quote`))
      .set(as(owner))
      .send({ amountKobo: 25_000_000 })
      .expect(200);
    const accepted = await stack.http
      .post(market(estateA, `/orders/${id}/accept-quote`))
      .set(as(residentA))
      .expect(200);
    expect(accepted.body.data).toMatchObject({ status: 'accepted', amountKobo: 25_000_000 });

    // Service personnel see only orders assigned to them and cannot accept or quote.
    const team = await stack.http
      .post(vendorUrl('/members'))
      .set(as(owner))
      .send({ phone: '+2348050000021', role: 'vendor_service_personnel' })
      .expect(201);
    const memberId = team.body.data.find(
      (m: { role: string }) => m.role === 'vendor_service_personnel',
    ).id;
    expect(
      (await stack.http.get(vendorUrl('/orders')).set(as(personnel)).expect(200)).body.data,
    ).toEqual([]);
    await stack.http
      .post(vendorUrl(`/orders/${id}/decline`))
      .set(as(personnel))
      .send({ reason: 'No' })
      .expect(403);
    await stack.http
      .post(vendorUrl(`/orders/${id}/assign`))
      .set(as(owner))
      .send({ memberId })
      .expect(200);
    expect(
      (await stack.http.get(vendorUrl('/orders')).set(as(personnel)).expect(200)).body.data.map(
        (o: { id: string }) => o.id,
      ),
    ).toEqual([id]);

    await stack.http
      .post(market(estateA, `/orders/${id}/pay`))
      .set(as(residentA))
      .send({})
      .expect(200);
    const reference = [...gateway.charges.entries()].find(
      ([, c]) => c.input.metadata.orderId === id,
    )?.[0];
    if (!reference) throw new Error('no charge');
    gateway.complete(reference);
    await stack.http
      .post(market(estateA, `/orders/${id}/verify-payment`))
      .set(as(residentA))
      .expect(200);
    await stack.http
      .post(market(estateA, `/orders/${id}/cancel`))
      .set(as(residentA))
      .send({ reason: 'Moving out next week' })
      .expect(200);

    // The worker step behind marketplace.order.refund_requested: refunds once, however often it runs.
    expect(
      await countRows(
        stack.db.owner,
        `select count(*) from platform.outbox_events where type = 'marketplace.order.refund_requested' and aggregate_id = $1`,
        [id],
      ),
    ).toBe(1);
    await orders.processRefund(estateA, id, 25_000_000);
    await orders.processRefund(estateA, id, 25_000_000);
    expect(gateway.refunds.filter((r) => r.transactionReference === reference)).toEqual([
      { transactionReference: reference, amountKobo: 25_000_000 },
    ]);
    const earnings = await stack.http.get(vendorUrl('/payouts')).set(as(owner)).expect(200);
    expect(earnings.body.data).toMatchObject({ paidOrders: 2, refundedKobo: 25_000_000 });
    await stack.http.get(vendorUrl('/payouts')).set(as(personnel)).expect(403);
  });

  it('resolves a dispute with a partial refund from the Techguard desk', async () => {
    const placed = await stack.http
      .post(market(estateA, '/orders'))
      .set(as(residentA))
      .send({ listingId, details: 'Bathroom tap dripping' })
      .expect(201);
    const id = placed.body.data.id as string;
    await stack.http
      .post(vendorUrl(`/orders/${id}/accept`))
      .set(as(owner))
      .expect(200);
    await stack.http
      .post(market(estateA, `/orders/${id}/pay`))
      .set(as(residentA))
      .send({})
      .expect(200);
    const reference = [...gateway.charges.entries()].find(
      ([, c]) => c.input.metadata.orderId === id,
    )?.[0];
    if (!reference) throw new Error('no charge');
    gateway.complete(reference);
    await stack.http
      .post(market(estateA, `/orders/${id}/verify-payment`))
      .set(as(residentA))
      .expect(200);
    await stack.http
      .post(vendorUrl(`/orders/${id}/start`))
      .set(as(owner))
      .expect(200);
    await stack.http
      .post(market(estateA, `/orders/${id}/dispute`))
      .set(as(residentA))
      .send({ reason: 'The tap still drips after the visit' })
      .expect(200);

    const desk = await stack.http
      .get('/v1/platform/order-disputes?status=open')
      .set(as(admin))
      .expect(200);
    const dispute = desk.body.data.find((d: { orderId: string }) => d.orderId === id);
    expect(dispute).toMatchObject({ estateId: estateA, status: 'open' });
    await stack.http.get('/v1/platform/order-disputes').set(as(managerA)).expect(403);
    await stack.http
      .post(`/v1/platform/order-disputes/${dispute.id}/resolve`)
      .set(as(admin))
      .send({ resolution: 'partial_refund', refundKobo: 1_500_000, note: 'Too much' })
      .expect(422);
    const resolved = await stack.http
      .post(`/v1/platform/order-disputes/${dispute.id}/resolve`)
      .set(as(admin))
      .send({ resolution: 'partial_refund', refundKobo: 500_000, note: 'Second visit not made' })
      .expect(200);
    expect(resolved.body.data).toMatchObject({ status: 'resolved', refundKobo: 500_000 });
    await orders.processRefund(estateA, id, 500_000);
    expect(gateway.refunds.filter((r) => r.transactionReference === reference)).toEqual([
      { transactionReference: reference, amountKobo: 500_000 },
    ]);
    await stack.http
      .post(market(estateA, `/orders/${id}/dispute`))
      .set(as(residentA))
      .send({ reason: 'Trying to dispute the same order again' })
      .expect(409);
    const order = await stack.http
      .get(market(estateA, `/orders/${id}`))
      .set(as(residentA))
      .expect(200);
    expect(order.body.data.status).toBe('completed');
  });

  it('refunds a verified charge that matches no order', async () => {
    await orders.handlePaid(estateA, 'sz_mkt_unknown', 1234);
    expect(gateway.refunds).toContainEqual({
      transactionReference: 'sz_mkt_unknown',
      amountKobo: 1234,
    });
  });

  it('runs estate classifieds: neighbours only, enquiries without phone numbers, moderation', async () => {
    const posted = await stack.http
      .post(`/v1/estates/${estateA}/classifieds`)
      .set(as(residentA))
      .send({
        kind: 'item',
        title: 'Standing fan',
        description: 'Barely used 18 inch standing fan',
        priceKobo: 2_500_000,
        condition: 'like_new',
      })
      .expect(201);
    const id = posted.body.data.id as string;
    expect(posted.body.data).toMatchObject({ status: 'active', mine: true });

    const seen = await stack.http
      .get(`/v1/estates/${estateA}/classifieds`)
      .set(as(residentA2))
      .expect(200);
    expect(seen.body.data.map((c: { id: string }) => c.id)).toContain(id);
    expect(JSON.stringify(seen.body)).not.toContain('+234');
    await stack.http.get(`/v1/estates/${estateA}/classifieds/${id}`).set(as(residentB)).expect(404);
    await stack.http.get(`/v1/estates/${estateB}/classifieds/${id}`).set(as(residentB)).expect(404);

    await stack.http
      .post(`/v1/estates/${estateA}/classifieds/${id}/messages`)
      .set(as(residentA2))
      .send({ body: 'Is it still available?' })
      .expect(201);
    const sellerThreads = await stack.http
      .get(`/v1/estates/${estateA}/classifieds/${id}/messages`)
      .set(as(residentA))
      .expect(200);
    expect(sellerThreads.body.data).toHaveLength(1);
    const buyerUserId = sellerThreads.body.data[0].buyerUserId as string;
    await stack.http
      .post(`/v1/estates/${estateA}/classifieds/${id}/messages`)
      .set(as(residentA))
      .send({ body: 'Yes, come by after 5pm', buyerUserId })
      .expect(201);

    await stack.http
      .patch(`/v1/estates/${estateA}/classifieds/${id}`)
      .set(as(residentA2))
      .send({ status: 'sold' })
      .expect(403);
    await stack.http
      .post(`/v1/estates/${estateA}/classifieds/${id}/hide`)
      .set(as(residentA2))
      .send({ reason: 'Spam' })
      .expect(403);
    await stack.http
      .post(`/v1/estates/${estateA}/classifieds/${id}/hide`)
      .set(as(managerA))
      .send({ reason: 'Duplicate listing' })
      .expect(200);
    await stack.http
      .get(`/v1/estates/${estateA}/classifieds/${id}`)
      .set(as(residentA2))
      .expect(404);
    expect(
      (
        await stack.http
          .patch(`/v1/estates/${estateA}/classifieds/${id}`)
          .set(as(residentA))
          .send({ status: 'active' })
          .expect(403)
      ).body.error.code,
    ).toBe('CLASSIFIED_HIDDEN');
    expect(
      await countRows(
        stack.db.owner,
        `select count(*) from platform.outbox_events where type = 'marketplace.classified.hidden' and aggregate_id = $1`,
        [id],
      ),
    ).toBe(1);
  });
});
