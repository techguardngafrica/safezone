import { expect, t, test } from './support/fixtures';

/** Advertiser area (public-web.md §7): add a creative, see it approved, pay the invoice, campaign approved. */
test('advertiser: creative, review and invoice payment', async ({
  page,
  seed,
  signIn,
  techguard,
}) => {
  const owner = await seed.user('Ngozi Okafor');
  const desk = await techguard('super_admin');
  const advertiser = await desk.post<{ id: string }>('/v1/platform/advertisers', {
    type: 'organisation',
    name: 'Fresh Mart Lekki',
    category: 'retail',
    ownerPhone: owner.phone,
  });
  const campaign = await desk.post<{ id: string }>('/v1/platform/ad-campaigns', {
    advertiserId: advertiser.id,
    title: 'Opening week',
    objective: 'Awareness for the new store',
    startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    endsAt: new Date(Date.now() + 15 * 86_400_000).toISOString(),
    budgetKobo: 10_000_000,
    lineItems: [{ placementKey: 'resident.home.banner', targeting: { scope: 'all' } }],
  });

  await page.goto('/advertiser');
  await signIn(page, owner);
  const row = page
    .getByRole('table', { name: t('advertiser.campaigns.title') })
    .getByRole('row')
    .filter({ hasText: 'Opening week' });
  await expect(row).toContainText(t('advertiser.status.draft'));
  await row.click();

  await page.getByRole('button', { name: t('advertiser.creatives.add') }).click();
  const dialog = page.getByRole('dialog', { name: t('advertiser.creatives.add') });
  await dialog
    .getByLabel(t('admin.ads.creatives.image'))
    .fill('0193a1b2-0000-7000-8000-0000000c0de1');
  await dialog.getByLabel(t('admin.ads.creatives.headline')).fill('Fresh Mart is open');
  await dialog.getByLabel(t('admin.ads.creatives.cta')).fill('Visit');
  await dialog.getByLabel(t('admin.ads.creatives.destination')).fill('https://example.com/opening');
  await dialog.getByRole('button', { name: t('advertiser.creatives.add') }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(t('advertiser.review.pending'))).toBeVisible();

  // Techguard reviews, approves the campaign and issues the invoice.
  const detail = await desk.get<{ creatives: { id: string }[] }>(
    `/v1/platform/ad-campaigns/${campaign.id}`,
  );
  await desk.request('PATCH', `/v1/platform/advertisers/${advertiser.id}`, {
    verificationStatus: 'verified',
  });
  await desk.post(`/v1/platform/ad-creatives/${detail.creatives[0]?.id}/review`, {
    decision: 'approved',
  });
  await desk.request('PATCH', `/v1/platform/ad-campaigns/${campaign.id}`, {
    arconApprovalRef: 'ARCON/2026/0042',
  });
  await desk.post(`/v1/platform/ad-campaigns/${campaign.id}/submit`, {});
  await desk.post(`/v1/platform/ad-campaigns/${campaign.id}/approve`, {});
  await desk.post('/v1/platform/ad-invoices', { campaignId: campaign.id });

  await page.reload();
  await expect(page.getByText(t('advertiser.status.awaiting_payment')).first()).toBeVisible();
  await expect(page.getByText(t('advertiser.review.approved'))).toBeVisible();
  await page
    .getByRole('button', { name: t('advertiser.invoices.pay', { amount: '₦107,500.00' }) })
    .click();

  // The fake provider's test checkout, then back to the campaign, which verifies the payment.
  await page.getByRole('button', { name: /^Pay / }).click();
  await page.getByRole('link', { name: 'Return to Safezone' }).click();
  await expect(page.getByText(/^Paid /)).toBeVisible();
  await expect(page.getByText(t('advertiser.status.approved')).first()).toBeVisible();
});
