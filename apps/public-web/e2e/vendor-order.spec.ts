import { E2E } from './support/config';
import { expect, t, test } from './support/fixtures';

/** Vendor order flow (public-web.md §12): accept, get paid, work, complete, see earnings. */
test('vendor order: accept, payment, work and earnings from the portal', async ({
  page,
  seed,
  apiAs,
  signIn,
  techguard,
}) => {
  // Vendor applies, links payout and lists a fixed-price service through the API.
  const owner = await seed.user('Bisi Owner');
  const vendorApi = await apiAs(owner);
  const vendor = await vendorApi.post<{ id: string }>('/v1/vendor-applications', {
    name: 'Bisi Home Services',
    type: 'individual',
    description: 'Plumbing and small repairs in Lekki.',
    contactEmail: 'bisi@example.ng',
    categoryIds: [
      (await vendorApi.get<{ id: string; slug: string }[]>('/v1/marketplace/categories')).find(
        (c) => c.slug === 'plumbing',
      )?.id,
    ],
    serviceAreas: [{ state: 'Lagos' }],
  });
  const admin = await techguard();
  await admin.post(`/v1/platform/vendors/${vendor.id}/approve`, {});
  await vendorApi.request('PUT', `/v1/vendors/${vendor.id}/payout-account`, {
    bankCode: '058',
    accountNumber: '0123456789',
  });
  const categories = await vendorApi.get<{ id: string; slug: string }[]>(
    '/v1/marketplace/categories',
  );
  const listing = await vendorApi.post<{ id: string }>(`/v1/vendors/${vendor.id}/listings`, {
    categoryId: categories.find((c) => c.slug === 'plumbing')?.id,
    title: 'Fix a leaking tap',
    description: 'Replace washers and seals on one tap.',
    priceType: 'fixed',
    priceKobo: 1_500_000,
    status: 'active',
  });

  // The estate approves the vendor; a resident orders.
  const estateId = await seed.estate('Lekki Gardens');
  const manager = await apiAs(await seed.staff(estateId, 'estate_administrator', 'Mo Manager'));
  await manager.request('PUT', `/v1/estates/${estateId}/marketplace/vendor-approvals`, {
    vendorId: vendor.id,
    status: 'approved',
  });
  const tola = await seed.user('Tola Tenant');
  await seed.member(estateId, tola.id, 'tenant');
  const resident = await apiAs(tola, 'resident');
  const order = await resident.post<{ id: string }>(`/v1/estates/${estateId}/marketplace/orders`, {
    listingId: listing.id,
    details: 'Kitchen tap dripping',
  });

  // The vendor accepts in the portal.
  await page.goto('/vendor/orders');
  await signIn(page, owner);
  const table = page.getByRole('table', { name: t('vendor.orders.title') });
  const row = table.getByRole('row').filter({ hasText: 'Fix a leaking tap' });
  await expect(row).toContainText(t('vendor.orderStatus.requested'));
  await row.click();
  const drawer = page.getByRole('dialog', { name: t('vendor.orders.detail') });
  await drawer.getByRole('button', { name: t('vendor.orders.accept') }).click();
  await expect(drawer.getByText(t('vendor.orders.awaitingPayment'))).toBeVisible();
  // Work cannot start before payment.
  await expect(drawer.getByRole('button', { name: t('vendor.orders.start') })).toHaveCount(0);

  // The resident pays through the fake provider's test checkout.
  const checkout = await resident.post<{ authorizationUrl: string }>(
    `/v1/estates/${estateId}/marketplace/orders/${order.id}/pay`,
    {},
  );
  const reference = decodeURIComponent(checkout.authorizationUrl.split('/dev-checkout/')[1] ?? '');
  const paid = await fetch(`${E2E.apiUrl}/dev-checkout/${encodeURIComponent(reference)}/pay`, {
    method: 'POST',
    redirect: 'manual',
  });
  expect(paid.status).toBeLessThan(400);
  await resident.post(`/v1/estates/${estateId}/marketplace/orders/${order.id}/verify-payment`, {});

  await page.reload();
  await table.getByRole('row').filter({ hasText: 'Fix a leaking tap' }).click();
  await expect(drawer.getByText(t('vendor.orders.paid'), { exact: true })).toBeVisible();
  await drawer.getByRole('button', { name: t('vendor.orders.start') }).click();
  await drawer.getByLabel(t('vendor.orders.messagePlaceholder')).fill('On my way');
  await drawer.getByRole('button', { name: t('vendor.orders.send') }).click();
  await expect(drawer.getByText('On my way')).toBeVisible();
  await drawer.getByRole('button', { name: t('vendor.orders.complete') }).click();
  await expect(drawer.getByText(t('vendor.orderStatus.completed')).first()).toBeVisible();

  await drawer.getByRole('button', { name: t('ui.close') }).click();
  await expect(drawer).toBeHidden();
  await page.getByRole('link', { name: t('vendor.nav.earnings') }).click();
  await expect(page.getByText('₦15,000.00').first()).toBeVisible();
});
