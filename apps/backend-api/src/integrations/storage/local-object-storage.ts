import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { type ObjectHead, ObjectStorage } from './object-storage';

/** Same shape as the keys FilesService generates: path segments of safe characters only. */
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

export type LocalUrlAction = 'put' | 'get';

export interface LocalUrlClaims {
  action: LocalUrlAction;
  key: string;
  expires: number;
  contentType?: string;
  sizeBytes?: number;
  downloadName?: string;
}

/**
 * Development-only storage (STORAGE_DRIVER=local): objects live in a local folder and the API serves
 * the signed upload and download URLs itself (DevStorageController), so no MinIO/RustFS container is
 * needed. URLs are HMAC-signed with a per-process key, expire, and a PUT is bound to the declared
 * content type and size, like an S3 presigned URL. loadEnv() refuses this driver in staging/production.
 */
export class LocalObjectStorage extends ObjectStorage {
  private readonly root: string;
  private readonly signingKey = randomBytes(32);

  constructor(
    dir: string,
    private readonly publicBaseUrl: string,
  ) {
    super();
    this.root = resolve(dir);
  }

  /** Resolves a key inside the storage folder, refusing anything that could escape it. */
  pathFor(key: string): string {
    if (!KEY_PATTERN.test(key) || key.split('/').some((part) => part === '..' || part === '.')) {
      throw new Error('Invalid storage key');
    }
    const path = resolve(this.root, key);
    if (!path.startsWith(this.root + sep)) throw new Error('Invalid storage key');
    return path;
  }

  private sign(claims: LocalUrlClaims): string {
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signature = createHmac('sha256', this.signingKey).update(payload).digest('base64url');
    return `${payload}.${signature}`;
  }

  /** Checks a token from a signed URL; returns its claims, or null when tampered with or expired. */
  verify(token: string, now = Date.now()): LocalUrlClaims | null {
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return null;
    const expected = createHmac('sha256', this.signingKey).update(payload).digest();
    const given = Buffer.from(signature, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    try {
      const claims = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      ) as LocalUrlClaims;
      if (typeof claims.expires !== 'number' || claims.expires < now) return null;
      this.pathFor(claims.key);
      return claims;
    } catch {
      return null;
    }
  }

  private url(claims: LocalUrlClaims): string {
    return `${this.publicBaseUrl.replace(/\/$/, '')}/dev-storage/${this.sign(claims)}`;
  }

  async presignPut(
    key: string,
    contentType: string,
    sizeBytes: number,
    expiresSeconds: number,
  ): Promise<string> {
    this.pathFor(key);
    return this.url({
      action: 'put',
      key,
      contentType,
      sizeBytes,
      expires: Date.now() + expiresSeconds * 1000,
    });
  }

  async presignGet(key: string, expiresSeconds: number, downloadName?: string): Promise<string> {
    this.pathFor(key);
    return this.url({
      action: 'get',
      key,
      expires: Date.now() + expiresSeconds * 1000,
      ...(downloadName ? { downloadName } : {}),
    });
  }

  async head(key: string): Promise<ObjectHead | null> {
    try {
      const info = await stat(this.pathFor(key));
      const contentType = await readFile(`${this.pathFor(key)}.type`, 'utf8').catch(() => null);
      return { sizeBytes: info.size, contentType };
    } catch {
      return null;
    }
  }

  async read(key: string, maxBytes: number): Promise<Buffer> {
    const path = this.pathFor(key);
    const info = await stat(path);
    if (info.size > maxBytes) throw new Error('Object too large');
    return readFile(path);
  }

  async write(key: string, body: Buffer, contentType: string): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body, { mode: 0o600 });
    await writeFile(`${path}.type`, contentType, { mode: 0o600 });
  }

  async remove(key: string): Promise<void> {
    const path = this.pathFor(key);
    await rm(path, { force: true });
    await rm(`${path}.type`, { force: true });
  }
}
