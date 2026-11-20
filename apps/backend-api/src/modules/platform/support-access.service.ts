import { Injectable } from '@nestjs/common';
import type { requestSupportSessionSchema, supportSessionDecisionSchema } from '@safezone/schemas';
import type { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import type { AuthContext, EstateAccess } from '../../common/auth/auth.decorators';
import { DatabaseService } from '../../common/database/database.service';
import { ConflictError, NotFoundError } from '../../common/errors/domain-error';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';

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

/**
 * Estate support-access consent (management-web.md §6.13; ADR-0019).
 * Techguard staff request time-bounded access; estate administrators approve, deny or revoke it.
 */
@Injectable()
export class SupportAccessService {
  constructor(private readonly db: DatabaseService) {}

  async listForEstate(access: EstateAccess) {
    return this.db.withTenant(access, async (tx) => {
      const now = new Date();
      await tx.supportSession.updateMany({
        where: { estateId: access.estateId, status: 'approved', expiresAt: { lte: now } },
        data: { status: 'expired' },
      });
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
      if (row.status !== 'pending') {
        throw new ConflictError('SUPPORT_SESSION_DECIDED', 'This request has already been decided');
      }
      const minutes = input.durationMinutes ?? row.durationMinutes;
      const now = new Date();
      const updated = await tx.supportSession.update({
        where: { id: row.id },
        data: {
          status: 'approved',
          durationMinutes: minutes,
          decidedBy: access.userId,
          decidedAt: now,
          decisionReason: input.reason ?? null,
          expiresAt: new Date(now.getTime() + minutes * 60_000),
        },
      });
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
      if (row.status !== 'pending') {
        throw new ConflictError('SUPPORT_SESSION_DECIDED', 'This request has already been decided');
      }
      const updated = await tx.supportSession.update({
        where: { id: row.id },
        data: {
          status: 'denied',
          decidedBy: access.userId,
          decidedAt: new Date(),
          decisionReason: input.reason ?? 'Denied by estate administrator',
        },
      });
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
      const row = await tx.supportSession.findFirst({ where: { id, estateId: access.estateId } });
      if (!row) throw new NotFoundError('Support session not found', 'SUPPORT_SESSION_NOT_FOUND');
      if (row.status !== 'approved') {
        throw new ConflictError(
          'SUPPORT_SESSION_NOT_ACTIVE',
          'Only active sessions can be revoked',
        );
      }
      const updated = await tx.supportSession.update({
        where: { id: row.id },
        data: {
          status: 'revoked',
          revokedBy: access.userId,
          revokedAt: new Date(),
          decisionReason: input.reason ?? row.decisionReason,
        },
      });
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
}
