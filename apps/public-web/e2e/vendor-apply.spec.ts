import { expect, t, test } from './support/fixtures';

/** Vendor application (marketplace.md §2): a signed-in person applies and lands in the portal. */
test('vendor apply: a new vendor applies and sees what to do next', async ({
  page,
  seed,
  signIn,
}) => {
  const ade = await seed.user('Ade Plumber');
  await page.goto('/vendors');
  await expect(
    page.getByRole('heading', { level: 1, name: t('public.vendors.title') }),
  ).toBeVisible();
  await page
    .getByRole('link', { name: t('public.vendors.cta') })
    .first()
    .click();
  await signIn(page, ade);

  await expect(page.getByRole('heading', { name: t('vendor.apply.title') })).toBeVisible();
  // Client-side checks before anything is sent.
  await page.getByRole('button', { name: t('vendor.apply.submit') }).click();
  await expect(page.getByText(t('vendor.apply.categoriesRequired'))).toBeVisible();

  await page.getByLabel(t('vendor.apply.name')).fill('Ade Plumbing Works');
  await page
    .getByLabel(t('vendor.apply.descriptionField'))
    .fill('Leak repairs and pipe replacement.');
  await page.getByLabel(t('vendor.apply.email')).fill('ade@example.ng');
  await page.getByLabel('Plumbing', { exact: true }).check();
  await page.getByLabel(t('vendor.apply.areas')).fill('Lagos, Ogun');
  await page.getByRole('button', { name: t('vendor.apply.submit') }).click();

  await expect(page.getByRole('heading', { name: 'Ade Plumbing Works' })).toBeVisible();
  await expect(page.getByText(t('vendor.status.applied'))).toBeVisible();
  await expect(page.getByText(t('vendor.overview.pending'))).toBeVisible();
  await expect(page.getByRole('link', { name: t('vendor.overview.step.payout') })).toBeVisible();
});
