import { expect, t, test } from './support/fixtures';
import { createUnit, lagosDate, moveIn } from './support/world';

/**
 * Billing run and payment (billing.md, payments.md), maker-checker: the accountant prepares a run and
 * records an office payment; the administrator approves the run, the accountant issues it, and the administrator approves the payment.
 */
test('billing run and payment: approve a run, see it issued, approve an office payment', async ({
  estate,
  apiAs,
  seed,
  page,
}) => {
  const base = `/v1/estates/${estate.estateId}`;
  const helper = await apiAs(await estate.seedStaff('estate_administrator', 'Helper Admin'));
  const accountant = await apiAs(await estate.seedStaff('estate_accountant', 'Ade Accountant'));
  const payer = await seed.user('Ada Payer');
  await moveIn(helper, estate.estateId, await createUnit(helper, estate.estateId, 'B1'), payer);

  const charge = await accountant.post<{ id: string }>(`${base}/charges`, {
    type: 'estate_dues',
    name: 'Monthly dues',
    amountRule: { kind: 'fixed', amount: 2_500_000 },
    frequency: 'monthly',
    startsOn: lagosDate(-60),
  });
  const label = 'E2E dues run';
  const run = await accountant.post<{ id: string }>(`${base}/billing-runs`, {
    label,
    periodStart: lagosDate(0),
    periodEnd: lagosDate(29),
    dueDate: lagosDate(14),
    chargeIds: [charge.id],
  });
  await accountant.post(`${base}/billing-runs/${run.id}/preview`);
  await accountant.post(`${base}/billing-runs/${run.id}/submit`);

  // The administrator approves the run.
  await estate.open('finance/billing-runs');
  const runs = page.getByRole('table', { name: t('run.title') });
  const row = runs.getByRole('row').filter({ hasText: label });
  await expect(row).toContainText(t('run.status.awaiting_approval'));
  await row.click();
  const drawer = page.getByRole('dialog', { name: label });
  await drawer.getByRole('button', { name: t('run.approve') }).click();
  const approve = page.getByRole('dialog', { name: t('run.approve.title', { label }) });
  await approve.getByRole('button', { name: t('run.approve') }).click();
  await expect(approve).toBeHidden();
  await expect(row).toContainText(t('run.status.approved'));

  // Issuing is the preparer's step (billing.run.create): the administrator's drawer offers no Issue.
  await expect(drawer.getByRole('button', { name: t('run.issue') })).toHaveCount(0);
  await accountant.post(`${base}/billing-runs/${run.id}/issue`);
  await page.reload();
  await expect(row).toContainText(t('run.status.issued'), { timeout: 30_000 });
  await row.click();
  await expect(drawer.getByText(t('run.status.issued'), { exact: true }).first()).toBeVisible();
  await expect(drawer.getByRole('row').filter({ hasText: 'B1' })).toContainText(payer.fullName);
  await drawer.getByRole('button', { name: t('ui.close') }).click();

  // The accountant records a cash payment at the office; the administrator approves it.
  await accountant.post(`${base}/manual-payments`, {
    payerUserId: payer.id,
    amount: 2_500_000,
    method: 'cash',
    receivedOn: lagosDate(0),
    reference: 'E2E-RCPT-1',
  });
  await estate.open('finance/payments');
  const office = page.getByRole('table', { name: t('payment.tab.office') });
  const payment = office.getByRole('row').filter({ hasText: 'E2E-RCPT-1' });
  await expect(payment).toContainText(t('payment.office.status.pending'));
  await payment.getByRole('button', { name: t('payment.office.approve') }).click();
  const confirm = page.getByRole('dialog');
  await confirm.getByRole('button', { name: t('payment.office.approve') }).click();
  await expect(confirm).toBeHidden();
  await expect(payment).toBeHidden();

  await page.getByLabel(t('payment.office.filter')).selectOption('approved');
  await expect(office.getByRole('row').filter({ hasText: 'E2E-RCPT-1' })).toContainText(
    t('payment.office.status.approved'),
  );
});
