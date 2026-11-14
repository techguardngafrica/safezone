import { inflateRawSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EstateExportRegistry } from '../../src/common/export/export-registry';
import { MemoryObjectStorage, ObjectStorage } from '../../src/integrations/storage/object-storage';
import { ExportsService } from '../../src/modules/platform/exports/exports.service';
import { signIn, startTestStack, type TestStack, WEB_DEVICE } from './support/app';

function unzipNames(zip: Buffer): Map<string, string> {
  const end = zip.length - 22;
  const count = zip.readUInt16LE(end + 10);
  let cursor = zip.readUInt32LE(end + 16);
  const files = new Map<string, string>();
  for (let i = 0; i < count; i += 1) {
    const size = zip.readUInt32LE(cursor + 20);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const local = zip.readUInt32LE(cursor + 42);
    const name = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    const start = local + 30 + zip.readUInt16LE(local + 26);
    files.set(name, inflateRawSync(zip.subarray(start, start + size)).toString('utf8'));
    cursor += 46 + nameLength;
  }
  return files;
}

describe('estate data export', () => {
  let stack: TestStack;
  let estateId: string;
  let otherEstateId: string;
  let admin: string;
  let manager: string;
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const url = (path: string) => `/v1/estates/${estateId}${path}`;

  beforeAll(async () => {
    stack = await startTestStack();
    estateId = await stack.createEstate('Export Estate');
    otherEstateId = await stack.createEstate('Other Estate');
    for (const [phone, role, estate] of [
      ['+2348030500001', 'estate_administrator', estateId],
      ['+2348030500002', 'estate_manager', estateId],
      ['+2348030500003', 'estate_administrator', otherEstateId],
    ] as const) {
      const userId = await stack.createUser(phone);
      await stack.addMember(estate, userId, role);
    }
    admin = (await signIn(stack, '+2348030500001', WEB_DEVICE)).accessToken;
    manager = (await signIn(stack, '+2348030500002', WEB_DEVICE)).accessToken;
    const other = (await signIn(stack, '+2348030500003', WEB_DEVICE)).accessToken;
    await stack.db.owner.query(`update platform.sessions set mfa_verified_at = now()`);
    await stack.http
      .post(url('/spaces'))
      .set(as(admin))
      .send({ type: 'unit', code: 'X-1' })
      .expect(201);
    await stack.http
      .post(`/v1/estates/${otherEstateId}/spaces`)
      .set(as(other))
      .send({ type: 'unit', code: 'SECRET-9' })
      .expect(201);
  }, 240_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('builds a ZIP of every registered dataset for this estate only', async () => {
    await stack.http.post(url('/exports')).set(as(manager)).expect(403);
    const requested = await stack.http.post(url('/exports')).set(as(admin)).expect(201);
    expect(requested.body.data.status).toBe('queued');
    await stack.http.post(url('/exports')).set(as(admin)).expect(409);
    await stack.http
      .post(url(`/exports/${requested.body.data.id}/download`))
      .set(as(admin))
      .expect(409);

    await stack.app.get(ExportsService).build(estateId, requested.body.data.id);
    const [listed] = (await stack.http.get(url('/exports')).set(as(admin)).expect(200)).body.data;
    expect(listed).toMatchObject({
      status: 'ready',
      datasets: expect.objectContaining({ 'property/spaces': 1 }),
    });
    const download = await stack.http
      .post(url(`/exports/${requested.body.data.id}/download`))
      .set(as(admin))
      .expect(200);
    expect(download.body.data.url).toContain(`exports%2F${estateId}`);

    const storage = stack.app.get(ObjectStorage) as MemoryObjectStorage;
    const zip = storage.objects.get(`exports/${estateId}/${requested.body.data.id}.zip`);
    const files = unzipNames(zip?.body as Buffer);
    const datasets = stack.app
      .get(EstateExportRegistry)
      .all()
      .map((dataset) => dataset.name);
    expect(datasets).toEqual(
      expect.arrayContaining([
        'billing/invoices',
        'audit/events',
        'visitors/passes',
        'emergency/sos_alerts',
      ]),
    );
    for (const name of datasets) {
      expect(files.has(`${name}.csv`)).toBe(true);
      expect(files.has(`${name}.json`)).toBe(true);
    }
    expect(files.get('property/spaces.csv')).toContain('X-1');
    expect([...files.values()].join('')).not.toContain('SECRET-9');
    expect(files.get('visitors/passes.csv')).not.toContain('pinWrapped');
  });
});
