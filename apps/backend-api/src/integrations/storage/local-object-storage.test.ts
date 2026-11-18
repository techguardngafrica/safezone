import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mountDevStorage } from './dev-storage-routes';
import { LocalObjectStorage } from './local-object-storage';
import { MemoryObjectStorage } from './object-storage';

const tokenOf = (url: string) => url.split('/dev-storage/')[1] ?? '';

describe('LocalObjectStorage', () => {
  let dir: string;
  let storage: LocalObjectStorage;
  let app: express.Express;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sz-storage-'));
    storage = new LocalObjectStorage(dir, 'http://localhost:4000');
    app = express();
    mountDevStorage({ use: app.use.bind(app) } as unknown as INestApplication, storage);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('uploads through a signed PUT and downloads through a signed GET', async () => {
    const body = Buffer.from('hello pdf');
    const put = await storage.presignPut(
      'estates/e1/files/f1',
      'application/pdf',
      body.length,
      300,
    );
    expect(put.startsWith('http://localhost:4000/dev-storage/')).toBe(true);
    await request(app)
      .put(`/dev-storage/${tokenOf(put)}`)
      .set('Content-Type', 'application/pdf')
      .send(body)
      .expect(200);
    expect(await storage.head('estates/e1/files/f1')).toEqual({
      sizeBytes: body.length,
      contentType: 'application/pdf',
    });

    const get = await storage.presignGet('estates/e1/files/f1', 300, 'Lease.pdf');
    const response = await request(app)
      .get(`/dev-storage/${tokenOf(get)}`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });
    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toContain('Lease.pdf');
    expect((response.body as Buffer).toString()).toBe('hello pdf');
  });

  it('refuses a PUT whose type or size differs from what was signed', async () => {
    const put = tokenOf(await storage.presignPut('k/a', 'image/png', 4, 300));
    await request(app)
      .put(`/dev-storage/${put}`)
      .set('Content-Type', 'image/jpeg')
      .send(Buffer.from('abcd'))
      .expect(400);
    await request(app)
      .put(`/dev-storage/${put}`)
      .set('Content-Type', 'image/png')
      .send(Buffer.from('abcdef'))
      .expect(400);
    expect(await storage.head('k/a')).toBeNull();
  });

  it('refuses tampered, expired and wrong-action tokens', async () => {
    const put = tokenOf(await storage.presignPut('k/b', 'text/plain', 1, 300));
    const [payload, signature] = put.split('.');
    const forged = Buffer.from(
      JSON.stringify({
        action: 'put',
        key: 'k/other',
        contentType: 'text/plain',
        sizeBytes: 1,
        expires: Date.now() + 1e6,
      }),
    ).toString('base64url');
    expect(storage.verify(`${forged}.${signature}`)).toBeNull();
    expect(storage.verify(`${payload}.${signature}`, Date.now() + 301_000)).toBeNull();
    await request(app).get(`/dev-storage/${put}`).expect(403);
  });

  it('never resolves a key outside its folder', () => {
    expect(() => storage.pathFor('../etc/passwd')).toThrow();
    expect(() => storage.pathFor('a/../../b')).toThrow();
    expect(() => storage.pathFor('/abs')).toThrow();
    expect(storage.pathFor('a/b.c')).toBe(join(dir, 'a', 'b.c'));
  });

  it('is not mounted for other storage drivers', () => {
    expect(
      mountDevStorage(
        { use: app.use.bind(app) } as unknown as INestApplication,
        new MemoryObjectStorage(),
      ),
    ).toBe(false);
  });
});
