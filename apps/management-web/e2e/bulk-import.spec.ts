import { readFile } from 'node:fs/promises';
import { expect, t, test } from './support/fixtures';

/**
 * Bulk import (management-web.md §4.3, imports.md): template download, dry run with an error row,
 * confirm, the worker runs the job through the property module, and the result counts show.
 */
test('bulk import: template, dry run with an error row, confirm, worker result', async ({
  estate,
  apiAs,
  page,
}) => {
  const base = `/v1/estates/${estate.estateId}/imports`;
  // An earlier import of A-101 (through the API) so the UI run reports it as already up to date.
  const manager = await apiAs(await estate.seedStaff('estate_administrator', 'Mo Manager'));
  const earlier = await manager.post<{ id: string }>(`${base}/dry-run`, {
    kind: 'units',
    filename: 'first.csv',
    csv: 'code,name,unit_type,bedrooms,unit_status\nA-101,Flat 101,flat,3,vacant\n',
  });
  await manager.post(`${base}/${earlier.id}/confirm`);
  await expect
    .poll(async () => (await manager.get<{ status: string }>(`${base}/${earlier.id}`)).status, {
      timeout: 60_000,
    })
    .toBe('completed');

  await estate.open('estate/import');
  await expect(page.getByRole('heading', { name: t('import.title'), level: 1 })).toBeVisible();

  // 1. Download the template for the selected dataset (units).
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: t('import.downloadTemplate') }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  const template = await readFile(await download.path(), 'utf8');
  const header = template.split(/\r?\n/)[0] ?? '';
  expect(header.split(',')).toEqual(expect.arrayContaining(['code', 'name']));

  // 2. Fill the template: one unchanged row, two new ones and a row without its code.
  const columns = header.split(',');
  const row = (values: Record<string, string>) =>
    columns.map((column) => values[column] ?? '').join(',');
  const csv = [
    header,
    row({
      code: 'A-101',
      name: 'Flat 101',
      unit_type: 'flat',
      bedrooms: '3',
      unit_status: 'vacant',
    }),
    row({ code: 'A-102', name: 'Flat 102', unit_type: 'flat', bedrooms: '2' }),
    row({ code: 'B-201', name: 'House 201', unit_type: 'house', unit_status: 'reserved' }),
    row({ name: 'Missing code', unit_type: 'flat', bedrooms: '1' }),
  ].join('\n');
  await page.getByLabel(t('import.file')).setInputFiles({
    name: 'units.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(`${csv}\n`, 'utf8'),
  });

  // 3. Dry run: three valid rows, one error on row 5 (the header is row 1).
  await page.getByRole('button', { name: t('import.runDryRun') }).click();
  await expect(
    page.getByText(t('import.summary', { filename: 'units.csv', total: 4, valid: 3, errors: 1 })),
  ).toBeVisible();
  const errors = page.getByRole('table', { name: t('import.errors', { count: 1 }) });
  await expect(errors).toBeVisible();
  await expect(errors.getByRole('row').nth(1)).toContainText('5');
  await expect(errors.getByRole('row').nth(1)).toContainText('code');

  // 4. Confirm the valid rows; the worker runs the job and the page polls until it finishes.
  await page.getByRole('button', { name: t('import.confirm', { count: 3 }) }).click();
  await expect(
    page.getByText(t('import.result', { created: 2, updated: 0, unchanged: 1, failed: 0 })),
  ).toBeVisible({ timeout: 60_000 });

  // 5. History lists both jobs as completed with their counts.
  const history = page.getByRole('table', { name: t('import.history') });
  const latest = history.getByRole('row').filter({ hasText: 'units.csv' });
  await expect(latest).toContainText(t('import.status.completed'));
  await expect(latest).toContainText('2 / 0 / 1 / 0');
  await expect(history.getByRole('row').filter({ hasText: 'first.csv' })).toContainText(
    t('import.status.completed'),
  );
});
