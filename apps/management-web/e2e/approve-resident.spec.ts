import { expect, t, test } from './support/fixtures';
import { createUnit } from './support/world';

/** Join requests (occupancy.md): a tenant asks to join from the Resident App, management approves. */
test('approve resident: a join request is approved from the queue', async ({
  estate,
  apiAs,
  seed,
  page,
}) => {
  const helper = await apiAs(await estate.seedStaff('estate_administrator', 'Helper Admin'));
  const spaceId = await createUnit(helper, estate.estateId, 'A1');
  // Not a member yet: the resident asks to join through the API, as the Resident App does.
  const tola = await seed.user('Tola Tenant');
  const resident = await apiAs(tola, 'resident');
  await resident.post('/v1/me/join-requests', {
    estateId: estate.estateId,
    spaceId,
    relationship: 'tenant',
    fullName: tola.fullName,
  });

  await estate.open('people/join-requests');
  const table = page.getByRole('table', { name: t('join.title') });
  const row = table.getByRole('row').filter({ hasText: tola.fullName });
  await expect(row).toContainText('A1');
  await expect(row).toContainText(t('join.status.awaiting_manager'));
  await row.getByRole('button', { name: t('join.approve') }).click();

  const dialog = page.getByRole('dialog', {
    name: t('join.approveConfirm.title', { name: tola.fullName }),
  });
  await dialog.getByRole('button', { name: t('join.approve') }).click();
  await expect(dialog).toBeHidden();
  await expect(row).toBeHidden();

  await page.getByRole('tab', { name: t('join.tab.approved') }).click();
  await expect(table.getByRole('row').filter({ hasText: tola.fullName })).toContainText(
    t('join.status.approved'),
  );

  // The resident is now a member with a household in the unit.
  const households = await resident.get<{ unit: { code: string } }[]>(
    `/v1/estates/${estate.estateId}/households/mine`,
  );
  expect(households.map((household) => household.unit.code)).toEqual(['A1']);
});
