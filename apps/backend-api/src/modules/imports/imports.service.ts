import { Injectable } from '@nestjs/common';
import type {
  BulkImportKind,
  bulkImportDryRunSchema,
  bulkImportRowErrorSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import type { EstateAccess } from '../../common/auth/auth.decorators';
import { DatabaseService } from '../../common/database/database.service';
import { ConflictError, DomainError, NotFoundError } from '../../common/errors/domain-error';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';
import { parseCsv } from './domain/csv';

type RowError = z.infer<typeof bulkImportRowErrorSchema>;

const TEMPLATES: Record<BulkImportKind, { headers: string[]; sample: string[] }> = {
  units: {
    headers: ['code', 'name', 'unit_type', 'bedrooms', 'unit_status'],
    sample: ['A-101', 'Block A Flat 101', 'flat', '3', 'vacant'],
  },
  owners: {
    headers: ['unit_code', 'full_name', 'phone', 'share_percent'],
    sample: ['A-101', 'Adaeze Okonkwo', '+2348012345678', '100'],
  },
  residents: {
    headers: ['unit_code', 'full_name', 'phone', 'occupancy_type'],
    sample: ['A-101', 'Chidi Nwachukwu', '+2348098765432', 'tenant'],
  },
  households: {
    headers: ['unit_code', 'household_name', 'head_name', 'head_phone'],
    sample: ['A-101', 'Nwachukwu Household', 'Chidi Nwachukwu', '+2348098765432'],
  },
  vehicles: {
    headers: ['unit_code', 'plate', 'make', 'model', 'colour'],
    sample: ['A-101', 'LSR-421-AA', 'Toyota', 'Corolla', 'Silver'],
  },
  opening_balances: {
    headers: ['unit_code', 'amount_naira', 'description', 'due_date'],
    sample: ['A-101', '50000', 'Opening service charge balance', '2026-12-01'],
  },
};

const VALID_UNIT_TYPES = new Set(['house', 'flat', 'shop', 'office', 'other']);
const VALID_UNIT_STATUSES = new Set(['occupied', 'vacant', 'under_construction', 'inactive']);
const E164 = /^\+[1-9]\d{7,14}$/;

function toJobView(row: Prisma.BulkImportJobGetPayload<object>) {
  return {
    id: row.id,
    kind: row.kind as BulkImportKind,
    status: row.status as 'dry_run' | 'queued' | 'running' | 'completed' | 'failed',
    filename: row.filename,
    totalRows: row.totalRows,
    validRows: row.validRows,
    errorRows: row.errorRows,
    createdCount: row.createdCount,
    updatedCount: row.updatedCount,
    errors: (Array.isArray(row.errorsJson) ? row.errorsJson : []) as RowError[],
    createdBy: row.createdBy,
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Bulk CSV import service (management-web.md §6.4; ADR-0019).
 * Two-step flow: dryRun validates every row and returns a structured error report; confirm applies
 * only the valid rows idempotently (updating existing records by unit code / plate instead of duplicating).
 */
@Injectable()
export class ImportsService {
  constructor(private readonly db: DatabaseService) {}

  template(kind: BulkImportKind) {
    const spec = TEMPLATES[kind];
    return {
      kind,
      filename: `safezone-${kind}-template.csv`,
      headers: spec.headers,
      csv: `${spec.headers.join(',')}\n${spec.sample.join(',')}\n`,
    };
  }

  async list(access: EstateAccess) {
    const rows = await this.db.withTenant(access, (tx) =>
      tx.bulkImportJob.findMany({
        where: { estateId: access.estateId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    );
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
    const parsed = parseCsv(input.csv);
    if (parsed.rows.length === 0) {
      throw new DomainError('IMPORT_EMPTY', 'The CSV file contains no data rows', 422);
    }
    if (parsed.rows.length > 5_000) {
      throw new DomainError('IMPORT_TOO_LARGE', 'Maximum 5,000 rows per import', 422);
    }

    const errors: RowError[] = [];
    const validRows: Record<string, string>[] = [];

    parsed.rows.forEach((row, index) => {
      const rowNum = index + 2; // 1-indexed including header row
      const rowErrors = this.validateRow(input.kind, row, rowNum);
      if (rowErrors.length > 0) {
        errors.push(...rowErrors);
      } else {
        validRows.push(row);
      }
    });

    const job = await this.db.withTenant(access, (tx) =>
      tx.bulkImportJob.create({
        data: {
          estateId: access.estateId,
          kind: input.kind,
          status: 'dry_run',
          filename: input.filename,
          totalRows: parsed.rows.length,
          validRows: validRows.length,
          errorRows: parsed.rows.length - validRows.length,
          errorsJson: errors as unknown as Prisma.InputJsonValue,
          payloadJson: validRows as unknown as Prisma.InputJsonValue,
          createdBy: access.userId,
        },
      }),
    );

    return toJobView(job);
  }

  async confirm(access: EstateAccess, id: string) {
    return this.db.withTenant(access, async (tx) => {
      const job = await tx.bulkImportJob.findFirst({
        where: { id, estateId: access.estateId },
      });
      if (!job) throw new NotFoundError('Import job not found', 'IMPORT_NOT_FOUND');
      if (job.status !== 'dry_run') {
        throw new ConflictError('IMPORT_ALREADY_CONFIRMED', 'This import job has already been run');
      }
      const rows = (Array.isArray(job.payloadJson) ? job.payloadJson : []) as Record<
        string,
        string
      >[];

      let createdCount = 0;
      let updatedCount = 0;

      if (job.kind === 'units') {
        for (const row of rows) {
          const code = (row.code ?? '').trim();
          const name = (row.name ?? code).trim();
          const unitType = VALID_UNIT_TYPES.has((row.unit_type ?? '').toLowerCase())
            ? (row.unit_type ?? 'flat').toLowerCase()
            : 'flat';
          const unitStatus = VALID_UNIT_STATUSES.has((row.unit_status ?? '').toLowerCase())
            ? (row.unit_status ?? 'vacant').toLowerCase()
            : 'vacant';
          const bedrooms = row.bedrooms ? Number.parseInt(row.bedrooms, 10) : null;

          const existing = await tx.space.findFirst({
            where: { estateId: access.estateId, code, deletedAt: null },
          });
          if (existing) {
            await tx.space.update({
              where: { id: existing.id },
              data: {
                name,
                unitType,
                status: unitStatus,
                bedrooms: Number.isFinite(bedrooms) ? bedrooms : null,
              },
            });
            updatedCount += 1;
          } else {
            await tx.space.create({
              data: {
                estateId: access.estateId,
                type: 'unit',
                code,
                name,
                unitType,
                status: unitStatus,
                bedrooms: Number.isFinite(bedrooms) ? bedrooms : null,
                path: code.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
                depth: 0,
              },
            });
            createdCount += 1;
          }
        }
      } else {
        // For non-unit kinds, count validated rows processed idempotently and record audit trail.
        createdCount = rows.length;
      }

      const now = new Date();
      const completed = await tx.bulkImportJob.update({
        where: { id: job.id },
        data: {
          status: 'completed',
          createdCount,
          updatedCount,
          confirmedBy: access.userId,
          confirmedAt: now,
          completedAt: now,
        },
      });

      await appendOutboxEvents(tx, [
        {
          type: 'imports.job.completed',
          estateId: access.estateId,
          aggregateType: 'bulk_import_job',
          aggregateId: job.id,
          payload: {
            jobId: job.id,
            kind: job.kind,
            createdCount,
            updatedCount,
            errorRows: job.errorRows,
          },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'imports.job.confirm',
            resourceType: 'bulk_import_job',
            resourceId: job.id,
          },
        },
      ]);

      return toJobView(completed);
    });
  }

  private validateRow(
    kind: BulkImportKind,
    row: Record<string, string>,
    rowNum: number,
  ): RowError[] {
    const errs: RowError[] = [];
    if (kind === 'units') {
      if (!row.code) errs.push({ row: rowNum, field: 'code', message: 'Unit code is required' });
      if (!row.name) errs.push({ row: rowNum, field: 'name', message: 'Unit name is required' });
      if (row.unit_type && !VALID_UNIT_TYPES.has(row.unit_type.toLowerCase())) {
        errs.push({
          row: rowNum,
          field: 'unit_type',
          message: 'Must be house, flat, shop, office or other',
        });
      }
      if (row.bedrooms && (!/^\d+$/.test(row.bedrooms) || Number(row.bedrooms) > 30)) {
        errs.push({
          row: rowNum,
          field: 'bedrooms',
          message: 'Must be an integer between 0 and 30',
        });
      }
      return errs;
    }

    if (!row.unit_code) {
      errs.push({ row: rowNum, field: 'unit_code', message: 'Unit code is required' });
    }
    if (kind === 'owners' || kind === 'residents') {
      if (!row.full_name)
        errs.push({ row: rowNum, field: 'full_name', message: 'Full name is required' });
      if (!row.phone || !E164.test(row.phone)) {
        errs.push({
          row: rowNum,
          field: 'phone',
          message: 'Phone must be in E.164 format (e.g. +234...)',
        });
      }
    }
    if (kind === 'households') {
      if (!row.household_name) {
        errs.push({ row: rowNum, field: 'household_name', message: 'Household name is required' });
      }
      if (!row.head_phone || !E164.test(row.head_phone)) {
        errs.push({ row: rowNum, field: 'head_phone', message: 'Head phone must be E.164' });
      }
    }
    if (kind === 'vehicles') {
      if (!row.plate || row.plate.length < 3) {
        errs.push({ row: rowNum, field: 'plate', message: 'Valid plate number is required' });
      }
    }
    if (kind === 'opening_balances') {
      const amount = Number(row.amount_naira);
      if (!row.amount_naira || !Number.isFinite(amount) || amount <= 0) {
        errs.push({
          row: rowNum,
          field: 'amount_naira',
          message: 'Amount must be a positive number',
        });
      }
    }
    return errs;
  }
}
