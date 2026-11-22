import { Injectable } from '@nestjs/common';
import type {
  platformSupportSessionListQuerySchema,
  requestSupportSessionSchema,
  supportSessionDecisionSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../common/database/tenant-context';
import type { AuthContext, EstateAccess } from '../../common/auth/auth.decorators';
import { DatabaseService } from '../../common/database/database.service';
import { ConflictError, ForbiddenError, NotFoundError } from '../../common/errors/domain-error';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { TenancyService } from '../tenancy/tenancy.service';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';

const sessionCursorSchema = z.object({ id: z.uuid() });
const isSessionCursor = (value: unknown): value is { id: string } =>
  sessionCursorSchema.safeParse(value).success;

function toView(row: Prisma.SupportSessionGetPayload<object>) {
  return {
    id: row.id,
    estateId: row.estateId,
    platformUserId: row.platformUserId,
    platformUserName: row.platformUserName,
    reason: row.reason,
    status: row.status as 'pending' | 'approved' | 'denied' | 'revoked' | 'expired',
    durationMinutes: row.durationMinutes,
    requestedAt: row.requestedAt.toISOString(),
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decisionReason: row.decisionReason,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

/** Marks approved sessions past their end as expired, with an audited event for each. */
async function expireDue(tx: Tx, estateId: string, now: Date): Promise<void> {
  const due = await tx.supportSession.findMany({
    where: { estateId, status: 'approved', expiresAt: { lte: now } },
    select: { id: true, platformUserId: true },
  });
  if (due.length === 0) return;
  await tx.supportSession.updateMany({
    where: { id: { in: due.map((row) => row.id) }, status: 'approved' },
    data: { status: 'expired' },
  });
  await appendOutboxEvents(
    tx,
    due.map((row) => ({
      type: 'platform.support_session.expired',
      estateId,
      aggregateType: 'support_session',
      aggregateId: row.id,
      payload: { sessionId: row.id, platformUserId: row.platformUserId },
      audit: {
        actorType: 'system' as const,
        actorId: null,
        supportSessionId: row.id,
        action: 'platform.support_session.expire',
        resourceType: 'support_session',
        resourceId: row.id,
      },
    })),
  );
}

/**
 * Estate support-access consent (management-web.md §6.13, platform.md §4; ADR-0019).
 * Techguard staff request time-bounded access; estate administrators approve, deny or revoke it.
 * AuthorizationGuard admits an agent into the estate only while their session is approved and unexpired,
 * read-only, and audits every request (`platform.support_session.accessed`).
 */
@Injectable()
export class SupportAccessService {
  constructor(
    private readonly db: DatabaseService,
    private readonly tenancy: TenancyService,
  ) {}

  /** The agent's approved, unexpired session in this estate, or null. Expires due sessions first. */
  async activeSession(platformUserId: string, estateId: string): Promise<{ id: string } | null> {
    return this.db.withTenant({ estateId, userId: platformUserId }, async (tx) => {
      const now = new Date();
      await expireDue(tx, estateId, now);
      return tx.supportSession.findFirst({
        where: {
          estateId,
          platformUserId,
          status: 'approved',
          revokedAt: null,
          expiresAt: { gt: now },
        },
        orderBy: { decidedAt: 'desc' },
        select: { id: true },
      });
    });
  }

  /** Audit trail entry for one request made during a support session (platform.md §4.6). */
  async recordAccess(input: {
    estateId: string;
    platformUserId: string;
    sessionId: string;
    method: string;
    route: string;
  }): Promise<void> {
    await this.db.withTenant(
      { estateId: input.estateId, userId: input.platformUserId },
      async (tx) => {
        await appendOutboxEvents(tx, [
          {
            type: 'platform.support_session.accessed',
            estateId: input.estateId,
            aggregateType: 'support_session',
            aggregateId: input.sessionId,
            payload: { sessionId: input.sessionId, method: input.method, route: input.route },
            audit: {
              actorType: 'platform_staff',
              actorId: input.platformUserId,
              supportSessionId: input.sessionId,
              action: 'platform.support_session.access',
              resourceType: 'route',
              resourceId: null,
              after: { method: input.method, route: input.route },
            },
          },
        ]);
      },
    );
  }

  async listForEstate(access: EstateAccess) {
    return this.db.withTenant(access, async (tx) => {
      await expireDue(tx, access.estateId, new Date());
      const rows = await tx.supportSession.findMany({
        where: { estateId: access.estateId },
        orderBy: { requestedAt: 'desc' },
        take: 100,
      });
      return rows.map(toView);
    });
  }

  async requestAccess(
    auth: AuthContext,
    estateId: string,
    input: z.infer<typeof requestSupportSessionSchema>,
  ) {
    // No orphan requests for estates that do not exist.
    if (!(await this.tenancy.estateExists(estateId))) {
      throw new NotFoundError('Estate not found', 'ESTATE_NOT_FOUND');
    }
    const user = await this.db.withContext(
      'identity',
      (tx) =>
        tx.user.findUnique({
          where: { id: auth.userId },
          select: { fullName: true },
        }),
      { userId: auth.userId },
    );
    return this.db.withTenant({ estateId, userId: auth.userId }, async (tx) => {
      const row = await tx.supportSession.create({
        data: {
          estateId,
          platformUserId: auth.userId,
          platformUserName: user?.fullName ?? null,
          reason: input.reason,
          durationMinutes: input.durationMinutes,
          status: 'pending',
        },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'platform.support_session.requested',
          estateId,
          aggregateType: 'support_session',
          aggregateId: row.id,
          payload: { sessionId: row.id, platformUserId: auth.userId },
          audit: {
            actorType: 'user',
            actorId: auth.userId,
            action: 'platform.support_session.request',
            resourceType: 'support_session',
            resourceId: row.id,
            reason: input.reason,
          },
        },
      ]);
      return toView(row);
    });
  }

  async approve(
    access: EstateAccess,
    id: string,
    input: z.infer<typeof supportSessionDecisionSchema>,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const row = await tx.supportSession.findFirst({ where: { id, estateId: access.estateId } });
      if (!row) throw new NotFoundError('Support session not found', 'SUPPORT_SESSION_NOT_FOUND');
      if (row.platformUserId === access.userId) {
        throw new ForbiddenError(
          'You cannot decide your own support-access request',
          'SUPPORT_SESSION_SELF_DECISION',
        );
      }
      if (row.status !== 'pending') {
        throw new ConflictError('SUPPORT_SESSION_DECIDED', 'This request has already been decided');
      }
      const minutes = input.durationMinutes ?? row.durationMinutes;
      const now = new Date();
      const claimed = await tx.supportSession.updateMany({
        where: { id: row.id, status: 'pending' },
        data: {
          status: 'approved',
          durationMinutes: minutes,
          decidedBy: access.userId,
          decidedAt: now,
          decisionReason: input.reason ?? null,
          expiresAt: new Date(now.getTime() + minutes * 60_000),
        },
      });
      if (claimed.count !== 1)
        throw new ConflictError('SUPPORT_SESSION_DECIDED', 'This request has already been decided');
      const updated = await tx.supportSession.findFirstOrThrow({ where: { id: row.id } });
      await appendOutboxEvents(tx, [
        {
          type: 'platform.support_session.approved',
          estateId: access.estateId,
          aggregateType: 'support_session',
          aggregateId: row.id,
          payload: { sessionId: row.id, expiresAt: updated.expiresAt?.toISOString() },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'platform.support_session.approve',
            resourceType: 'support_session',
            resourceId: row.id,
            reason: input.reason ?? null,
          },
        },
      ]);
      return toView(updated);
    });
  }

  async deny(
    access: EstateAccess,
    id: string,
    input: z.infer<typeof supportSessionDecisionSchema>,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const row = await tx.supportSession.findFirst({ where: { id, estateId: access.estateId } });
      if (!row) throw new NotFoundError('Support session not found', 'SUPPORT_SESSION_NOT_FOUND');
      if (row.platformUserId === access.userId) {
        throw new ForbiddenError(
          'You cannot decide your own support-access request',
          'SUPPORT_SESSION_SELF_DECISION',
        );
      }
      if (row.status !== 'pending') {
        throw new ConflictError('SUPPORT_SESSION_DECIDED', 'This request has already been decided');
      }
      const claimed = await tx.supportSession.updateMany({
        where: { id: row.id, status: 'pending' },
        data: {
          status: 'denied',
          decidedBy: access.userId,
          decidedAt: new Date(),
          decisionReason: input.reason ?? 'Denied by estate administrator',
        },
      });
      if (claimed.count !== 1)
        throw new ConflictError('SUPPORT_SESSION_DECIDED', 'This request has already been decided');
      const updated = await tx.supportSession.findFirstOrThrow({ where: { id: row.id } });
      await appendOutboxEvents(tx, [
        {
          type: 'platform.support_session.denied',
          estateId: access.estateId,
          aggregateType: 'support_session',
          aggregateId: row.id,
          payload: { sessionId: row.id },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'platform.support_session.deny',
            resourceType: 'support_session',
            resourceId: row.id,
            reason: input.reason ?? null,
          },
        },
      ]);
      return toView(updated);
    });
  }

  async revoke(
    access: EstateAccess,
    id: string,
    input: z.infer<typeof supportSessionDecisionSchema>,
  ) {
    return this.db.withTenant(access, async (tx) => {
      await expireDue(tx, access.estateId, new Date());
      const row = await tx.supportSession.findFirst({ where: { id, estateId: access.estateId } });
      if (!row) throw new NotFoundError('Support session not found', 'SUPPORT_SESSION_NOT_FOUND');
      if (row.status !== 'approved') {
        throw new ConflictError(
          'SUPPORT_SESSION_NOT_ACTIVE',
          'Only active sessions can be revoked',
        );
      }
      const claimed = await tx.supportSession.updateMany({
        where: { id: row.id, status: 'approved' },
        data: {
          status: 'revoked',
          revokedBy: access.userId,
          revokedAt: new Date(),
          decisionReason: input.reason ?? row.decisionReason,
        },
      });
      if (claimed.count !== 1)
        throw new ConflictError(
          'SUPPORT_SESSION_NOT_ACTIVE',
          'Only active sessions can be revoked',
        );
      const updated = await tx.supportSession.findFirstOrThrow({ where: { id: row.id } });
      await appendOutboxEvents(tx, [
        {
          type: 'platform.support_session.revoked',
          estateId: access.estateId,
          aggregateType: 'support_session',
          aggregateId: row.id,
          payload: { sessionId: row.id },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'platform.support_session.revoke',
            resourceType: 'support_session',
            resourceId: row.id,
            reason: input.reason ?? null,
          },
        },
      ]);
      return toView(updated);
    });
  }

  /** Cross-estate list of support sessions for platform support staff (ADR-0022). */
  async listForPlatform(query: z.infer<typeof platformSupportSessionListQuerySchema>) {
    const after = query.cursor ? decodeCursor(query.cursor, isSessionCursor) : null;
    const rows = await this.db.withContext('platform_config', (tx) =>
      tx.supportSession.findMany({
        where: {
          ...(query.status ? { status: query.status } : {}),
          ...(query.estateId ? { estateId: query.estateId } : {}),
          ...(after ? { id: { lt: after.id } } : {}),
        },
        orderBy: { id: 'desc' },
        take: query.limit + 1,
      }),
    );
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const estateNames = await this.tenancy.estateNamesByIds(page.map((row) => row.estateId));
    return {
      items: page.map((row) => ({
        ...toView(row),
        estateName: estateNames.get(row.estateId) ?? null,
      })),
      nextCursor: hasMore ? encodeCursor({ id: page[page.length - 1]!.id }) : null,
    };
  }

  async countSummary() {
    const now = new Date();
    return this.db.withContext('platform_config', async (tx) => {
      const [activeSessions, pendingSessions] = await Promise.all([
        tx.supportSession.count({
          where: { status: 'approved', revokedAt: null, expiresAt: { gt: now } },
        }),
        tx.supportSession.count({ where: { status: 'pending' } }),
      ]);
      return { activeSessions, pendingSessions };
    });
  }
}
