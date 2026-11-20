import { Injectable, Logger } from '@nestjs/common';
import type { BulkImportKind } from '@safezone/schemas';
import type { Prisma } from '../../generated/prisma/client';
import type { EstateAccess } from '../../common/auth/auth.decorators';
import { DatabaseService } from '../../common/database/database.service';
import { DomainError, NotFoundError } from '../../common/errors/domain-error';
import type { ImportOutcome } from '../../common/imports/import-outcome';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';
import { AuthzService } from '../authz/authz.service';
import { InvoicesService } from '../billing/invoices.service';
import { OccupancyService } from '../occupancy/occupancy.service';
import { OwnershipsService } from '../property/ownerships.service';
import { PropertyService } from '../property/property.service';
import { TenancyService } from '../tenancy/tenancy.service';
import { IMPORT_PERMISSIONS, type ImportRow, type RowError, rowKey } from './domain/rows';

type BalanceRow = Extract<ImportRow, { kind: 'opening_balances' }>;

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
  );
}

/**
 * Applies a queued import job in the worker (tenancy.md §7.8). The confirming administrator's access is
 * re-resolved at run time, so a revoked permission stops the import. Each row goes through the owning
 * module's service; a domain rejection becomes a row error and the rest of the file continues. Any other
 * error fails the attempt and BullMQ retries it: every row is idempotent (natural keys, or
 * `bulk_import_keys` for opening balances), so a retry never duplicates records.
 */
@Injectable()
export class ImportRunner {
  private readonly logger = new Logger('ImportRunner');

  constructor(
    private readonly db: DatabaseService,
    private readonly authz: AuthzService,
    private readonly tenancy: TenancyService,
    private readonly property: PropertyService,
    private readonly ownerships: OwnershipsService,
    private readonly occupancy: OccupancyService,
    private readonly invoices: InvoicesService,
  ) {}

  async run(estateId: string, jobId: string): Promise<void> {
    const system = { estateId, userId: null };
    const job = await this.db.withTenant(system, async (tx) => {
      const claimed = await tx.bulkImportJob.updateMany({
        where: { id: jobId, estateId, status: { in: ['queued', 'running'] } },
        data: { status: 'running' },
      });
      if (claimed.count === 0) return null;
      return tx.bulkImportJob.findFirstOrThrow({ where: { id: jobId, estateId } });
    });
    if (!job) return; // already finished (duplicate delivery)

    const kind = job.kind as BulkImportKind;
    const access = await this.resolveAccess(estateId, job.confirmedBy, kind);
    if (!access) {
      await this.finish(estateId, jobId, 'failed', {
        createdCount: 0,
        updatedCount: 0,
        unchangedCount: 0,
        failedCount: job.validRows,
        errors: [
          {
            row: 1,
            field: null,
            message: 'The person who confirmed this import no longer has permission to run it',
          },
        ],
      });
      return;
    }

    const rows = (Array.isArray(job.payloadJson) ? job.payloadJson : []) as unknown as ImportRow[];
    const counts = { created: 0, updated: 0, unchanged: 0 };
    const errors: RowError[] = [];
    for (const row of rows) {
      if (row.kind !== kind) continue;
      try {
        const outcome = await this.apply(access, jobId, row);
        counts[outcome] += 1;
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        errors.push({ row: row.row, field: null, message: error.message });
      }
    }
    await this.finish(estateId, jobId, 'completed', {
      createdCount: counts.created,
      updatedCount: counts.updated,
      unchangedCount: counts.unchanged,
      failedCount: errors.length,
      errors,
    });
  }

  /** Called when every retry is exhausted: the job is failed and its validated rows discarded. */
  async markFailed(estateId: string, jobId: string): Promise<void> {
    const job = await this.db.withTenant({ estateId, userId: null }, (tx) =>
      tx.bulkImportJob.findFirst({ where: { id: jobId, estateId } }),
    );
    if (!job || job.status === 'completed' || job.status === 'failed') return;
    await this.finish(estateId, jobId, 'failed', {
      createdCount: job.createdCount,
      updatedCount: job.updatedCount,
      unchangedCount: job.unchangedCount,
      failedCount: job.validRows,
      errors: [
        {
          row: 1,
          field: null,
          message:
            'The import could not be completed. Rows already applied are kept; run it again.',
        },
      ],
    });
  }

