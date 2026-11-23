import { E2E } from './support/config';
import { expect, t, test } from './support/fixtures';

/** Vendor Portal Estates & Disputes (public-web.md §8): approved estates list and dispute outcomes. */
test('vendor portal: approved estates and dispute outcomes', async ({
  page,
  seed,
  apiAs,
  signIn,
  techguard,
}) => {
  const owner = await seed.user('Kemi Vendor');
  const vendorApi = await apiAs(owner);
  const categories = await vendorApi.get<{ id: string; slug: string }[]>(
    '/v1/marketplace/categories',
  );
  const plumbingId = categories.find((c) => c.slug === 'plumbing')?.id;
  const vendor = await vendorApi.post<{ id: string }>('/v1/vendor-applications', {
    name: 'Kemi Plumbing Co',
    type: 'individual',
    description: 'Pipe repairs and tap installations.',
    contactEmail: 'kemi@example.ng',
    categoryIds: [plumbingId],
    serviceAreas: [{ state: 'Lagos' }],
  });
  const admin = await techguard();
  await admin.post(`/v1/platform/vendors/${vendor.id}/approve`, {});
  await vendorApi.request('PUT', `/v1/vendors/${vendor.id}/payout-account`, {
    bankCode: '058',
    accountNumber: '0123456789',
  });
  const listing = await vendorApi.post<{ id: string }>(`/v1/vendors/${vendor.id}/listings`, {
    categoryId: plumbingId,
    title: 'Replace kitchen sink trap',
    description: 'Full replacement of under-sink PVC trap.',
    priceType: 'fixed',
    priceKobo: 2_000_000,
    status: 'active',
  });

  // Estate approves vendor; resident places & pays for order, then opens a dispute.
  const estateId = await seed.estate('Victoria Crest Estate');
  const manager = await apiAs(await seed.staff(estateId, 'estate_administrator', 'Sola Manager'));
  await manager.request('PUT', `/v1/estates/${estateId}/marketplace/vendor-approvals`, {
    vendorId: vendor.id,
    status: 'approved',
  });
  const residentUser = await seed.user('Dapo Resident');
  await seed.member(estateId, residentUser.id, 'tenant');
  const resident = await apiAs(residentUser, 'resident');
  const order = await resident.post<{ id: string }>(`/v1/estates/${estateId}/marketplace/orders`, {
    listingId: listing.id,
    details: 'Leaking under sink',
  });
  await vendorApi.post(`/v1/vendors/${vendor.id}/orders/${order.id}/accept`, {});
  const checkout = await resident.post<{ authorizationUrl: string }>(
    `/v1/estates/${estateId}/marketplace/orders/${order.id}/pay`,
    {},
  );
  const reference = decodeURIComponent(checkout.authorizationUrl.split('/dev-checkout/')[1] ?? '');
  await fetch(`${E2E.apiUrl}/dev-checkout/${encodeURIComponent(reference)}/pay`, {
    method: 'POST',
    redirect: 'manual',
  });
  await resident.post(`/v1/estates/${estateId}/marketplace/orders/${order.id}/verify-payment`, {});
  await resident.post(`/v1/estates/${estateId}/marketplace/orders/${order.id}/dispute`, {
    reason: 'Pipe still leaks after visit',
    evidenceFileIds: [],
  });

  // Vendor views /vendor/estates and /vendor/disputes.
  await page.goto('/vendor/estates');
  await signIn(page, owner);
  await expect(page.getByText('Victoria Crest Estate')).toBeVisible();

  await page.getByRole('link', { name: t('vendor.nav.disputes') }).click();
  await expect(page.getByText('Replace kitchen sink trap')).toBeVisible();
  await expect(page.getByText('Pipe still leaks after visit')).toBeVisible();
  await expect(
    page.getByText(t('vendor.disputes.status.open'), { exact: true }).first(),
  ).toBeVisible();
});
