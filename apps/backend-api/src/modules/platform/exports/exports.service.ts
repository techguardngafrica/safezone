import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import type { EstateAccess } from '../../../common/auth/auth.decorators';
import { DatabaseService } from '../../../common/database/database.service';
import { ConflictError, NotFoundError } from '../../../common/errors/domain-error';
import { toCsv, toJson } from '../../../common/export/csv';
import { EstateExportRegistry } from '../../../common/export/export-registry';
import { createZip, type ZipEntry } from '../../../common/export/zip';
import { appendOutboxEvents } from '../../../common/outbox/outbox-writer';
import { ObjectStorage } from '../../../integrations/storage/object-storage';
import { NotificationsService } from '../../notifications/notifications.service';

const EXPORT_TTL_MS = 7 * 86_400_000;
const DOWNLOAD_URL_SECONDS = 15 * 60;
type ExportRow = Prisma.EstateExportGetPayload<object>;

/**
 * Estate data export (platform.md §6): every module's datasets as CSV and JSON in one ZIP, built on the
 * `exports` queue, kept 7 days in private storage. Each download is a fresh 15-minute link and is audited.
 */
@Injectable()
export class ExportsService {
  private readonly logger = new Logger('Exports');

  constructor(
    private readonly db: DatabaseService,
    private readonly registry: EstateExportRegistry,
    private readonly storage: ObjectStorage,
    private readonly notifications: NotificationsService,
  ) {}

  async request(access: EstateAccess) {
    return this.db.withTenant(access, async (tx) => {
      const open = await tx.estateExport.count({
        where: { estateId: access.estateId, status: { in: ['queued', 'building'] } },
      });
      if (open > 0)
        throw new ConflictError('EXPORT_IN_PROGRESS', 'An export is already being prepared');
      const row = await tx.estateExport.create({
        data: { estateId: access.estateId, requestedBy: access.userId },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'platform.export.requested',
          estateId: access.estateId,
          aggregateType: 'estate_export',
          aggregateId: row.id,
          payload: { exportId: row.id },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'platform.export.request',
            resourceType: 'estate_export',
            resourceId: row.id,
          },
        },
      ]);
      return this.view(row);
    });
  }

  async list(access: EstateAccess) {
    return this.db.withTenant(access, async (tx) =>
      (
        await tx.estateExport.findMany({
          where: { estateId: access.estateId },
          orderBy: { createdAt: 'desc' },
          take: 20,
        })
      ).map((row) => this.view(row)),
    );
  }

  async download(access: EstateAccess, exportId: string) {
    const row = await this.db.withTenant(access, (tx) =>
      tx.estateExport.findFirst({ where: { id: exportId, estateId: access.estateId } }),
    );
    if (!row) throw new NotFoundError('Export not found', 'EXPORT_NOT_FOUND');
    const view = this.view(row);
    if (view.status !== 'ready' || !row.objectKey)
      throw new ConflictError('EXPORT_NOT_READY', 'This export is not available to download');
    const url = await this.storage.presignGet(
      row.objectKey,
      DOWNLOAD_URL_SECONDS,
      `estate-export-${row.id}.zip`,
    );
    await this.db.withTenant(access, (tx) =>
      appendOutboxEvents(tx, [
        {
          type: 'platform.export.downloaded',
          estateId: access.estateId,
          aggregateType: 'estate_export',
          aggregateId: row.id,
          payload: { exportId: row.id },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'platform.export.download',
            resourceType: 'estate_export',
            resourceId: row.id,
          },
        },
      ]),
    );
    return { url, expiresAt: new Date(Date.now() + DOWNLOAD_URL_SECONDS * 1000).toISOString() };
  }

  /** Worker: builds the ZIP. Safe to retry: a ready export is left alone. */
  async build(estateId: string, exportId: string): Promise<void> {
    const system = { estateId, userId: null };
    const row = await this.db.withTenant(system, (tx) =>
      tx.estateExport.findFirst({ where: { id: exportId, estateId } }),
    );
    if (!row || row.status === 'ready' || row.status === 'expired') return;
    await this.db.withTenant(system, (tx) =>
      tx.estateExport.update({ where: { id: exportId }, data: { status: 'building' } }),
    );
    try {
      const entries: ZipEntry[] = [];
      const counts: Record<string, number> = {};
      for (const dataset of this.registry.all()) {
        const rows = await dataset.rows(estateId);
        counts[dataset.name] = rows.length;
        entries.push({ name: `${dataset.name}.csv`, data: Buffer.from(toCsv(rows), 'utf8') });
        entries.push({ name: `${dataset.name}.json`, data: Buffer.from(toJson(rows), 'utf8') });
      }
      entries.unshift({
        name: 'README.txt',
        data: Buffer.from(
          [
            'Safezone estate data export',
            `Estate: ${estateId}`,
            `Created: ${new Date().toISOString()}`,
            '',
            'Each dataset is provided as CSV (opens in Excel or Google Sheets) and JSON.',
            'Money columns are in kobo (divide by 100 for naira). Times are UTC.',
            '',
            ...Object.entries(counts).map(([name, count]) => `${name}: ${count} rows`),
          ].join('\r\n'),
        ),
      });
      const zip = createZip(entries);
      const key = `exports/${estateId}/${exportId}.zip`;
      await this.storage.write(key, zip, 'application/zip');
      await this.db.withTenant(system, async (tx) => {
        await tx.estateExport.update({
          where: { id: exportId },
          data: {
            status: 'ready',
            objectKey: key,
            sizeBytes: zip.length,
            datasets: counts,
            readyAt: new Date(),
            expiresAt: new Date(Date.now() + EXPORT_TTL_MS),
          },
        });
        await appendOutboxEvents(tx, [
          {
            type: 'platform.export.ready',
            estateId,
            aggregateType: 'estate_export',
            aggregateId: exportId,
            payload: { exportId, sizeBytes: zip.length },
          },
        ]);
        await this.notifications.request(tx, {
          intent: 'platform.export_ready',
          userIds: [row.requestedBy],
          estateId,
          data: { exportId },
          dedupeKey: `export:${exportId}:ready`,
        });
      });
    } catch (error) {
      this.logger.error({ msg: 'export failed', exportId, error: (error as Error).name });
      await this.db.withTenant(system, (tx) =>
        tx.estateExport.update({
          where: { id: exportId },
          data: { status: 'failed', error: 'Export could not be built' },
        }),
      );
      throw error;
    }
  }

  private view(row: ExportRow) {
    const expired = row.status === 'ready' && row.expiresAt !== null && row.expiresAt < new Date();
    return {
      id: row.id,
      status: (expired ? 'expired' : row.status) as
        'queued' | 'building' | 'ready' | 'failed' | 'expired',
      sizeBytes: row.sizeBytes,
      datasets: (row.datasets as Record<string, number> | null) ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      readyAt: row.readyAt?.toISOString() ?? null,
    };
  }
}