  private async resolveAccess(
    estateId: string,
    userId: string | null,
    kind: BulkImportKind,
  ): Promise<EstateAccess | null> {
    if (!userId) return null;
    const membership = await this.tenancy.activeMembership(userId, estateId);
    if (!membership) return null;
    const grant = this.authz.grantIn(await this.authz.activeAssignments(userId), estateId);
    if (!grant.permissions.has('import.run') || !grant.permissions.has(IMPORT_PERMISSIONS[kind])) {
      return null;
    }
    return { estateId, userId, roles: grant.roles, permissions: grant.permissions };
  }

  private async apply(access: EstateAccess, jobId: string, row: ImportRow): Promise<ImportOutcome> {
    switch (row.kind) {
      case 'units':
        return this.property.importUnit(access, row);
      case 'owners':
        return this.ownerships.importOwner(access, row.unitCode, row);
      case 'residents':
        return this.occupancy.importResident(access, row);
      case 'households':
        return this.occupancy.importHousehold(access, row);
      case 'vehicles':
        return this.occupancy.importVehicle(access, row);
      case 'opening_balances':
        return this.importBalance(access, jobId, row);
    }
  }

  /** One opening balance: a one-off invoice, recorded once per (unit, reference) across all jobs. */
  private async importBalance(
    access: EstateAccess,
    jobId: string,
    row: BalanceRow,
  ): Promise<ImportOutcome> {
    const key = rowKey(row);
    try {
      return await this.db.withTenant(access, async (tx) => {
        const seen = await tx.bulkImportKey.findFirst({
          where: { estateId: access.estateId, kind: row.kind, rowKey: key },
          select: { id: true },
        });
        if (seen) return 'unchanged';
        const unit = await this.property.unitByCode(tx, access.estateId, row.unitCode);
        if (!unit) throw new NotFoundError(`Unit ${row.unitCode} not found`, 'SPACE_NOT_FOUND');
        const invoice = await this.invoices.createOneOffIn(tx, access, {
          spaceId: unit.id,
          description: row.description,
          dueDate: row.dueDate,
          lines: [{ description: row.description, quantity: 1, unitAmount: row.amountKobo }],
        });
        await tx.bulkImportKey.create({
          data: {
            estateId: access.estateId,
            kind: row.kind,
            rowKey: key,
            jobId,
            resourceId: invoice.id,
          },
        });
        return 'created';
      });
    } catch (error) {
      // A concurrent attempt recorded the same reference first: its invoice stands.
      if (isUniqueViolation(error)) return 'unchanged';
      throw error;
    }
  }

  private async finish(
    estateId: string,
    jobId: string,
    status: 'completed' | 'failed',
    result: {
      createdCount: number;
      updatedCount: number;
      unchangedCount: number;
      failedCount: number;
      errors: RowError[];
    },
  ): Promise<void> {
    await this.db.withTenant({ estateId, userId: null }, async (tx) => {
      const job = await tx.bulkImportJob.findFirstOrThrow({ where: { id: jobId, estateId } });
      const dryRunErrors = (Array.isArray(job.errorsJson)
        ? job.errorsJson
        : []) as unknown as RowError[];
      const errors = [...dryRunErrors, ...result.errors].sort((a, b) => a.row - b.row);
      await tx.bulkImportJob.update({
        where: { id: jobId },
        data: {
          status,
          createdCount: result.createdCount,
          updatedCount: result.updatedCount,
          unchangedCount: result.unchangedCount,
          failedCount: result.failedCount,
          errorsJson: errors as unknown as Prisma.InputJsonValue,
          // Data minimisation: the validated rows (names, phones) are not kept after the run.
          payloadJson: [],
          completedAt: new Date(),
        },
      });
      await appendOutboxEvents(tx, [
        {
          type: status === 'completed' ? 'imports.job.completed' : 'imports.job.failed',
          estateId,
          aggregateType: 'bulk_import_job',
          aggregateId: jobId,
          payload: {
            jobId,
            kind: job.kind,
            createdCount: result.createdCount,
            updatedCount: result.updatedCount,
            unchangedCount: result.unchangedCount,
            failedCount: result.failedCount,
          },
          audit: {
            actorType: 'system',
            actorId: null,
            action: status === 'completed' ? 'imports.job.complete' : 'imports.job.fail',
            resourceType: 'bulk_import_job',
            resourceId: jobId,
            after: {
              createdCount: result.createdCount,
              updatedCount: result.updatedCount,
              unchangedCount: result.unchangedCount,
              failedCount: result.failedCount,
            },
          },
        },
      ]);
    });
    this.logger.log({ msg: 'import finished', estateId, jobId, status });
  }
}
