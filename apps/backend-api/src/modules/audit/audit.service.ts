import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import { DatabaseService } from '../../common/database/database.service';
import type { TenantContext } from '../../common/database/tenant-context';
import { uuidv7 } from '../../common/ids/uuidv7';
import type { RelayedEvent } from '../../common/outbox/outbox-relay';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { type ChainedRecord, chainHash, verifyChain } from './audit-chain';

const auditInputSchema = z.object({
  actorType: z.enum(['user', 'guard_device', 'system', 'provider_webhook', 'platform_staff']),
  actorId: z.string().max(100).nullish(),
  actingRole: z.string().max(100).nullish(),
  supportSessionId: z.uuid().nullish(),
  action: z.string().min(3).max(120),
  resourceType: z.string().min(1).max(100),
  resourceId: z.string().max(200).nullish(),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  reason: z.string().max(500).nullish(),
  ip: z.union([z.ipv4(), z.ipv6()]).nullish(),
  userAgent: z.string().max(300).nullish(),
  deviceId: z.string().max(100).nullish(),
  app: z.string().max(40).nullish(),
  requestId: z.string().max(128).nullish(),
});

const cursorSchema = z.object({ seq: z.string().regex(/^\d+$/) });

/**
 * Append-only audit trail (modules/audit.md). Written by the worker from the outbox, never on the request
 * path. Each stream (one per estate, plus the platform stream) is a hash chain in `seq` order.
 */
@Injectable()
export class AuditService {
  constructor(private readonly db: DatabaseService) {}

  /** Idempotent on the event id. Returns false when the event was already recorded. */
  async record(event: RelayedEvent): Promise<boolean> {
    const audit = auditInputSchema.parse(event.audit);
    return this.db.withContext('audit', async (tx) => {
      const stream = event.estateId ?? 'platform';
      // One writer per stream at a time keeps the chain linear.
      await tx.$executeRaw`select pg_advisory_xact_lock(hashtextextended(${`audit:${stream}`}, 0))`;
      const existing = await tx.auditEvent.findUnique({
        where: { sourceEventId: event.id },
        select: { id: true },
      });
      if (existing) return false;

      const previous = await tx.auditEvent.findFirst({
        where: { estateId: event.estateId },
        orderBy: { seq: 'desc' },
        select: { hash: true },
      });
      const record: ChainedRecord = {
        id: uuidv7(),
        occurredAt: new Date(event.occurredAt).toISOString(),
        estateId: event.estateId,
        actorType: audit.actorType,
        actorId: audit.actorId ?? null,
        actingRole: audit.actingRole ?? null,
        supportSessionId: audit.supportSessionId ?? null,
        action: audit.action,
        resourceType: audit.resourceType,
        resourceId: audit.resourceId ?? null,
        before: audit.before ?? null,
        after: audit.after ?? null,
        reason: audit.reason ?? null,
        ip: audit.ip ?? null,
        userAgent: audit.userAgent ?? null,
        deviceId: audit.deviceId ?? null,
        app: audit.app ?? null,
        requestId: audit.requestId ?? null,
        sourceEventId: event.id,
      };
      const prevHash = previous?.hash ?? null;
      await tx.auditEvent.create({
        data: {
          ...record,
          occurredAt: new Date(record.occurredAt),
          before: (record.before ?? undefined) as Prisma.InputJsonValue | undefined,
          after: (record.after ?? undefined) as Prisma.InputJsonValue | undefined,
          hash: chainHash(prevHash, record as unknown as Record<string, unknown>),
          prevHash,
        },
      });
      return true;
    });
  }

  /** Recomputes a stream's chain. Returns the first broken record id, or null when intact. */
  async verifyStream(estateId: string | null): Promise<string | null> {
    const rows = await this.db.withContext('audit', (tx) =>
      tx.auditEvent.findMany({ where: { estateId }, orderBy: { seq: 'asc' } }),
    );
    return verifyChain(
      rows.map((row) => ({
        id: row.id,
        occurredAt: row.occurredAt.toISOString(),
        estateId: row.estateId,
        actorType: row.actorType,
        actorId: row.actorId,
        actingRole: row.actingRole,
        supportSessionId: row.supportSessionId,
        action: row.action,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        before: row.before,
        after: row.after,
        reason: row.reason,
        ip: row.ip,
        userAgent: row.userAgent,
        deviceId: row.deviceId,
        app: row.app,
        requestId: row.requestId,
        sourceEventId: row.sourceEventId,
        hash: row.hash,
        prevHash: row.prevHash,
      })),
    );
  }

  /** Estate audit log, newest first, cursor-paginated. */
  async listForEstate(context: TenantContext, limit: number, cursor?: string) {
    const after = cursor
      ? decodeCursor(
          cursor,
          (value): value is { seq: string } => cursorSchema.safeParse(value).success,
        )
      : undefined;
    const rows = await this.db.withTenant(context, (tx) =>
      tx.auditEvent.findMany({
        where: { estateId: context.estateId, ...(after ? { seq: { lt: BigInt(after.seq) } } : {}) },
        orderBy: { seq: 'desc' },
        take: limit + 1,
      }),
    );
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => ({
        id: row.id,
        occurredAt: row.occurredAt.toISOString(),
        actorType: row.actorType,
        actorId: row.actorId,
        actingRole: row.actingRole,
        action: row.action,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        reason: row.reason,
        app: row.app,
      })),
      nextCursor: rows.length > limit && last ? encodeCursor({ seq: last.seq.toString() }) : null,
    };
  }
}
