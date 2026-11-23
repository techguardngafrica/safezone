import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakePaymentGateway } from '../../src/integrations/payments/fake-payment.gateway';
import { PaymentGateway } from '../../src/integrations/payments/payment-gateway';
import { CampaignsService } from '../../src/modules/advertising/campaigns.service';
import { countRows, signIn, startTestStack, type TestStack, WEB_DEVICE } from './support/app';

/** Managed advertising end to end on real Postgres (advertising.md §10, ADR-0024). */
describe('advertising', () => {
  let stack: TestStack;
  let gateway: FakePaymentGateway;
  let campaigns: CampaignsService;
  let estateA: string;
  let estateB: string;
  let adminA: string;
  let manager: string;
  let reviewer: string;
  let owner: string;
  let residentA: string;
  let residentB: string;
  let outsider: string;
  let advertiserId: string;
  let campaignId: string;
  let creativeId: string;
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const decide = (token: string, estateId: string, context = 'home') =>
    stack.http
      .get(
        `/v1/ads/decision?placement=resident.home.banner&estateId=${estateId}&context=${context}`,
      )
      .set(as(token));

  beforeAll(async () => {
    stack = await startTestStack();
    gateway = stack.app.get(PaymentGateway) as FakePaymentGateway;
    campaigns = stack.app.get(CampaignsService);
    estateA = await stack.createEstate('Ads Estate A');
    estateB = await stack.createEstate('Ads Estate B');
    await stack.addMember(
      estateA,
      await stack.createUser('+2348060000001'),
      'estate_administrator',
    );
    adminA = (await signIn(stack, '+2348060000001', WEB_DEVICE)).accessToken;
    await stack.assignPlatformRole(await stack.createUser('+2348060000002'), 'advertising_manager');
    manager = (await signIn(stack, '+2348060000002', WEB_DEVICE)).accessToken;
    await stack.assignPlatformRole(
      await stack.createUser('+2348060000003'),
      'advertising_reviewer',
    );
    reviewer = (await signIn(stack, '+2348060000003', WEB_DEVICE)).accessToken;
    await stack.db.owner.query(`update platform.sessions set mfa_verified_at = now()`);
    await stack.addMember(estateA, await stack.createUser('+2348060000010'), 'tenant');
    residentA = (await signIn(stack, '+2348060000010')).accessToken;
    await stack.addMember(estateB, await stack.createUser('+2348060000011'), 'tenant');
    residentB = (await signIn(stack, '+2348060000011')).accessToken;
    await stack.createUser('+2348060000020', 'Ngozi Grocer');
    owner = (await signIn(stack, '+2348060000020')).accessToken;
    await stack.createUser('+2348060000021', 'Someone Else');
    outsider = (await signIn(stack, '+2348060000021')).accessToken;
  }, 300_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('takes a public enquiry, which Techguard manages and turns into an advertiser', async () => {
    const enquiry = await stack.http
      .post('/v1/public/ad-enquiries')
      .send({
        advertiserType: 'organisation',
        contactName: 'Ngozi',
        orgName: 'Fresh Mart',
        phone: '08060000020',
        email: 'ngozi@freshmart.ng',
        category: 'retail',
        objectives: 'Store opening',
        description: 'New supermarket near the estates in Lekki',
        budgetRange: '100k_500k',
        placements: ['resident.home.banner'],
        consent: true,
      })
      .expect(201);
    expect(enquiry.body.data.status).toBe('submitted');
    const trackingToken = enquiry.body.data.trackingToken as string;
    expect(trackingToken).toMatch(/^[A-Za-z0-9_-]{40,64}$/);

    // Link-based status lookup is public, privacy-minimized (no phone/email/notes) and returns 404 for unknown tokens.
    const tracked = await stack.http.get(`/v1/public/ad-enquiries/${trackingToken}`).expect(200);
    expect(tracked.body.data).toMatchObject({
      id: enquiry.body.data.id,
      status: 'submitted',
      orgName: 'Fresh Mart',
      category: 'retail',
      hasAdvertiserAccount: false,
    });
    expect(tracked.body.data.phone).toBeUndefined();
    expect(tracked.body.data.email).toBeUndefined();
    expect(tracked.body.data.notes).toBeUndefined();
    await stack.http.get(`/v1/public/ad-enquiries/${'a'.repeat(43)}`).expect(404);

    await stack.http.get('/v1/platform/ad-enquiries').set(as(owner)).expect(403);
    const listed = await stack.http.get('/v1/platform/ad-enquiries').set(as(manager)).expect(200);
    expect(listed.body.data[0]).toMatchObject({ orgName: 'Fresh Mart', phone: '+2348060000020' });

    const advertiser = await stack.http
      .post('/v1/platform/advertisers')
      .set(as(manager))
      .send({
        type: 'organisation',
        name: 'Fresh Mart',
        category: 'retail',
        ownerPhone: '08060000020',
        enquiryId: enquiry.body.data.id,
      })
      .expect(201);
    advertiserId = advertiser.body.data.id;
    const trackedAfter = await stack.http
      .get(`/v1/public/ad-enquiries/${trackingToken}`)
      .expect(200);
    expect(trackedAfter.body.data.hasAdvertiserAccount).toBe(true);
    const mine = await stack.http.get('/v1/me/advertisers').set(as(owner)).expect(200);
    expect(mine.body.data).toEqual([
      expect.objectContaining({ id: advertiserId, role: 'advertiser_organisation_owner' }),
    ]);
    await stack.http.get(`/v1/advertisers/${advertiserId}`).set(as(outsider)).expect(404);
  });

  it('gates approval on creatives, the ARCON reference and a verified advertiser', async () => {
    const start = new Date(Date.now() - 3_600_000).toISOString();
    const end = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const campaign = await stack.http
      .post('/v1/platform/ad-campaigns')
      .set(as(manager))
      .send({
        advertiserId,
        title: 'Opening week',
        objective: 'Awareness',
        startsAt: start,
        endsAt: end,
        budgetKobo: 10_000_000,
        lineItems: [
          {
            placementKey: 'resident.home.banner',
            targeting: { scope: 'estates', estateIds: [estateA] },
            frequencyCapPerDay: 1,
          },
        ],
      })
      .expect(201);
    campaignId = campaign.body.data.id;
    expect(
      (
        await stack.http
          .post(`/v1/platform/ad-campaigns/${campaignId}/submit`)
          .set(as(manager))
          .send({})
          .expect(422)
      ).body.error.code,
    ).toBe('CREATIVE_REQUIRED');

    // The advertiser submits the creative; nobody else can.
    const creative = {
      type: 'image_banner',
      imageFileId: '0193a1b2-0000-7000-8000-0000000c0de1',
      headline: 'Fresh Mart is open',
      body: '10% off this week',
      cta: 'Visit',
      destinationUrl: 'https://freshmart.ng/opening',
    };
    await stack.http
      .post(`/v1/advertisers/${advertiserId}/campaigns/${campaignId}/creatives`)
      .set(as(outsider))
      .send(creative)
      .expect(404);
    creativeId = (
      await stack.http
        .post(`/v1/advertisers/${advertiserId}/campaigns/${campaignId}/creatives`)
        .set(as(owner))
        .send(creative)
        .expect(201)
    ).body.data.id;

    await stack.http
      .post(`/v1/platform/ad-campaigns/${campaignId}/submit`)
      .set(as(manager))
      .send({})
      .expect(200);
    const blocked = await stack.http
      .post(`/v1/platform/ad-campaigns/${campaignId}/approve`)
      .set(as(reviewer))
      .send({})
      .expect(422);
    expect(blocked.body.error.code).toBe('APPROVAL_BLOCKED_NO_ARCON_REF');
    expect(blocked.body.error.message).toContain('Verify the advertiser');
    expect(blocked.body.error.message).toContain('Every creative must be approved');

    await stack.http
      .patch(`/v1/platform/ad-campaigns/${campaignId}`)
      .set(as(manager))
      .send({ arconApprovalRef: 'ARCON/AAPVS/2026/0042' })
      .expect(200);
    await stack.http
      .patch(`/v1/platform/advertisers/${advertiserId}`)
      .set(as(reviewer))
      .send({ verificationStatus: 'verified' })
      .expect(200);
    await stack.http
      .post(`/v1/platform/ad-creatives/${creativeId}/review`)
      .set(as(reviewer))
      .send({ decision: 'approved' })
      .expect(200);
    // The manager cannot approve; only the reviewer can.
    await stack.http
      .post(`/v1/platform/ad-campaigns/${campaignId}/approve`)
      .set(as(manager))
      .send({})
      .expect(403);
    const approved = await stack.http
      .post(`/v1/platform/ad-campaigns/${campaignId}/approve`)
      .set(as(reviewer))
      .send({})
      .expect(200);
    expect(approved.body.data.status).toBe('awaiting_payment');
  });

  it('goes live only after the invoice is paid (to Safezone, with VAT)', async () => {
    expect(await campaigns.sweep()).toBe(0);
    await expect(decide(residentA, estateA)).resolves.toMatchObject({ status: 204 });

    const invoice = await stack.http
      .post('/v1/platform/ad-invoices')
      .set(as(manager))
      .send({ campaignId })
      .expect(201);
    expect(invoice.body.data).toMatchObject({
      amountKobo: 10_000_000,
      vatKobo: 750_000,
      totalKobo: 10_750_000,
    });
    const checkout = await stack.http
      .post(`/v1/advertisers/${advertiserId}/invoices/${invoice.body.data.id}/pay`)
      .set(as(owner))
      .send({})
      .expect(200);
    expect(checkout.body.data.totalKobo).toBe(10_750_000);
    const reference = [...gateway.charges.keys()].find((key) => key.startsWith('sz_ad_'));
    if (!reference) throw new Error('no ad charge');
    expect(gateway.charges.get(reference)?.input.subaccountCode).toBeNull();
    gateway.complete(reference);
    const paid = await stack.http
      .post(`/v1/advertisers/${advertiserId}/invoices/${invoice.body.data.id}/verify`)
      .set(as(owner))
      .expect(200);
    expect(paid.body.data.status).toBe('paid');

    expect(await campaigns.sweep()).toBe(1);
    const live = await stack.http
      .get(`/v1/platform/ad-campaigns/${campaignId}`)
      .set(as(reviewer))
      .expect(200);
    expect(live.body.data.status).toBe('active');
  });

  it('serves only allowed contexts and targeted estates, counts impressions once and caps frequency', async () => {
    const ad = await decide(residentA, estateA).expect(200);
    expect(ad.body.data).toMatchObject({
      label: 'Sponsored',
      headline: 'Fresh Mart is open',
      advertiserName: 'Fresh Mart',
    });
    expect(JSON.stringify(ad.body.data)).not.toContain('freshmart.ng');

    for (const blockedContext of [
      'sos',
      'visitor_pass',
      'gate',
      'payment_confirmation',
      'onboarding',
      'messages',
    ])
      await decide(residentA, estateA, blockedContext).expect(204);
    await decide(residentB, estateB).expect(204);
    await decide(residentB, estateA).expect(404);

    const impressionPath = new URL(ad.body.data.impressionUrl, 'http://x').pathname;
    await stack.http.get(impressionPath).expect(204);
    await stack.http.get(impressionPath).expect(204);
    expect(
      await countRows(
        stack.db.owner,
        `select count(*) from platform.ad_impressions where campaign_id = $1`,
        [campaignId],
      ),
    ).toBe(1);
    // Daily cap of 1 reached for this user.
    await decide(residentA, estateA).expect(204);

    const click = await stack.http
      .get(new URL(ad.body.data.clickUrl, 'http://x').pathname)
      .expect(302);
    expect(click.headers.location).toBe('https://freshmart.ng/opening');
    await stack.http.get(`${impressionPath}x`).expect(204);
    await stack.http.get('/v1/ads/c/not-a-real-token-at-all-00000').expect(404);
    expect(
      await countRows(
        stack.db.owner,
        `select count(*) from platform.ad_impressions where user_hash like '%' and campaign_id = $1 and app = 'resident-mobile'`,
        [campaignId],
      ),
    ).toBe(1);
  });

  it('reports aggregates only, grouping estates under the audience threshold', async () => {
    const report = await stack.http
      .get(`/v1/advertisers/${advertiserId}/campaigns/${campaignId}/report`)
      .set(as(owner))
      .expect(200);
    expect(report.body.data).toMatchObject({
      impressions: 1,
      clicks: 1,
      uniqueReachEstimate: 1,
      minimumAudience: 200,
    });
    expect(report.body.data.byEstate).toEqual([
      { estateName: 'Other estates', impressions: 1, clicks: 1 },
    ]);
    expect(JSON.stringify(report.body.data)).not.toContain('Ads Estate A');
    await stack.http
      .get(`/v1/advertisers/${advertiserId}/campaigns/${campaignId}/report`)
      .set(as(residentA))
      .expect(404);
  });

  it('respects estate category blocks and stops at once when the advertiser is suspended', async () => {
    await stack.redis.flushdb();
    await decide(residentA, estateA).expect(200);
    await stack.http
      .put(`/v1/estates/${estateA}/ad-settings`)
      .set(as(residentA))
      .send({ blockedCategories: ['retail'] })
      .expect(403);
    await stack.http
      .put(`/v1/estates/${estateA}/ad-settings`)
      .set(as(adminA))
      .send({ blockedCategories: ['retail'] })
      .expect(200);
    await decide(residentA, estateA).expect(204);
    await stack.http
      .put(`/v1/estates/${estateA}/ad-settings`)
      .set(as(adminA))
      .send({ blockedCategories: [] })
      .expect(200);
    await decide(residentA, estateA).expect(200);

    await stack.http
      .patch(`/v1/platform/advertisers/${advertiserId}`)
      .set(as(reviewer))
      .send({ status: 'suspended', reason: 'Policy review' })
      .expect(200);
    await decide(residentA, estateA).expect(204);
  });
});
