import { expect, t, test } from './support/fixtures';
import { createGate, createUnit } from './support/world';

/** Setup wizard (tenancy.md §4.1 step 6): verified steps, then the estate goes live. */
test.use({ estateStatus: 'approved' });

test('setup wizard: complete the required steps and go live', async ({ estate, apiAs, page }) => {
  // The facts the wizard verifies: a unit, a gate and a security supervisor.
  const helper = await apiAs(await estate.seedStaff('estate_administrator', 'Helper Admin'));
  await createUnit(helper, estate.estateId, 'H1');
  await createGate(helper, estate.estateId);
  await estate.seedStaff('security_supervisor', 'Sam Supervisor');

  await estate.open('onboarding');
  await expect(page.getByRole('heading', { name: t('wizard.title'), level: 1 })).toBeVisible();
  const activate = page.getByRole('button', { name: t('wizard.activate') });
  await expect(activate).toBeDisabled();

  for (const step of ['spaces', 'gates', 'security_supervisor', 'sos_policy'] as const) {
    const item = page.getByRole('listitem').filter({ hasText: t(`wizard.step.${step}`) });
    await item.getByRole('button', { name: t('wizard.markDone') }).click();
    await expect(item.getByText(t('dashboard.setup.done'), { exact: true })).toBeVisible();
  }

  await expect(activate).toBeEnabled();
  await activate.click();
  await expect(page.getByText(t('wizard.activeBanner'))).toBeVisible();
  await expect(activate).toBeHidden();
});
