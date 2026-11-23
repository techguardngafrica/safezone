import { expect, t, test } from './support/fixtures';

/** Advertising enquiry (public-web.md §7): checks first, then a submitted enquiry reaches Techguard. */
test('advertise: an organisation sends an enquiry', async ({ page, techguard }) => {
  await page.goto('/advertise');
  await expect(
    page.getByRole('heading', { level: 1, name: t('public.advertise.title') }),
  ).toBeVisible();
  await expect(page.getByText(t('public.advertise.never.body'))).toBeVisible();

  await page.getByRole('button', { name: t('public.advertise.form.submit') }).click();
  await expect(page.getByText(t('public.advertise.form.required'))).toBeVisible();

  await page.getByLabel(t('public.advertise.form.name')).fill('Ngozi Okafor');
  await page.getByLabel(t('public.advertise.form.org')).fill('Fresh Mart Lekki');
  await page.getByLabel(t('public.advertise.form.phone')).fill('08031230000');
  await page.getByLabel(t('public.advertise.form.email')).fill('ngozi@example.ng');
  await page.getByLabel(t('public.advertise.form.objectives')).fill('Store opening week');
  await page
    .getByLabel(t('public.advertise.form.description'))
    .fill('New supermarket near the estates in Lekki.');
  await page.getByLabel(t('ads.placement.resident.home.banner')).check();
  await page
    .getByRole('checkbox', { name: new RegExp(t('public.advertise.form.consent')) })
    .check();
  await page.getByRole('button', { name: t('public.advertise.form.submit') }).click();
  await expect(page.getByText(t('public.advertise.form.sent'))).toBeVisible();

  // Follow the link-based enquiry status tracker (public-web.md §7).
  await page.getByRole('link', { name: t('public.advertise.form.trackLink') }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: t('public.advertise.status.title') }),
  ).toBeVisible();
  await expect(page.getByText('Fresh Mart Lekki')).toBeVisible();
  await expect(
    page.getByText(t('public.advertise.status.label.submitted'), { exact: true }).first(),
  ).toBeVisible();

  const desk = await techguard('advertising_manager');
  const enquiries = await desk.get<{ id: string; orgName: string | null; placements: string[] }[]>(
    '/v1/platform/ad-enquiries',
  );
  const created = enquiries.find((e) => e.orgName === 'Fresh Mart Lekki');
  expect(created).toBeDefined();
  expect(created?.placements).toEqual(['resident.home.banner']);

  // Status update made by Techguard is reflected on the tracking link.
  await desk.request('PATCH', `/v1/platform/ad-enquiries/${created?.id}`, {
    status: 'proposal_sent',
  });
  await page.reload();
  await expect(
    page.getByText(t('public.advertise.status.label.proposal_sent'), { exact: true }),
  ).toBeVisible();
});
