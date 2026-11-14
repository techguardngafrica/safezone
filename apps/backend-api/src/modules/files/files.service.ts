import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DatabaseService } from '../../common/database/database.service';
import type { Tx } from '../../common/database/tenant-context';
import { DomainError, ForbiddenError, NotFoundError } from '../../common/errors/domain-error';
import { uuidv7 } from '../../common/ids/uuidv7';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';
import { MalwareScanner } from '../../integrations/scan/malware-scanner';
import { ObjectStorage } from '../../integrations/storage/object-storage';
import {
  FILE_PURPOSES,
  type FilePurpose,
  MAX_FILE_BYTES,
  maxBytesFor,
  type PurposeRule,
} from './domain/purposes';
import { contentMatchesType } from './domain/sniff';
import { stripImageMetadata } from './domain/strip-metadata';

const UPLOAD_URL_TTL_SECONDS = 600;
/** Download URLs expire in 5 minutes (documents.md §5.2). */
const DOWNLOAD_URL_TTL_SECONDS = 300;

export type FileOwner =
  | { kind: 'estate'; estateId: string; userId: string; permissions: ReadonlySet<string> }
  | { kind: 'user'; userId: string };

interface FileRow {
  id: string;
  estateId: string | null;
  purpose: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string | null;
  scanStatus: string;
  uploadedBy: string;
  createdAt: Date;
}

