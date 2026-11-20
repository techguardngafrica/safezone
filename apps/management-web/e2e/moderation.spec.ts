import { expect, t, test } from './support/fixtures';
import { createUnit, moveIn } from './support/world';

/** Moderation (community.md): a reported message is removed in one action from the queue. */
test('moderation: remove a reported message from the queue', async ({
  estate,
  apiAs,
  seed,
  page,
}) => {
  const helper = await apiAs(await estate.seedStaff('estate_administrator', 'Helper Admin'));
  const base = `/v1/estates/${estate.estateId}`;
  const [ada, bola] = [await seed.user('Ada Reporter'), await seed.user('Bola Poster')];
  for (const [code, person] of [
    ['M1', ada],
    ['M2', bola],
  ] as const)
    await moveIn(helper, estate.estateId, await createUnit(helper, estate.estateId, code), person);
  const [reporter, poster] = [await apiAs(ada, 'resident'), await apiAs(bola, 'resident')];
  for (const session of [reporter, poster])
    await session.post(`${base}/community/guidelines/accept`);

  const channels = await poster.get<{ id: string; name: string }[]>(`${base}/channels`);
  const general = channels.find((channel) => channel.name === 'General');
  if (!general) throw new Error('no General channel');
  const message = await poster.post<{ id: string }>(`${base}/channels/${general.id}/messages`, {
    body: 'Buy cheap gold, DM me',
  });
  await reporter.post(`${base}/reports`, {
    targetType: 'message',
    targetId: message.id,
    reason: 'scam',
  });

  await estate.open('community/moderation');
  const queue = page.getByRole('table', { name: t('moderation.tab.queue', { count: 1 }) });
  const report = queue.getByRole('row').filter({ hasText: 'scam' });
  await expect(report).toBeVisible();
  await report.getByRole('button', { name: t('mw.moderation.takeAction') }).click();

  const dialog = page.getByRole('dialog', { name: t('mw.moderation.takeModerationAction') });
  await dialog.getByLabel(t('mw.moderation.moderationReason')).fill('Scam advert');
  await dialog.getByRole('button', { name: t('mw.moderation.enforce') }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole('table', { name: t('moderation.tab.queue', { count: 0 }) }),
  ).toBeVisible();

  await page.getByRole('tab', { name: t('moderation.tab.actions') }).click();
  await expect(
    page
      .getByRole('table', { name: t('moderation.tab.actions') })
      .getByRole('row')
      .filter({ hasText: 'Scam advert' }),
  ).toBeVisible();

  // The message is removed for residents.
  const history = await reporter.get<{ id: string; state: string; body: string | null }[]>(
    `${base}/channels/${general.id}/messages`,
  );
  expect(history.find((item) => item.id === message.id)).toMatchObject({
    state: 'removed',
    body: null,
  });
});
