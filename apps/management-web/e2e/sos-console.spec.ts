import { randomUUID } from 'node:crypto';
import { expect, t, test } from './support/fixtures';
import { createUnit, moveIn } from './support/world';

/** SOS console (emergency.md): an alert arrives live, is acknowledged and then resolved. */
test('SOS console: acknowledge and resolve a live alert', async ({ estate, apiAs, seed, page }) => {
  const helper = await apiAs(await estate.seedStaff('estate_administrator', 'Helper Admin'));
  const spaceId = await createUnit(helper, estate.estateId, 'S1');
  const rita = await seed.user('Rita Resident');
  await moveIn(helper, estate.estateId, spaceId, rita, 'owner_occupier');
  const resident = await apiAs(rita, 'resident');

  await estate.open('security/sos');
  await expect(page.getByRole('heading', { name: t('sos.console.title'), level: 1 })).toBeVisible();
  await expect(page.getByText(t('sos.console.emptyActive'))).toBeVisible();

  await resident.post(
    `/v1/estates/${estate.estateId}/sos`,
    { category: 'security_threat' },
    { 'Idempotency-Key': randomUUID() },
  );
  const alert = page.getByRole('button').filter({ hasText: 'S1' });
  await expect(alert).toContainText(t('sos.status.triggered'), { timeout: 20_000 });
  await alert.click();

  const detail = page.getByRole('heading', { name: t('sos.detail.title', { unit: 'S1' }) });
  await expect(detail).toBeVisible();
  await page.getByRole('button', { name: t('sos.action.acknowledge') }).click();
  await expect(alert).toContainText(t('sos.status.acknowledged'));

  await page.getByRole('button', { name: t('sos.action.resolve') }).click();
  const dialog = page.getByRole('dialog', { name: t('sos.dialog.resolve.title') });
  await dialog
    .getByLabel(t('sos.dialog.resolve.label'))
    .fill('Patrol attended; intruder had left the estate.');
  await dialog.getByRole('button', { name: t('sos.dialog.resolve.submit') }).click();
  await expect(dialog).toBeHidden();

  // Resolved alerts leave the active list and show in history with the resolution.
  await expect(page.getByText(t('sos.console.emptyActive'))).toBeVisible();
  await page.getByRole('tab', { name: t('sos.console.history') }).click();
  const resolved = page.getByRole('button').filter({ hasText: 'S1' });
  await expect(resolved).toContainText(t('sos.status.resolved'));
  await resolved.click();
  await expect(page.getByText('Patrol attended; intruder had left the estate.')).toBeVisible();
});
