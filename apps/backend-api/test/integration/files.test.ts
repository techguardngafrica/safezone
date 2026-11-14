import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OutboxRelay } from '../../src/common/outbox/outbox-relay';
import { WorkerModule } from '../../src/worker/worker.module';
import { signIn, startTestStack, type TestStack } from './support/app';

const BUCKET = 'safezone-test';
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

function segment(marker: number, payload: Buffer): Buffer {
  const header = Buffer.from([0xff, marker, 0, 0]);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}
const jpegWithGps = Buffer.concat([
  Buffer.from([0xff, 0xd8]),
  segment(0xe0, Buffer.from('JFIF\0\x01\x01')),
  segment(0xe1, Buffer.from('Exif\0\0GPSLatitude=6.4281N')),
  segment(0xdb, Buffer.alloc(65, 1)),
  Buffer.from([0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0x11, 0x22, 0xff, 0xd9]),
]);

async function waitFor(check: () => Promise<boolean>, timeoutMs = 20_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('condition not met in time');
}

describe('file service (S3-compatible storage)', () => {
  let storageServer: StartedTestContainer;
  let stack: TestStack;
  let worker: INestApplicationContext;
  let relay: OutboxRelay;
  let estateId: string;
  let residentToken: string;
  let neighbourToken: string;
  let guardToken: string;

  beforeAll(async () => {
    // S3-compatible server that verifies signatures (MinIO community images are no longer published).
    storageServer = await new GenericContainer('rustfs/rustfs:latest')
      .withEnvironment({ RUSTFS_ACCESS_KEY: 'minio', RUSTFS_SECRET_KEY: 'minio-password' })
      .withExposedPorts(9000)
      .withWaitStrategy(Wait.forListeningPorts())
      .start();
    const endpoint = `http://${storageServer.getHost()}:${storageServer.getMappedPort(9000)}`;
    const s3 = new S3Client({
      endpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: 'minio', secretAccessKey: 'minio-password' },
    });
    // The port opens slightly before the S3 API is ready.
    await waitFor(async () => {
      try {
        await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
        return true;
      } catch {
        return false;
      }
    }, 30_000);

    stack = await startTestStack({
      env: {
        STORAGE_ENDPOINT: endpoint,
        STORAGE_BUCKET: BUCKET,
        STORAGE_ACCESS_KEY_ID: 'minio',
        STORAGE_SECRET_ACCESS_KEY: 'minio-password',
        STORAGE_FORCE_PATH_STYLE: 'true',
      },
      realStorage: true,
    });
    process.env.OUTBOX_RELAY_DISABLED = 'true';
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    worker = moduleRef.createNestApplication();
    await (worker as unknown as { init(): Promise<void> }).init();
    relay = worker.get(OutboxRelay);

    estateId = await stack.createEstate('Files Estate');
    const make = async (phone: string, role: string) => {
      const id = await stack.createUser(phone);
      await stack.addMember(estateId, id, role);
      await stack.resetRateLimits();
      const session = await signIn(stack, phone);
      if (role !== 'tenant') {
        await stack.db.owner.query(
          `update platform.sessions set mfa_verified_at = now() where user_id = $1`,
          [id],
        );
      }
      return session.accessToken;
    };
    residentToken = await make('+2348034000001', 'tenant');
    neighbourToken = await make('+2348034000002', 'tenant');
    guardToken = await make('+2348034000003', 'security_officer');
  }, 240_000);

  afterAll(async () => {
    await worker?.close();
    await stack?.stop();
    await storageServer?.stop();
  });

  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function upload(token: string, purpose: string, mimeType: string, body: Buffer) {
    const ticket = await stack.http
      .post(`/v1/estates/${estateId}/files/upload-url`)
      .set(as(token))
      .send({ purpose, mimeType, sizeBytes: body.length })
      .expect(200);
    const { fileId, uploadUrl, headers } = ticket.body.data as {
      fileId: string;
      uploadUrl: string;
      headers: Record<string, string>;
    };
    const put = await fetch(uploadUrl, { method: 'PUT', headers, body });
    expect(put.status).toBe(200);
    await stack.http
      .post(`/v1/estates/${estateId}/files/${fileId}/complete`)
      .set(as(token))
      .expect(200);
    while ((await relay.relayBatch()) > 0) {
      /* drain */
    }
    return fileId;
  }

  async function statusOf(token: string, fileId: string): Promise<string> {
    const response = await stack.http
      .get(`/v1/estates/${estateId}/files/${fileId}`)
      .set(as(token))
      .expect(200);
    return response.body.data.status as string;
  }

  it('uploads directly to storage, scans, strips GPS EXIF and serves a short-lived download', async () => {
    const fileId = await upload(residentToken, 'pass_photo', 'image/jpeg', jpegWithGps);
    await waitFor(async () => (await statusOf(residentToken, fileId)) === 'clean');

    const link = await stack.http
      .get(`/v1/estates/${estateId}/files/${fileId}/download-url`)
      .set(as(residentToken))
      .expect(200);
    const downloaded = Buffer.from(await (await fetch(link.body.data.url)).arrayBuffer());
    expect(downloaded.includes(Buffer.from('GPSLatitude'))).toBe(false);
    expect(downloaded.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))).toBe(true);

    // A guard (gate.verify) may see pass photos; another resident may not.
    await stack.http
      .get(`/v1/estates/${estateId}/files/${fileId}/download-url`)
      .set(as(guardToken))
      .expect(200);
    await stack.http
      .get(`/v1/estates/${estateId}/files/${fileId}/download-url`)
      .set(as(neighbourToken))
      .expect(403);
  });

  it('refuses an upload that does not match the signed size', async () => {
    const ticket = await stack.http
      .post(`/v1/estates/${estateId}/files/upload-url`)
      .set(as(residentToken))
      .send({ purpose: 'pass_photo', mimeType: 'image/jpeg', sizeBytes: 10 })
      .expect(200);
    const { uploadUrl, headers } = ticket.body.data as {
      uploadUrl: string;
      headers: Record<string, string>;
    };
    const put = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { ...headers, 'Content-Length': String(jpegWithGps.length) },
      body: jpegWithGps,
    });
    expect(put.status).toBeGreaterThanOrEqual(400);
  });

  it('quarantines infected files and never serves them', async () => {
    const fileId = await upload(
      residentToken,
      'maintenance',
      'image/jpeg',
      Buffer.from(EICAR, 'latin1'),
    );
    await waitFor(async () => (await statusOf(residentToken, fileId)) === 'infected');
    const response = await stack.http
      .get(`/v1/estates/${estateId}/files/${fileId}/download-url`)
      .set(as(residentToken))
      .expect(409);
    expect(response.body.error.code).toBe('FILE_NOT_READY');
  });

  it('rejects content that is not what was declared', async () => {
    const fileId = await upload(
      residentToken,
      'maintenance',
      'image/png',
      Buffer.from('MZ fake executable bytes'),
    );
    await waitFor(async () => (await statusOf(residentToken, fileId)) === 'rejected');
  });

  it('enforces type, size and permission rules per purpose', async () => {
    const post = (token: string, body: object) =>
      stack.http.post(`/v1/estates/${estateId}/files/upload-url`).set(as(token)).send(body);
    expect(
      (await post(residentToken, { purpose: 'pass_photo', mimeType: 'image/png', sizeBytes: 100 }))
        .body.error.code,
    ).toBe('FILE_TYPE_NOT_ALLOWED');
    expect(
      (
        await post(residentToken, {
          purpose: 'pass_photo',
          mimeType: 'image/jpeg',
          sizeBytes: 3 * 1024 * 1024,
        })
      ).body.error.code,
    ).toBe('FILE_TOO_LARGE');
    await post(residentToken, {
      purpose: 'document',
      mimeType: 'application/pdf',
      sizeBytes: 100,
    }).expect(403);
    await post(residentToken, { purpose: 'avatar', mimeType: 'image/png', sizeBytes: 100 }).expect(
      400,
    );
  });

  it('keeps personal files private to their uploader', async () => {
    const ticket = await stack.http
      .post('/v1/me/files/upload-url')
      .set(as(residentToken))
      .send({ purpose: 'avatar', mimeType: 'image/jpeg', sizeBytes: jpegWithGps.length })
      .expect(200);
    const fileId = ticket.body.data.fileId as string;
    await stack.http.get(`/v1/me/files/${fileId}`).set(as(residentToken)).expect(200);
    await stack.http.get(`/v1/me/files/${fileId}`).set(as(neighbourToken)).expect(404);
  });
});
