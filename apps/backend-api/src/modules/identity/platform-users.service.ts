import { Injectable } from '@nestjs/common';
import type { platformUserListQuerySchema } from '@safezone/schemas';
import { z } from 'zod';
import { DatabaseService } from '../../common/database/database.service';
import { ConflictError, NotFoundError } from '../../common/errors/domain-error';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { AuthzService } from '../authz/authz.service';
import { TenancyService } from '../tenancy/tenancy.service';

const cursorSchema = z.object({ id: z.uuid() });
const isIdCursor = (value: unknown): value is { id: string } =>
  cursorSchema.safeParse(value).success;
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Platform-wide user lookup and account recovery (super-admin.md §6.3, ADR-0022).
 * Shows estate membership names only — never tenant data.
 */
@Injectable()
export class PlatformUsersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly tenancy: TenancyService,
    private readonly authz: AuthzService,
  ) {}

  async list(query: z.infer<typeof platformUserListQuerySchema>) {
    const after = query.cursor ? decodeCursor(query.cursor, isIdCursor) : null;
    const q = query.q?.trim();
    const rows = await this.db.withContext('identity', (tx) =>
      tx.user.findMany({
        where: {
          ...(query.status ? { status: query.status } : {}),
          ...(q
            ? {
                OR: [
                  ...(uuidRegex.test(q) ? [{ id: q }] : []),
                  { phoneE164: { contains: q, mode: 'insensitive' as const } },
                  { email: { contains: q, mode: 'insensitive' as const } },
                  { fullName: { contains: q, mode: 'insensitive' as const } },
                ],
              }
            : {}),
          ...(after ? { id: { lt: after.id } } : {}),
        },
        orderBy: { id: 'desc' },
        take: query.limit + 1,
      }),
    );
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const items = await Promise.all(
      page.map(async (user) => {
        const [memberships, assignments] = await Promise.all([
          this.tenancy.membershipsOf(user.id),
          this.authz.activeAssignments(user.id),
        ]);
        const platformRoles = assignments.filter((a) => a.estateId === null).map((a) => a.roleKey);
        return {
          id: user.id,
          fullName: user.fullName,
          phone: user.phoneE164,
          email: user.email,
          status: user.status,
          mfaEnabled: user.mfaEnabled,
          estateCount: memberships.length,
          platformRoles,
          createdAt: user.createdAt.toISOString(),
        };
      }),
    );
    return {
      items,
      nextCursor: hasMore ? encodeCursor({ id: page[page.length - 1]!.id }) : null,
    };
  }

  async get(userId: string) {
    const [user, activeSessionCount] = await this.db.withContext('identity', async (tx) => {
      const u = await tx.user.findUnique({ where: { id: userId } });
      if (!u) return [null, 0] as const;
      const sessions = await tx.session.count({
        where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      });
      return [u, sessions] as const;
    });
    if (!user) throw new NotFoundError('User not found', 'USER_NOT_FOUND');
    const [memberships, assignments] = await Promise.all([
      this.tenancy.membershipsOf(user.id),
      this.authz.activeAssignments(user.id),
    ]);
    const platformRoles = assignments.filter((a) => a.estateId === null).map((a) => a.roleKey);
    const membershipsWithRoles = memberships.map((m) => ({
      estateId: m.estate.id,
      estateName: m.estate.name,
      status: m.membership.status,
      roles: assignments.filter((a) => a.estateId === m.estate.id).map((a) => a.roleKey),
    }));
    return {
      id: user.id,
      fullName: user.fullName,
      phone: user.phoneE164,
      email: user.email,
      status: user.status,
      mfaEnabled: user.mfaEnabled,
      estateCount: memberships.length,
      platformRoles,
      activeSessionCount,
      memberships: membershipsWithRoles,
      createdAt: user.createdAt.toISOString(),
    };
  }

  async setLock(actorId: string, userId: string, lock: boolean, reason: string) {
    if (lock && actorId === userId) {
      throw new ConflictError('CANNOT_LOCK_SELF', 'You cannot lock your own account');
    }
    const now = new Date();
    await this.db.withContext('identity', async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundError('User not found', 'USER_NOT_FOUND');
      const nextStatus = lock ? 'locked' : 'active';
      await tx.user.update({ where: { id: userId }, data: { status: nextStatus } });
      if (lock) {
        await tx.session.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: now, revokedReason: 'support' },
        });
      }
      await appendOutboxEvents(tx, [
        {
          type: lock ? 'identity.user.locked' : 'identity.user.unlocked',
          estateId: null,
          aggregateType: 'user',
          aggregateId: userId,
          payload: { userId, status: nextStatus },
          audit: {
            actorType: 'platform_staff',
            actorId,
            action: lock ? 'platform.user.lock' : 'platform.user.unlock',
            resourceType: 'user',
            resourceId: userId,
            before: { status: user.status },
            after: { status: nextStatus },
            reason,
          },
        },
      ]);
    });
    return this.get(userId);
  }

  async revokeAllSessions(actorId: string, userId: string, reason: string) {
    const now = new Date();
    await this.db.withContext('identity', async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!user) throw new NotFoundError('User not found', 'USER_NOT_FOUND');
      const result = await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now, revokedReason: 'support' },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'identity.sessions.revoked',
          estateId: null,
          aggregateType: 'user',
          aggregateId: userId,
          payload: { userId, revokedCount: result.count },
          audit: {
            actorType: 'platform_staff',
            actorId,
            action: 'platform.user.revoke_sessions',
            resourceType: 'user',
            resourceId: userId,
            after: { revokedCount: result.count },
            reason,
          },
        },
      ]);
    });
    return this.get(userId);
  }

  async resetMfa(actorId: string, userId: string, reason: string) {
    const now = new Date();
    await this.db.withContext('identity', async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!user) throw new NotFoundError('User not found', 'USER_NOT_FOUND');
      await tx.mfaFactor.deleteMany({ where: { userId } });
      await tx.recoveryCode.deleteMany({ where: { userId } });
      await tx.user.update({ where: { id: userId }, data: { mfaEnabled: false } });
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now, revokedReason: 'support' },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'identity.mfa.reset',
          estateId: null,
          aggregateType: 'user',
          aggregateId: userId,
          payload: { userId },
          audit: {
            actorType: 'platform_staff',
            actorId,
            action: 'platform.user.reset_mfa',
            resourceType: 'user',
            resourceId: userId,
            after: { mfaEnabled: false },
            reason,
          },
        },
      ]);
    });
    return this.get(userId);
  }

  async countSummary() {
    return this.db.withContext('identity', async (tx) => {
      const [total, locked] = await Promise.all([
        tx.user.count(),
        tx.user.count({ where: { status: 'locked' } }),
      ]);
      return { total, locked };
    });
  }

  async getStaffProfiles(userIds: readonly string[]) {
    if (userIds.length === 0) return new Map();
    const rows = await this.db.withContext('identity', (tx) =>
      tx.user.findMany({
        where: { id: { in: [...userIds] } },
        select: {
          id: true,
          fullName: true,
          phoneE164: true,
          email: true,
          status: true,
          mfaEnabled: true,
        },
      }),
    );
    return new Map(rows.map((u) => [u.id, u]));
  }
}
