import { randomUUID } from 'node:crypto';
import { expect, t, test } from './support/fixtures';
import { createGate, createUnit, inMinutes, moveIn } from './support/world';

/** Live gate view (visitor.md): a guard admits an invited visitor and the view updates by itself. */
test('live gate view: a guard check-in appears in activity and inside', async ({
  estate,
  apiAs,
  seed,
  page,
}) => {
  const helper = await apiAs(await estate.seedStaff('estate_administrator', 'Helper Admin'));
  const gateId = await createGate(helper, estate.estateId);
  const spaceId = await createUnit(helper, estate.estateId, 'V1');
  const host = await seed.user('Hana Host');
  const householdId = await moveIn(helper, estate.estateId, spaceId, host);
  const resident = await apiAs(host, 'resident');
  const [pass] = await resident.post<{ id: string }[]>(
    `/v1/estates/${estate.estateId}/visitor-invitations`,
    {
      householdId,
      type: 'one_time',
      validFrom: inMinutes(-5),
      validTo: inMinutes(120),
      visitors: [{ name: 'Femi Visitor', phone: '+2348039000099' }],
    },
  );
  if (!pass) throw new Error('no pass created');
  const guard = await apiAs(await estate.seedStaff('security_officer', 'Gbenga Guard'));

  await estate.open('security/live-gate');
  await expect(page.getByRole('heading', { name: t('liveGate.title'), level: 1 })).toBeVisible();
  const activity = page.getByRole('table', { name: t('liveGate.tab.activity') });
  await expect(activity.getByRole('row').filter({ hasText: 'Femi Visitor' })).toHaveCount(0);

  // The guard records the entry while the page is open: realtime (or the 5 s fallback poll) shows it.
  await guard.post(`/v1/estates/${estate.estateId}/gate/events`, {
    clientUuid: randomUUID(),
    gateId,
    direction: 'in',
    decision: 'allow',
    occurredAt: new Date().toISOString(),
    passId: pass.id,
  });
  await expect(activity.getByRole('row').filter({ hasText: 'Femi Visitor' })).toBeVisible({
    timeout: 20_000,
  });

  await page.getByRole('tab', { name: t('liveGate.tab.inside', { count: 1 }) }).click();
  await expect(
    page
      .getByRole('table', { name: t('liveGate.tab.inside', { count: 1 }) })
      .getByRole('row')
      .filter({ hasText: 'Femi Visitor' }),
  ).toBeVisible();
});
