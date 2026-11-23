import { expect, t, test } from './support/fixtures';

/** Assisted onboarding request (public-web.md §6): validates input and creates a lead for Techguard. */
test('contact: an estate representative requests assisted onboarding', async ({
  page,
  techguard,
}) => {
  await page.goto('/contact');
  await expect(
    page.getByRole('heading', { level: 1, name: t('public.contact.title') }),
  ).toBeVisible();

  // Client-side validation catches empty submission.
  await page.getByRole('button', { name: t('public.contact.form.submit') }).click();
  await expect(page.getByText(t('public.contact.form.required'))).toBeVisible();

  await page.getByLabel(t('public.contact.form.name')).fill('Chidi Okonkwo');
  await page.getByLabel(t('public.contact.form.phone')).fill('08031112233');
  await page.getByLabel(t('public.contact.form.email')).fill('chidi@oakview.ng');
  await page.getByLabel(t('public.contact.form.estateName')).fill('Oakview Estate');
  await page.getByLabel(t('public.contact.form.location')).fill('Ikoyi, Lagos');
  await page.getByLabel(t('public.contact.form.units')).fill('140');
  await page.getByLabel(t('public.contact.form.preferredTime')).selectOption('morning');
  await page
    .getByLabel(t('public.contact.form.message'))
    .fill('We would like help migrating our resident list.');

  await page.getByRole('button', { name: t('public.contact.form.submit') }).click();
  await expect(page.getByText(t('public.contact.form.sent'))).toBeVisible();

  const desk = await techguard('platform_administrator');
  const leads = await desk.get<{ estateName: string; name: string }[]>(
    '/v1/platform/onboarding-leads',
  );
  expect(leads).toContainEqual(
    expect.objectContaining({ estateName: 'Oakview Estate', name: 'Chidi Okonkwo' }),
  );
});
