import { Injectable } from '@nestjs/common';
import {
  type addVersionSchema,
  type createDocumentSchema,
  type createFolderSchema,
  type DocumentVisibility,
  type documentListQuerySchema,
  documentVisibilitySchema,
  type updateDocumentSchema,
} from '@safezone/schemas';
import type { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import type { EstateAccess } from '../../common/auth/auth.decorators';
import { DatabaseService } from '../../common/database/database.service';
import type { Tx } from '../../common/database/tenant-context';
import { ConflictError, DomainError, NotFoundError } from '../../common/errors/domain-error';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';
import { AuthzService } from '../authz/authz.service';
import { addDays } from '../billing/domain/billing';
import { FilesService } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { isStaffWith, OccupancyService } from '../occupancy/occupancy.service';
import { PropertyService } from '../property/property.service';

type DocumentRow = Prisma.DocumentGetPayload<{ include: { versions: true } }>;
const EXPIRY_REMINDER_DAYS = [30, 7, 0] as const;
const MANAGER_ROLES = ['estate_manager', 'estate_administrator', 'estate_owner'];

/**
 * Estate documents (documents.md): folders, categories, visibility rules, versions, expiry reminders and
 * access history. Files are the files module's; this module decides who may see them (rule 6).
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly files: FilesService,
    private readonly occupancy: OccupancyService,
    private readonly property: PropertyService,
    private readonly authz: AuthzService,
    private readonly notifications: NotificationsService,
  ) {}

  async createFolder(access: EstateAccess, input: z.infer<typeof createFolderSchema>) {
    return this.db.withTenant(access, async (tx) => {
      if (input.parentId) {
        const parent = await tx.documentFolder.count({
          where: { id: input.parentId, estateId: access.estateId },
        });
        if (parent === 0) throw new NotFoundError('Folder not found', 'FOLDER_NOT_FOUND');
      }
      const exists = await tx.documentFolder.count({
        where: { estateId: access.estateId, parentId: input.parentId ?? null, name: input.name },
      });
      if (exists > 0)
        throw new ConflictError('FOLDER_EXISTS', 'A folder with this name already exists here');
      const row = await tx.documentFolder.create({
        data: {
          estateId: access.estateId,
          parentId: input.parentId ?? null,
          name: input.name,
          createdBy: access.userId,
        },
      });
      return { id: row.id, name: row.name, parentId: row.parentId };
    });
  }

  async folders(access: EstateAccess) {
    return this.db.withTenant(access, async (tx) =>
      (
        await tx.documentFolder.findMany({
          where: { estateId: access.estateId },
          orderBy: { name: 'asc' },
        })
      ).map((row) => ({
        id: row.id,
        name: row.name,
        parentId: row.parentId,
      })),
    );
  }

  private async assertFile(access: EstateAccess, fileId: string) {
    const ok = await this.files.estateFilesOf(access.estateId, access.userId, [fileId], 'document');
    if (ok.length === 0)
      throw new DomainError('DOCUMENT_FILE_INVALID', 'Upload the document file first', 422);
  }

  async create(access: EstateAccess, input: z.infer<typeof createDocumentSchema>) {
    await this.assertFile(access, input.fileId);
    const id = await this.db.withTenant(access, async (tx) => {
      if (input.folderId) {
        const folder = await tx.documentFolder.count({
          where: { id: input.folderId, estateId: access.estateId },
        });
        if (folder === 0) throw new NotFoundError('Folder not found', 'FOLDER_NOT_FOUND');
      }
      const row = await tx.document.create({
        data: {
          estateId: access.estateId,
          folderId: input.folderId ?? null,
          category: input.category,
          title: input.title,
          description: input.description ?? null,
          visibility: input.visibility,
          expiresOn: input.expiresOn ? new Date(`${input.expiresOn}T00:00:00.000Z`) : null,
          createdBy: access.userId,
          versions: {
            create: {
              estateId: access.estateId,
              version: 1,
              fileId: input.fileId,
              notes: input.notes ?? null,
              uploadedBy: access.userId,
            },
          },
        },
      });
      await this.event(tx, access, row.id, 'created', {
        title: input.title,
        audience: input.visibility.audience,
      });
      return row.id;
    });
    return this.get(access, id);
  }

  /** A new version supersedes the old; history is kept (documents.md §2.11). */
  async addVersion(access: EstateAccess, id: string, input: z.infer<typeof addVersionSchema>) {
    await this.assertFile(access, input.fileId);
    await this.db.withTenant(access, async (tx) => {
      const row = await this.load(tx, access.estateId, id);
      if (row.status !== 'active')
        throw new ConflictError('DOCUMENT_ARCHIVED', 'This document is archived');
      const version = row.currentVersion + 1;
      await tx.documentVersion.create({
        data: {
          estateId: access.estateId,
          documentId: id,
          version,
          fileId: input.fileId,
          notes: input.notes ?? null,
          uploadedBy: access.userId,
        },
      });
      await tx.document.update({ where: { id }, data: { currentVersion: version } });
      await this.event(tx, access, id, 'versioned', { version });
    });
    return this.get(access, id);
  }

  async update(access: EstateAccess, id: string, input: z.infer<typeof updateDocumentSchema>) {
    await this.db.withTenant(access, async (tx) => {
      const row = await this.load(tx, access.estateId, id);
      await tx.document.update({
        where: { id: row.id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.category ? { category: input.category } : {}),
          ...(input.folderId !== undefined ? { folderId: input.folderId } : {}),
          ...(input.visibility ? { visibility: input.visibility } : {}),
          ...(input.expiresOn !== undefined
            ? { expiresOn: input.expiresOn ? new Date(`${input.expiresOn}T00:00:00.000Z`) : null }
            : {}),
        },
      });
      await this.event(tx, access, id, 'updated', input as Prisma.InputJsonValue);
    });
    return this.get(access, id);
  }

  /** Rule 5: archiving hides a document; its versions stay until the retention date. */
  async archive(access: EstateAccess, id: string) {
    await this.db.withTenant(access, async (tx) => {
      const row = await this.load(tx, access.estateId, id);
      if (row.status === 'archived') return;
      await tx.document.update({
        where: { id },
        data: { status: 'archived', archivedAt: new Date() },
      });
      await this.event(tx, access, id, 'archived', {});
    });
    return this.get(access, id);
  }

  /** Who the caller is for visibility checks. */
  private async viewer(access: EstateAccess) {
    const households = await this.occupancy.householdsOf(access.estateId, access.userId);
    return {
      households: households.map((h) => h.householdId),
      units: households.map((h) => h.spaceId),
    };
  }

  private async visible(
    tx: Tx,
    access: EstateAccess,
    visibility: DocumentVisibility,
    viewer: { households: string[]; units: string[] },
  ) {
    if (isStaffWith(access, 'document.manage')) return true;
    switch (visibility.audience) {
      case 'managers':
        return false;
      case 'residents':
        return true;
      case 'roles':
        return access.roles.some((role) => visibility.roleKeys.includes(role));
      case 'households':
        return viewer.households.some((id) => visibility.householdIds.includes(id));
      case 'user':
        return visibility.userId === access.userId;
      case 'spaces': {
        if (viewer.units.length === 0) return false;
        const units = await this.property
          .unitIdsWithin(tx, access.estateId, visibility.spaceIds)
          .catch(() => [] as string[]);
        return viewer.units.some((unit) => units.includes(unit));
      }
    }
  }

  async list(access: EstateAccess, query: z.infer<typeof documentListQuerySchema>) {
    const viewer = await this.viewer(access);
    const staff = isStaffWith(access, 'document.manage');
    return this.db.withTenant(access, async (tx) => {
      const rows = await tx.document.findMany({
        where: {
          estateId: access.estateId,
          status: 'active',
          ...(query.category ? { category: query.category } : {}),
          ...(query.folderId ? { folderId: query.folderId } : {}),
          ...(query.q ? { title: { contains: query.q, mode: 'insensitive' } } : {}),
          ...(query.expiringWithinDays
            ? { expiresOn: { lte: new Date(Date.now() + query.expiringWithinDays * 86_400_000) } }
            : {}),
        },
        include: { versions: { orderBy: { version: 'desc' } } },
        orderBy: { updatedAt: 'desc' },
        take: 500,
      });
      const result: ReturnType<DocumentsService['view']>[] = [];
      for (const row of rows) {
        if (
          staff ||
          (await this.visible(tx, access, documentVisibilitySchema.parse(row.visibility), viewer))
        )
          result.push(this.view(row));
      }
      return result;
    });
  }

  async get(access: EstateAccess, id: string) {
    const viewer = await this.viewer(access);
    return this.db.withTenant(access, async (tx) => {
      const row = await this.load(tx, access.estateId, id);
      if (
        !(await this.visible(tx, access, documentVisibilitySchema.parse(row.visibility), viewer)) ||
        (row.status !== 'active' && !isStaffWith(access, 'document.manage'))
      )
        throw new NotFoundError('Document not found', 'DOCUMENT_NOT_FOUND');
      await tx.documentAccess.create({
        data: {
          estateId: access.estateId,
          documentId: id,
          userId: access.userId,
          action: 'view',
          version: row.currentVersion,
        },
      });
      return this.view(row);
    });
  }

  /** Download link for the current (or a given) version; every download is logged (rule 3). */
  async download(access: EstateAccess, id: string, version?: number) {
    const viewer = await this.viewer(access);
    const fileId = await this.db.withTenant(access, async (tx) => {
      const row = await this.load(tx, access.estateId, id);
      if (
        row.status !== 'active' ||
        !(await this.visible(tx, access, documentVisibilitySchema.parse(row.visibility), viewer))
      )
        throw new NotFoundError('Document not found', 'DOCUMENT_NOT_FOUND');
      const wanted = version ?? row.currentVersion;
      const match = row.versions.find((item) => item.version === wanted);
      if (!match) throw new NotFoundError('Version not found', 'DOCUMENT_VERSION_NOT_FOUND');
      await tx.documentAccess.create({
        data: {
          estateId: access.estateId,
          documentId: id,
          userId: access.userId,
          action: 'download',
          version: wanted,
        },
      });
      return match.fileId;
    });
    return this.files.grantedDownloadUrl(access.estateId, access.userId, fileId, 'document', id);
  }

  async accessLog(access: EstateAccess, id: string) {
    return this.db.withTenant(access, async (tx) => {
      await this.load(tx, access.estateId, id);
      const rows = await tx.documentAccess.findMany({
        where: { estateId: access.estateId, documentId: id },
        orderBy: { at: 'desc' },
        take: 500,
      });
      return rows.map((row) => ({
        userId: row.userId,
        action: row.action as 'view' | 'download',
        version: row.version,
        at: row.at.toISOString(),
      }));
    });
  }

  /** Daily: expiry reminders 30 and 7 days before and on the day, to managers (and the document's user). */
  async expiryReminders(estateId: string, today: string): Promise<number> {
    const managers = await this.authz.holdersOf(estateId, MANAGER_ROLES);
    return this.db.withTenant({ estateId, userId: null }, async (tx) => {
      let sent = 0;
      for (const days of EXPIRY_REMINDER_DAYS) {
        const rows = await tx.document.findMany({
          where: {
            estateId,
            status: 'active',
            expiresOn: new Date(`${addDays(today, days)}T00:00:00.000Z`),
          },
        });
        for (const row of rows) {
          const visibility = documentVisibilitySchema.parse(row.visibility);
          const userIds = [
            ...new Set([
              ...managers,
              ...(visibility.audience === 'user' ? [visibility.userId] : []),
            ]),
          ];
          if (userIds.length === 0) continue;
          await this.notifications.request(tx, {
            intent: 'documents.expiring',
            userIds,
            estateId,
            data: {
              title: row.title,
              expiresOn: addDays(today, days),
              days: String(days),
              documentId: row.id,
            },
            dedupeKey: `document:${row.id}:expiry:${days}`,
          });
          sent += 1;
        }
      }
      return sent;
    });
  }

  private async load(tx: Tx, estateId: string, id: string): Promise<DocumentRow> {
    const row = await tx.document.findFirst({
      where: { id, estateId },
      include: { versions: { orderBy: { version: 'desc' } } },
    });
    if (!row) throw new NotFoundError('Document not found', 'DOCUMENT_NOT_FOUND');
    return row;
  }

  private async event(
    tx: Tx,
    access: EstateAccess,
    id: string,
    verb: string,
    after: Prisma.InputJsonValue,
  ) {
    await appendOutboxEvents(tx, [
      {
        type: `documents.document.${verb}`,
        estateId: access.estateId,
        aggregateType: 'document',
        aggregateId: id,
        payload: { documentId: id },
        audit: {
          actorType: 'user',
          actorId: access.userId,
          action: `documents.document.${verb}`,
          resourceType: 'document',
          resourceId: id,
          after,
        },
      },
    ]);
  }

  private view(row: DocumentRow) {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      category: row.category as 'other',
      folderId: row.folderId,
      visibility: documentVisibilitySchema.parse(row.visibility),
      expiresOn: row.expiresOn?.toISOString().slice(0, 10) ?? null,
      status: row.status as 'active' | 'archived',
      currentVersion: row.currentVersion,
      versions: row.versions.map((version) => ({
        version: version.version,
        fileId: version.fileId,
        notes: version.notes,
        createdAt: version.createdAt.toISOString(),
      })),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
