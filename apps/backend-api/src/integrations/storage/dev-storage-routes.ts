import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { LocalObjectStorage } from './local-object-storage';

function fail(response: Response, status: number, code: string, message: string): void {
  response.status(status).json({ success: false, error: { code, message, statusCode: status } });
}

/** Reads the request body up to `limit` bytes; resolves null when it is larger. */
function readBody(request: Request, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        request.removeAllListeners('data');
        request.resume();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

/** Content-Disposition with a safe ASCII fallback and the UTF-8 name. */
function attachment(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * Serves LocalObjectStorage signed URLs at /dev-storage/:token (development only). Mounted as plain
 * Express routes so they never appear in the API contract or OpenAPI document. The token is the only
 * authority, exactly like an S3 presigned URL: PUT must match the declared type and size; GET streams
 * the object back.
 */
export function mountDevStorage(app: INestApplication, storage: unknown): boolean {
  if (!(storage instanceof LocalObjectStorage)) return false;
  const express = app as NestExpressApplication;

  express.use('/dev-storage/:token', (request: Request, response: Response, next: NextFunction) => {
    const token = String(request.params.token ?? '');
    const claims = storage.verify(token);
    if (request.method === 'PUT') {
      if (!claims || claims.action !== 'put')
        return fail(response, 403, 'FORBIDDEN', 'Upload link is invalid or expired');
      const contentType = request.headers['content-type']?.split(';')[0]?.trim() ?? '';
      if (contentType !== claims.contentType)
        return fail(response, 400, 'VALIDATION_FAILED', 'Content type does not match the upload');
      void readBody(request, claims.sizeBytes ?? 0)
        .then(async (body) => {
          if (!body || body.length !== claims.sizeBytes) {
            return fail(response, 400, 'VALIDATION_FAILED', 'File size does not match the upload');
          }
          // Write to a temporary name first so a half-written file is never visible.
          const path = storage.pathFor(claims.key);
          await mkdir(dirname(path), { recursive: true });
          await writeFile(`${path}.part`, body, { mode: 0o600 });
          await writeFile(`${path}.type`, contentType, { mode: 0o600 });
          await rename(`${path}.part`, path);
          response.status(200).end();
        })
        .catch(async () => {
          await rm(`${storage.pathFor(claims.key)}.part`, { force: true }).catch(() => undefined);
          fail(response, 500, 'INTERNAL', 'Upload failed');
        });
      return;
    }
    if (request.method === 'GET' || request.method === 'HEAD') {
      if (!claims || claims.action !== 'get')
        return fail(response, 403, 'FORBIDDEN', 'Download link is invalid or expired');
      void storage.head(claims.key).then((head) => {
        if (!head) return fail(response, 404, 'NOT_FOUND', 'Not found');
        response.setHeader('Content-Type', head.contentType ?? 'application/octet-stream');
        response.setHeader('Content-Length', String(head.sizeBytes));
        if (claims.downloadName)
          response.setHeader('Content-Disposition', attachment(claims.downloadName));
        if (request.method === 'HEAD') return response.status(200).end();
        createReadStream(storage.pathFor(claims.key)).pipe(response);
      });
      return;
    }
    next();
  });
  return true;
}
