import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryObjectStorage, ObjectStorage } from '../../src/integrations/storage/object-storage';
import { DocumentsService } from '../../src/modules/documents/documents.service';
import { FilesService } from '../../src/modules/files/files.service';
import { signIn, startTestStack, type TestStack, WEB_DEVICE } from './support/app';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

describe('documents', () => {
  let stack: TestStack;
  let estateId: string;
  let manager: string;
  let residentA: string;
  let residentAId: string;
  let residentB: string;
  let blockId: string;
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const url = (path: string) => `/v1/estates/${estateId}${path}`;

  async function upload(token: string): Promise<string> {
    const ticket = await stack.http
      .post(url('/files/upload-url'))
      .set(as(token))
      .send({ purpose: 'document', mimeType: 'application/pdf', sizeBytes: PDF.length })
      .expect(200);
    const fileId = ticket.body.data.fileId as string;
    const key = (
      await stack.db.owner.query<{ storage_key: string }>(
        `select storage_key from platform.files where id = $1`,
        [fileId],
      )
    ).rows[0]?.storage_key;
    (stack.app.get(ObjectStorage) as MemoryObjectStorage).objects.set(key as string, {
      body: PDF,
      contentType: 'application/pdf',
    });
    await stack.http
      .post(url(`/files/${fileId}/complete`))
      .set(as(token))
      .expect(200);
    await stack.app.get(FilesService).scan(fileId);
    return fileId;
  }

  beforeAll(async () => {
    stack = await startTestStack();
    estateId = await stack.createEstate('Docs Estate');
    for (const [phone, role] of [
      ['+2348030700001', 'estate_manager'],
      ['+2348030700002', 'estate_administrator'],
    ] as const) {
      await stack.addMember(estateId, await stack.createUser(phone), role);
    }
    manager = (await signIn(stack, '+2348030700001', WEB_DEVICE)).accessToken;
    const admin = (await signIn(stack, '+2348030700002', WEB_DEVICE)).accessToken;
    await stack.db.owner.query(`update platform.sessions set mfa_verified_at = now()`);
    blockId = (
      await stack.http
        .post(url('/spaces'))
        .set(as(admin))
        .send({ type: 'block', code: 'K' })
        .expect(201)
    ).body.data.id;
    const inBlock = (
      await stack.http
        .post(url('/spaces'))
        .set(as(admin))
        .send({ parentId: blockId, type: 'unit', code: 'K-1' })
        .expect(201)
    ).body.data.id;
    const outside = (
      await stack.http
        .post(url('/spaces'))
        .set(as(admin))
        .send({ type: 'unit', code: 'Z-1' })
        .expect(201)
    ).body.data.id;
    for (const [spaceId, phone] of [
      [inBlock, '+2348030700010'],
      [outside, '+2348030700011'],
    ] as const) {
      await stack.http
        .post(url('/occupancies'))
        .set(as(manager))
        .send({ spaceId, type: 'tenant', head: { fullName: `R ${phone.slice(-2)}`, phone } })
        .expect(201);
    }
    const a = await signIn(stack, '+2348030700010');
    residentA = a.accessToken;
    residentAId = a.user.id;
    residentB = (await signIn(stack, '+2348030700011')).accessToken;
  }, 240_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('shows each resident only the documents whose visibility includes them, and logs access', async () => {
    const rulesFile = await upload(manager);
    const rules = await stack.http
      .post(url('/documents'))
      .set(as(manager))
      .send({
        title: 'Estate rules 2027',
        category: 'estate_rules',
        visibility: { audience: 'residents' },
        fileId: rulesFile,
      })
      .expect(201);
    const blockFile = await upload(manager);
    await stack.http
      .post(url('/documents'))
      .set(as(manager))
      .send({
        title: 'Block K water schedule',
        category: 'notice',
        visibility: { audience: 'spaces', spaceIds: [blockId] },
        fileId: blockFile,
      })
      .expect(201);
    const privateFile = await upload(manager);
    await stack.http
      .post(url('/documents'))
      .set(as(manager))
      .send({
        title: 'Tenancy agreement K-1',
        category: 'resident',
        visibility: { audience: 'user', userId: residentAId },
        fileId: privateFile,
        expiresOn: '2027-01-31',
      })
      .expect(201);
    await stack.http
      .post(url('/documents'))
      .set(as(residentA))
      .send({
        title: 'Mine',
        category: 'other',
        visibility: { audience: 'residents' },
        fileId: rulesFile,
      })
      .expect(403);

    const forA = await stack.http.get(url('/documents')).set(as(residentA)).expect(200);
    expect(forA.body.data.map((d: { title: string }) => d.title).sort()).toEqual([
      'Block K water schedule',
      'Estate rules 2027',
      'Tenancy agreement K-1',
    ]);
    const forB = await stack.http.get(url('/documents')).set(as(residentB)).expect(200);
    expect(forB.body.data.map((d: { title: string }) => d.title)).toEqual(['Estate rules 2027']);

    const link = await stack.http
      .post(url(`/documents/${rules.body.data.id}/download`))
      .set(as(residentB))
      .expect(200);
    expect(link.body.data.url).toContain('memory://get/');
    const log = await stack.http
      .get(url(`/documents/${rules.body.data.id}/access-log`))
      .set(as(manager))
      .expect(200);
    expect(log.body.data.map((row: { action: string }) => row.action)).toContain('download');
  });

  it('versions documents, hides archived ones and reminds before expiry', async () => {
    const [doc] = (
      await stack.http.get(url('/documents')).query({ q: 'rules' }).set(as(manager)).expect(200)
    ).body.data;
    const next = await upload(manager);
    const versioned = await stack.http
      .post(url(`/documents/${doc.id}/versions`))
      .set(as(manager))
      .send({ fileId: next, notes: 'Updated parking rules' })
      .expect(201);
    expect(versioned.body.data.currentVersion).toBe(2);
    expect(versioned.body.data.versions).toHaveLength(2);
    await stack.http
      .post(url(`/documents/${doc.id}/archive`))
      .set(as(manager))
      .expect(200);
    await stack.http
      .get(url(`/documents/${doc.id}`))
      .set(as(residentB))
      .expect(404);
    expect(await stack.app.get(DocumentsService).expiryReminders(estateId, '2027-01-24')).toBe(1);
  });
});
