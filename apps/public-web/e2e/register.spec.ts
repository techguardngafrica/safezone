import { expect, t, test } from './support/fixtures';

const MINIMAL_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n',
  'utf8',
);

/** Self-service estate registration (public-web.md §5): OTP sign-in, multi-step wizard, document upload, status view. */
test('register: an estate representative submits a self-service application with proof of authority', async ({
  page,
  seed,
  signIn,
  techguard,
}) => {
  const rep = await seed.user('Amaka Representative');

  await page.goto('/register');
  await expect(
    page.getByRole('heading', { level: 1, name: t('public.register.title') }),
  ).toBeVisible();
  await signIn(page, rep);

  // Step 1: Representative details
  await page.getByLabel(t('public.register.rep.fullName')).fill('Amaka Nwosu');
  await page.getByLabel(t('public.register.rep.email')).fill('amaka@palmcrest.ng');
  await page.getByLabel(t('public.register.rep.role')).selectOption('manager');
  await page.getByRole('button', { name: t('public.register.next') }).click();

  // Step 2: Estate details
  await page.getByLabel(t('public.register.estate.name')).fill('Palmcrest Estate');
  await page.getByLabel(t('public.register.estate.type')).selectOption('gated_houses');
  await page
    .getByLabel(t('public.register.estate.address'))
    .fill('14 Admiralty Way, Lekki Phase 1');
  await page.getByLabel(t('public.register.estate.state')).selectOption('Lagos');
  await page.getByLabel(t('public.register.estate.lga')).fill('Eti-Osa');
  await page.getByLabel(t('public.register.estate.units')).fill('85');
  await page.getByLabel(t('public.register.estate.gates')).fill('2');
  await page.getByRole('button', { name: t('public.register.next') }).click();

  // Step 3: Supporting documents
  await page.locator('input[type="file"]').setInputFiles({
    name: 'authority-letter.pdf',
    mimeType: 'application/pdf',
    buffer: MINIMAL_PDF,
  });
  await expect(page.getByText('authority-letter.pdf')).toBeVisible();
  await page.getByRole('button', { name: t('public.register.next') }).click();

  // Step 4: Review and consent
  await expect(page.getByText(t('public.register.review.freeNote'))).toBeVisible();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: t('public.register.review.submit') }).click();

  // Status view
  await expect(page.getByText('Palmcrest Estate')).toBeVisible();
  await expect(page.getByText(t('public.register.apps.status.submitted'))).toBeVisible();

  const desk = await techguard('platform_administrator');
  const applications = await desk.get<{ estate: { name: string } }[]>(
    '/v1/platform/estate-applications',
  );
  expect(applications).toContainEqual(
    expect.objectContaining({ estate: expect.objectContaining({ name: 'Palmcrest Estate' }) }),
  );
});
