import { expect, t, test } from './support/fixtures';

/** Maintenance work order (maintenance.md): create, add material, the job is done, management verifies. */
test('maintenance work order: create, add material, verify completion', async ({
  estate,
  apiAs,
  page,
}) => {
  const base = `/v1/estates/${estate.estateId}`;
  const title = 'Replace street light pole 4';

  await estate.open('operations/work-orders');
  await page.getByRole('button', { name: t('workOrders.create') }).click();
  const create = page.getByRole('dialog', { name: t('workOrders.create') });
  await create.getByLabel(t('mw.work_orders.title')).fill(title);
  await create.getByLabel(t('mw.work_orders.scopeOfWork')).fill('Swap the damaged pole and lamp.');
  await create.getByRole('button', { name: t('common.save') }).click();
  await expect(create).toBeHidden();

  const orders = page.getByRole('table', { name: t('workOrders.title') });
  const row = orders.getByRole('row').filter({ hasText: title });
  await expect(row).toContainText('open');

  await row.getByRole('button', { name: t('workOrders.addMaterial') }).click();
  const material = page.getByRole('dialog', {
    name: `${t('workOrders.addMaterial')} (${title})`,
  });
  await material.getByLabel(t('mw.work_orders.materialItem')).fill('LED lamp 100W');
  await material.getByLabel(t('mw.work_orders.quantity')).fill('2');
  await material.getByLabel(t('mw.work_orders.unitCostNgn')).fill('15000');
  await material.getByRole('button', { name: t('common.save') }).click();
  await expect(material).toBeHidden();

  // The technician's side (Management mobile) moves the job to completed.
  const technician = await apiAs(await estate.seedStaff('estate_administrator', 'Tunde Tech'));
  const listed = await technician.get<{ id: string; title: string }[]>(`${base}/work-orders`);
  const order = listed.find((item) => item.title === title);
  if (!order) throw new Error('work order not found');
  const detail = await technician.get<{ materials?: { item: string }[] }>(
    `${base}/work-orders/${order.id}`,
  );
  expect(detail.materials?.map((item) => item.item)).toEqual(['LED lamp 100W']);
  await technician.patch(`${base}/work-orders/${order.id}`, { status: 'in_progress' });
  await technician.patch(`${base}/work-orders/${order.id}`, {
    status: 'completed',
    resolutionNotes: 'Pole and lamp replaced',
  });

  await page.reload();
  await expect(row).toContainText('completed');
  await row.getByRole('button', { name: t('workOrders.verify') }).click();
  await expect(row).toContainText('verified');
});