export function toFileStatus(row: FileRow) {
  return {
    id: row.id,
    purpose: row.purpose,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    status: row.scanStatus as
      'awaiting_upload' | 'pending_scan' | 'clean' | 'infected' | 'rejected' | 'error',
    sha256: row.sha256,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * File service (documents.md, Phase 0): signed direct uploads, scan before use, metadata stripping,
 * SHA-256 per file and short-lived signed downloads. Bytes never pass through the API process.
 */
@Injectable()
export class FilesService {
  private readonly logger = new Logger('Files');

  constructor(
    private readonly db: DatabaseService,
    private readonly storage: ObjectStorage,
    private readonly scanner: MalwareScanner,
  ) {}

  async createUpload(
    owner: FileOwner,
    input: { purpose: FilePurpose; mimeType: string; sizeBytes: number },
  ) {
    const rule = FILE_PURPOSES[input.purpose];
    if ((rule.scope === 'estate') !== (owner.kind === 'estate')) {
      throw new DomainError('FILE_PURPOSE_SCOPE', 'This kind of file cannot be uploaded here', 422);
    }
    if (
      owner.kind === 'estate' &&
      'uploadPermission' in rule &&
      !owner.permissions.has(rule.uploadPermission)
    ) {
      throw new ForbiddenError();
    }
    const limit = maxBytesFor(input.purpose, input.mimeType);
    if (limit === null)
      throw new DomainError('FILE_TYPE_NOT_ALLOWED', 'This file type is not allowed here', 422);
    if (input.sizeBytes > limit) {
      throw new DomainError(
        'FILE_TOO_LARGE',
        `The file is too large (max ${Math.round(limit / 1024 / 1024)} MB)`,
        422,
      );
    }

    const id = uuidv7();
    const storageKey =
      owner.kind === 'estate'
        ? `estates/${owner.estateId}/${input.purpose}/${id}`
        : `users/${owner.userId}/${input.purpose}/${id}`;
    await this.inScope(owner, (tx) =>
      tx.storedFile.create({
        data: {
          id,
          estateId: owner.kind === 'estate' ? owner.estateId : null,
          purpose: input.purpose,
          storageKey,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          uploadedBy: owner.userId,
        },
      }),
    );
    const uploadUrl = await this.storage.presignPut(
      storageKey,
      input.mimeType,
      input.sizeBytes,
      UPLOAD_URL_TTL_SECONDS,
    );
    return {
      fileId: id,
      uploadUrl,
      method: 'PUT' as const,
      headers: { 'Content-Type': input.mimeType, 'Content-Length': String(input.sizeBytes) },
      expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
    };
  }

  /** Confirms the object landed with the declared size and type, then queues the scan. */
  async completeUpload(owner: FileOwner, fileId: string) {
    const file = await this.find(owner, fileId);
    if (file.uploadedBy !== owner.userId)
      throw new NotFoundError('File not found', 'FILE_NOT_FOUND');
    if (file.scanStatus !== 'awaiting_upload') return toFileStatus(file);

    const head = await this.storage.head(file.storageKey);
    if (!head) throw new DomainError('FILE_NOT_UPLOADED', 'Upload the file first', 409);
    if (
      head.sizeBytes !== file.sizeBytes ||
      (head.contentType && head.contentType !== file.mimeType)
    ) {
      throw new DomainError(
        'FILE_MISMATCH',
        'The uploaded file does not match what was declared',
        422,
      );
    }
    const updated = await this.inScope(owner, async (tx) => {
      const row = await tx.storedFile.update({
        where: { id: fileId },
        data: { scanStatus: 'pending_scan', uploadedAt: new Date() },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'documents.file.uploaded',
          estateId: row.estateId,
          aggregateType: 'file',
          aggregateId: row.id,
          payload: { fileId: row.id },
        },
      ]);
      return row;
    });
    return toFileStatus(updated);
  }

  async status(owner: FileOwner, fileId: string) {
    return toFileStatus(await this.find(owner, fileId));
  }

  /** Short-lived signed download; only for clean files. Sensitive purposes are audited. */
  async downloadUrl(owner: FileOwner, fileId: string) {
    const file = await this.find(owner, fileId);
    const rule: PurposeRule | undefined = FILE_PURPOSES[file.purpose as FilePurpose];
    if (owner.kind === 'estate' && file.uploadedBy !== owner.userId) {
      const allowed =
        rule?.downloadPermissions?.some((permission) => owner.permissions.has(permission)) ?? false;
      if (!allowed) throw new ForbiddenError();
    }
    if (file.scanStatus !== 'clean')
      throw new DomainError('FILE_NOT_READY', 'The file is not available yet', 409);
    if (rule?.sensitive) {
      await this.inScope(owner, (tx) =>
        appendOutboxEvents(tx, [
          {
            type: 'documents.file.downloaded',
            estateId: file.estateId,
            aggregateType: 'file',
            aggregateId: file.id,
            payload: { fileId: file.id, purpose: file.purpose },
            audit: {
              actorType: 'user',
              actorId: owner.userId,
              action: 'documents.file.download',
              resourceType: 'file',
              resourceId: file.id,
            },
          },
        ]),
      );
    }
    const extension = file.mimeType.split('/')[1]?.split('.').pop() ?? 'bin';
    const url = await this.storage.presignGet(
      file.storageKey,
      DOWNLOAD_URL_TTL_SECONDS,
      `${file.purpose}-${file.id}.${extension}`,
    );
    return { url, expiresAt: new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000).toISOString() };
  }

  /** The signed-in user's own personal files with these ids and this purpose (other ids are left out). */
  async ownFiles(userId: string, fileIds: readonly string[], purpose: FilePurpose) {
    if (fileIds.length === 0) return [];
    const rows = await this.db.withUser(userId, (tx) =>
      tx.storedFile.findMany({
        where: { id: { in: [...fileIds] }, estateId: null, uploadedBy: userId, purpose },
      }),
    );
    return rows.map(toFileStatus);
  }

  /**
   * Download link for a file another module has already authorised (e.g. a document the caller may see).
   * Still requires a clean scan; always audited.
   */
  async grantedDownloadUrl(
    estateId: string,
    userId: string,
    fileId: string,
    resourceType: string,
    resourceId: string,
  ) {
    const file = await this.db.withTenant({ estateId, userId }, (tx) =>
      tx.storedFile.findFirst({ where: { id: fileId, estateId } }),
    );
    if (!file) throw new NotFoundError('File not found', 'FILE_NOT_FOUND');
    if (file.scanStatus !== 'clean')
      throw new DomainError('FILE_NOT_READY', 'The file is not available yet', 409);
    await this.db.withTenant({ estateId, userId }, (tx) =>
      appendOutboxEvents(tx, [
        {
          type: 'documents.file.downloaded',
          estateId,
          aggregateType: 'file',
          aggregateId: file.id,
          payload: { fileId: file.id, purpose: file.purpose, resourceType, resourceId },
          audit: {
            actorType: 'user',
            actorId: userId,
            action: 'documents.file.download',
            resourceType,
            resourceId,
          },
        },
      ]),
    );
    const extension = file.mimeType.split('/')[1]?.split('.').pop() ?? 'bin';
    const url = await this.storage.presignGet(
      file.storageKey,
      DOWNLOAD_URL_TTL_SECONDS,
      `${file.purpose}-${file.id}.${extension}`,
    );
    return { url, expiresAt: new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000).toISOString() };
  }

  /**
   * Ids among `fileIds` that are this estate's files of this purpose uploaded by the user and not
   * infected (attachments on maintenance requests, incidents and the like).
   */
  async estateFilesOf(
    estateId: string,
    userId: string,
    fileIds: readonly string[],
    purpose: FilePurpose,
  ): Promise<string[]> {
    if (fileIds.length === 0) return [];
    const rows = await this.db.withTenant({ estateId, userId }, (tx) =>
      tx.storedFile.findMany({
        where: {
          id: { in: [...fileIds] },
          estateId,
          uploadedBy: userId,
          purpose,
          scanStatus: { not: 'infected' },
        },
        select: { id: true },
      }),
    );
    return rows.map((row) => row.id);
  }

  /** Scan status of files, for a platform reviewer (e.g. application documents). */
  async platformStatuses(fileIds: readonly string[]) {
    if (fileIds.length === 0) return [];
    const rows = await this.db.withContext('files', (tx) =>
      tx.storedFile.findMany({ where: { id: { in: [...fileIds] } } }),
    );
    return rows.map(toFileStatus);
  }

  /**
   * Signed download for Techguard staff reviewing a file another module has linked (the caller checks
   * that link and the permission). Always audited.
   */
  async platformDownloadUrl(staffUserId: string, fileId: string, reason: string) {
    const file = await this.db.withContext('files', (tx) =>
      tx.storedFile.findUnique({ where: { id: fileId } }),
    );
    if (!file) throw new NotFoundError('File not found', 'FILE_NOT_FOUND');
    if (file.scanStatus !== 'clean')
      throw new DomainError('FILE_NOT_READY', 'The file is not available yet', 409);
    await this.db.withContext(
      'files',
      (tx) =>
        appendOutboxEvents(tx, [
          {
            type: 'documents.file.downloaded',
            estateId: file.estateId,
            aggregateType: 'file',
            aggregateId: file.id,
            payload: { fileId: file.id, purpose: file.purpose },
            audit: {
              actorType: 'platform_staff',
              actorId: staffUserId,
              action: 'documents.file.download',
              resourceType: 'file',
              resourceId: file.id,
              reason,
            },
          },
        ]),
      { estateId: file.estateId },
    );
    const extension = file.mimeType.split('/')[1]?.split('.').pop() ?? 'bin';
    const url = await this.storage.presignGet(
      file.storageKey,
      DOWNLOAD_URL_TTL_SECONDS,
      `${file.purpose}-${file.id}.${extension}`,
    );
    return { url, expiresAt: new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000).toISOString() };
  }

  /**
   * Worker: scan, verify type, strip image metadata, hash. Idempotent: only pending files are processed.
   * Infected files are moved to quarantine/ and never served.
   */
  async scan(fileId: string): Promise<string> {
    const file = await this.db.withContext('files', (tx) =>
      tx.storedFile.findUnique({ where: { id: fileId } }),
    );
    if (!file || file.scanStatus !== 'pending_scan') return file?.scanStatus ?? 'missing';

    let status: 'clean' | 'infected' | 'rejected';
    let sha256: string | null = null;
    try {
      const body = await this.storage.read(
        file.storageKey,
        Math.min(file.sizeBytes, MAX_FILE_BYTES),
      );
      const verdict = await this.scanner.scan(body);
      if (verdict.verdict === 'infected') {
        await this.storage.write(`quarantine/${file.storageKey}`, body, 'application/octet-stream');
        await this.storage.remove(file.storageKey);
        status = 'infected';
      } else if (!contentMatchesType(body, file.mimeType)) {
        await this.storage.remove(file.storageKey);
        status = 'rejected';
      } else {
        const cleaned = stripImageMetadata(body, file.mimeType);
        if (cleaned !== body) await this.storage.write(file.storageKey, cleaned, file.mimeType);
        sha256 = createHash('sha256').update(cleaned).digest('hex');
        status = 'clean';
      }
    } catch (error) {
      this.logger.warn({
        msg: 'file scan failed',
        fileId,
        error: error instanceof Error ? error.name : 'unknown',
      });
      throw error; // retried by the queue
    }

    await this.db.withContext(
      'files',
      async (tx) => {
        await tx.storedFile.update({
          where: { id: fileId },
          data: { scanStatus: status, sha256, scannedAt: new Date() },
        });
        await appendOutboxEvents(tx, [
          {
            type: 'documents.file.scanned',
            estateId: file.estateId,
            aggregateType: 'file',
            aggregateId: file.id,
            payload: { fileId: file.id, status },
          },
        ]);
      },
      { estateId: file.estateId },
    );
    return status;
  }

  private async find(owner: FileOwner, fileId: string): Promise<FileRow> {
    const file = await this.inScope(owner, (tx) =>
      tx.storedFile.findUnique({ where: { id: fileId } }),
    );
    if (!file) throw new NotFoundError('File not found', 'FILE_NOT_FOUND');
    return file;
  }

  private inScope<T>(owner: FileOwner, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return owner.kind === 'estate'
      ? this.db.withTenant({ estateId: owner.estateId, userId: owner.userId }, fn)
      : this.db.withUser(owner.userId, fn);
  }
}
