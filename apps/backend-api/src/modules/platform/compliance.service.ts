import { Injectable } from '@nestjs/common';
import type {
  createBreachSchema,
  createDsrSchema,
  dsrListQuerySchema,
  updateBreachSchema,
  updateDsrSchema,
  upsertRetentionRuleSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import { DatabaseService } from '../../common/database/database.service';
import { NotFoundError } from '../../common/errors/domain-error';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor';

const cursorSchema = z.object({ id: z.uuid() });
const isIdCursor = (value: unknown): value is { id: string } =>
  cursorSchema.safeParse(value).success;
const THIRTY_DAYS_MS = 30 * 86_400_000;

function toDsrView(row: Prisma.DataSubjectRequestGetPayload<object>) {
  return {
    id: row.id,
    userId: row.userId,
    subjectName: row.subjectName,
    subjectContact: row.subjectContact,
    type: row.type as 'access' | 'correction' | 'deletion' | 'export' | 'objection',
    status: row.status as
      'received' | 'identity_verified' | 'in_progress' | 'completed' | 'rejected',
    notes: row.notes,
    receivedAt: row.receivedAt.toISOString(),
    dueAt: row.dueAt.toISOString(),
    identityCheckedBy: row.identityCheckedBy,
    identityCheckedAt: row.identityCheckedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

function toBreachView(row: Prisma.BreachLogGetPayload<object>) {
  return {
    id: row.id,
    detectedAt: row.detectedAt.toISOString(),
    title: row.title,
    description: row.description,
    severity: row.severity as 'low' | 'medium' | 'high' | 'critical',
    affectedEstates: row.affectedEstates,
    affectedCount: row.affectedCount,
    ndpcNotifiedAt: row.ndpcNotifiedAt?.toISOString() ?? null,
    subjectsNotifiedAt: row.subjectsNotifiedAt?.toISOString() ?? null,
    status: row.status as 'investigating' | 'contained' | 'notified' | 'closed',
    createdAt: row.createdAt.toISOString(),
  };
}

function toRetentionView(row: Prisma.RetentionRuleGetPayload<object>) {
  return {
    dataType: row.dataType,
    retentionDays: row.retentionDays,
    basis: row.basis,
    action: row.action as 'delete' | 'anonymise' | 'archive',
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Platform compliance: DSRs, breach log, retention rules (platform.md §5, ADR-0022). */
@Injectable()
export class ComplianceService {
  constructor(private readonly db: DatabaseService) {}

  async listDsrs(query: z.infer<typeof dsrListQuerySchema>) {
    const after = query.cursor ? decodeCursor(query.cursor, isIdCursor) : null;
    const rows = await this.db.withContext('platform_config', (tx) =>
      tx.dataSubjectRequest.findMany({
        where: {
          ...(query.status ? { status: query.status } : {}),
          ...(after ? { id: { lt: after.id } } : {}),
        },
        orderBy: { id: 'desc' },
        take: query.limit + 1,
      }),
    );
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page.at(-1);
    return {
      items: page.map(toDsrView),
      nextCursor: hasMore && last ? encodeCursor({ id: last.id }) : null,
    };
  }

  async createDsr(actorId: string, input: z.infer<typeof createDsrSchema>) {
    const now = new Date();
    const dueAt = new Date(now.getTime() + THIRTY_DAYS_MS);
    const row = await this.db.withContext('platform_config', async (tx) => {
      const created = await tx.dataSubjectRequest.create({
        data: {
          userId: input.userId ?? null,
          subjectName: input.subjectName,
          subjectContact: input.subjectContact,
          type: input.type,
          notes: input.notes ?? null,
          receivedAt: now,
          dueAt,
          createdBy: actorId,
        },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'platform.dsr.received',
          estateId: null,
          aggregateType: 'data_subject_request',
          aggregateId: created.id,
          payload: { dsrId: created.id, type: created.type },
          audit: {
            actorType: 'platform_staff',
            actorId,
            action: 'platform.dsr.create',
            resourceType: 'data_subject_request',
            resourceId: created.id,
            after: { type: created.type, dueAt: dueAt.toISOString() },
          },
        },
      ]);
      return created;
    });
    return toDsrView(row);
  }

  async updateDsr(actorId: string, id: string, input: z.infer<typeof updateDsrSchema>) {
    const row = await this.db.withContext('platform_config', async (tx) => {
      const existing = await tx.dataSubjectRequest.findUnique({ where: { id } });
      if (!existing) throw new NotFoundError('Data subject request not found');
      const now = new Date();
      // One place decides the next status, so an identity check never overrides an explicit status.
      const nextStatus =
        input.status ??
        (input.markIdentityChecked && existing.status === 'received'
          ? ('identity_verified' as const)
          : undefined);
      const updated = await tx.dataSubjectRequest.update({
        where: { id },
        data: {
          ...(nextStatus !== undefined
            ? {
                status: nextStatus,
                completedAt:
                  nextStatus === 'completed' || nextStatus === 'rejected'
                    ? (existing.completedAt ?? now)
                    : null,
              }
            : {}),
          ...(input.markIdentityChecked
            ? {
                identityCheckedBy: existing.identityCheckedBy ?? actorId,
                identityCheckedAt: existing.identityCheckedAt ?? now,
              }
            : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        },
      });
      await appendOutboxEvents(tx, [
        {
          type: updated.status === 'completed' ? 'platform.dsr.completed' : 'platform.dsr.updated',
          estateId: null,
          aggregateType: 'data_subject_request',
          aggregateId: id,
          payload: { dsrId: id, status: updated.status },
          audit: {
            actorType: 'platform_staff',
            actorId,
            action: 'platform.dsr.update',
            resourceType: 'data_subject_request',
            resourceId: id,
            before: { status: existing.status },
            after: { status: updated.status, identityChecked: Boolean(updated.identityCheckedAt) },
          },
        },
      ]);
      return updated;
    });
    return toDsrView(row);
  }

  async listBreaches() {
    const rows = await this.db.withContext('platform_config', (tx) =>
      tx.breachLog.findMany({ orderBy: { detectedAt: 'desc' }, take: 100 }),
    );
    return rows.map(toBreachView);
  }

  async createBreach(actorId: string, input: z.infer<typeof createBreachSchema>) {
    const row = await this.db.withContext('platform_config', async (tx) => {
      const created = await tx.breachLog.create({
        data: {
          detectedAt: input.detectedAt ? new Date(input.detectedAt) : new Date(),
          title: input.title,
          description: input.description,
          severity: input.severity,
          affectedEstates: input.affectedEstates,
          affectedCount: input.affectedCount,
          createdBy: actorId,
        },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'platform.breach.logged',
          estateId: null,
          aggregateType: 'breach_log',
          aggregateId: created.id,
          payload: { breachId: created.id, severity: created.severity },
          audit: {
            actorType: 'platform_staff',
            actorId,
            action: 'platform.breach.create',
            resourceType: 'breach_log',
            resourceId: created.id,
            after: { title: created.title, severity: created.severity },
          },
        },
      ]);
      return created;
    });
    return toBreachView(row);
  }

  async updateBreach(actorId: string, id: string, input: z.infer<typeof updateBreachSchema>) {
    const row = await this.db.withContext('platform_config', async (tx) => {
      const existing = await tx.breachLog.findUnique({ where: { id } });
      if (!existing) throw new NotFoundError('Breach record not found');
      const now = new Date();
      const updated = await tx.breachLog.update({
        where: { id },
        data: {
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.markNdpcNotified ? { ndpcNotifiedAt: existing.ndpcNotifiedAt ?? now } : {}),
          ...(input.markSubjectsNotified
            ? { subjectsNotifiedAt: existing.subjectsNotifiedAt ?? now }
            : {}),
          ...(input.affectedEstates !== undefined
            ? { affectedEstates: input.affectedEstates }
            : {}),
          ...(input.affectedCount !== undefined ? { affectedCount: input.affectedCount } : {}),
        },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'platform.breach.updated',
          estateId: null,
          aggregateType: 'breach_log',
          aggregateId: id,
          payload: { breachId: id, status: updated.status },
          audit: {
            actorType: 'platform_staff',
            actorId,
            action: 'platform.breach.update',
            resourceType: 'breach_log',
            resourceId: id,
            before: { status: existing.status },
            after: { status: updated.status },
          },
        },
      ]);
      return updated;
    });
    return toBreachView(row);
  }

  async listRetentionRules() {
    const rows = await this.db.withContext('platform_config', (tx) =>
      tx.retentionRule.findMany({ orderBy: { dataType: 'asc' } }),
    );
    return rows.map(toRetentionView);
  }

  async upsertRetentionRule(actorId: string, input: z.infer<typeof upsertRetentionRuleSchema>) {
    const row = await this.db.withContext('platform_config', async (tx) => {
      const saved = await tx.retentionRule.upsert({
        where: { dataType: input.dataType },
        create: { ...input, updatedBy: actorId },
        update: {
          retentionDays: input.retentionDays,
          basis: input.basis,
          action: input.action,
          updatedBy: actorId,
          updatedAt: new Date(),
        },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'platform.retention_rule.updated',
          estateId: null,
          aggregateType: 'retention_rule',
          aggregateId: saved.dataType,
          payload: { dataType: saved.dataType, retentionDays: saved.retentionDays },
          audit: {
            actorType: 'platform_staff',
            actorId,
            action: 'platform.retention_rule.update',
            resourceType: 'retention_rule',
            resourceId: saved.dataType,
            after: input,
          },
        },
      ]);
      return saved;
    });
    return toRetentionView(row);
  }

  async countOpenSummary() {
    return this.db.withContext('platform_config', async (tx) => {
      const [openDsrs, openBreaches] = await Promise.all([
        tx.dataSubjectRequest.count({
          where: { status: { in: ['received', 'identity_verified', 'in_progress'] } },
        }),
        tx.breachLog.count({ where: { status: { not: 'closed' } } }),
      ]);
      return { openDsrs, openBreaches };
    });
  }
}
