import { Injectable } from '@nestjs/common';
import type { BulkImportKind, bulkImportDryRunSchema } from '@safezone/schemas';
import type { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import type { EstateAccess } from '../../common/auth/auth.decorators';
import { DatabaseService } from '../../common/database/database.service';
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
} from '../../common/errors/domain-error';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';
import { todayInLagos } from '../billing/domain/billing';
import { parseCsv } from './domain/csv';
import {
  IMPORT_PERMISSIONS,
  MAX_IMPORT_ROWS,
  missingHeaders,
  type RowError,
  templateCsv,
  validateRows,
} from './domain/rows';

type JobRow = Prisma.BulkImportJobGetPayload<object>;
type JobStatus = 'dry_run' | 'queued' | 'running' | 'completed' | 'failed';

/** A dry run must be confirmed within a day; after that its validated rows are discarded. */
export const DRY_RUN_TTL_MS = 24 * 3600_000;

export function toJobView(row: JobRow) {
  return {
    id: row.id,
    kind: row.kind as BulkImportKind,
    status: row.status as JobStatus,
    filename: row.filename,
    totalRows: row.totalRows,
    validRows: row.validRows,
    errorRows: row.errorRows,
    createdCount: row.createdCount,
    updatedCount: row.updatedCount,
    unchangedCount: row.unchangedCount,
    failedCount: row.failedCount,
    errors: (Array.isArray(row.errorsJson) ? row.errorsJson : []) as unknown as RowError[],
    createdBy: row.createdBy,
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function assertCanImport(access: EstateAccess, kind: BulkImportKind): void {
  if (!access.permissions.has(IMPORT_PERMISSIONS[kind])) {
    throw new ForbiddenError(
      'You do not have permission to import this kind of record',
      'IMPORT_KIND_FORBIDDEN',
    );
  }
}

/**
 * Bulk CSV import (management-web.md §6.4, tenancy.md §7.8; ADR-0019).
 * Dry run validates every row and stores the normalised valid rows. Confirm atomically moves the job to
 * `queued` and emits `imports.job.confirmed`; the worker (ImportRunner) then applies each row through
 * the owning module's service, so imports follow the same rules, permissions and audit as manual entry.
 */
@Injectable()
export class ImportsService {
  constructor(private readonly db: DatabaseService) {}

  template(kind: BulkImportKind) {
    const { headers, csv } = templateCsv(kind);
    return { kind, filename: `safezone-${kind}-template.csv`, headers, csv };
  }

  async list(access: EstateAccess) {
    const rows = await this.db.withTenant(access, async (tx) => {
      // Data minimisation: validated rows of abandoned dry runs are not kept.
      await tx.bulkImportJob.updateMany({
        where: {
          estateId: access.estateId,
          status: 'dry_run',
          createdAt: { lt: new Date(Date.now() - DRY_RUN_TTL_MS) },
          NOT: { payloadJson: { equals: [] } },
        },
        data: { payloadJson: [] },
      });
      return tx.bulkImportJob.findMany({
        where: { estateId: access.estateId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
    });
    return rows.map(toJobView);
  }

  async get(access: EstateAccess, id: string) {
    const row = await this.db.withTenant(access, (tx) =>
      tx.bulkImportJob.findFirst({ where: { id, estateId: access.estateId } }),
    );
    if (!row) throw new NotFoundError('Import job not found', 'IMPORT_NOT_FOUND');
    return toJobView(row);
  }

  async dryRun(access: EstateAccess, input: z.infer<typeof bulkImportDryRunSchema>) {
    assertCanImport(access, input.kind);
    const parsed = parseCsv(input.csv);
    const missing = missingHeaders(input.kind, parsed.headers);
    if (missing.length > 0) {
      throw new DomainError(
        'IMPORT_HEADERS_MISSING',
        `Missing columns: ${missing.join(', ')}. Download the template for the expected columns.`,
        422,
      );
    }
    if (parsed.rows.length === 0) {
      throw new DomainError('IMPORT_EMPTY', 'The CSV file contains no data rows', 422);
    }
    if (parsed.rows.length > MAX_IMPORT_ROWS) {
      throw new DomainError('IMPORT_TOO_LARGE', 'Maximum 5,000 rows per import', 422);
    }

    const { valid, errors } = validateRows(input.kind, parsed.rows, todayInLagos());
    const job = await this.db.withTenant(access, (tx) =>
      tx.bulkImportJob.create({
        data: {
          estateId: access.estateId,
          kind: input.kind,
          status: 'dry_run',
          filename: input.filename,
          totalRows: parsed.rows.length,
          validRows: valid.length,
          errorRows: parsed.rows.length - valid.length,
          errorsJson: errors as unknown as Prisma.InputJsonValue,
          payloadJson: valid as unknown as Prisma.InputJsonValue,
          createdBy: access.userId,
        },
      }),
    );
    return toJobView(job);
  }

  /** Queues a validated dry run. Exactly one caller wins: the status change is conditional. */
  async confirm(access: EstateAccess, id: string) {
    return this.db.withTenant(access, async (tx) => {
      const job = await tx.bulkImportJob.findFirst({ where: { id, estateId: access.estateId } });
      if (!job) throw new NotFoundError('Import job not found', 'IMPORT_NOT_FOUND');
      assertCanImport(access, job.kind as BulkImportKind);
      if (job.status !== 'dry_run') {
        throw new ConflictError('IMPORT_ALREADY_CONFIRMED', 'This import job has already been run');
      }
      if (job.createdAt.getTime() < Date.now() - DRY_RUN_TTL_MS) {
        throw new ConflictError(
          'IMPORT_EXPIRED',
          'This dry run is more than a day old. Upload the file again.',
        );
      }
      if (job.validRows === 0) {
        throw new ConflictError('IMPORT_NOTHING_VALID', 'No valid rows to import');
      }
      const now = new Date();
      const claimed = await tx.bulkImportJob.updateMany({
        where: { id: job.id, estateId: access.estateId, status: 'dry_run' },
        data: { status: 'queued', confirmedBy: access.userId, confirmedAt: now },
      });
      if (claimed.count !== 1) {
        throw new ConflictError('IMPORT_ALREADY_CONFIRMED', 'This import job has already been run');
      }
      await appendOutboxEvents(tx, [
        {
          type: 'imports.job.confirmed',
          estateId: access.estateId,
          aggregateType: 'bulk_import_job',
          aggregateId: job.id,
          payload: { jobId: job.id, estateId: access.estateId, kind: job.kind },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'imports.job.confirm',
            resourceType: 'bulk_import_job',
            resourceId: job.id,
            after: { kind: job.kind, validRows: job.validRows },
          },
        },
      ]);
      const queued = await tx.bulkImportJob.findFirstOrThrow({ where: { id: job.id } });
      return toJobView(queued);
    });
  }
}
