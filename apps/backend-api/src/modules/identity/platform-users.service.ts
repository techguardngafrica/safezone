import { Injectable } from '@nestjs/common';
import type { platformUserListQuerySchema } from '@safezone/schemas';
import { z } from 'zod';
import { DatabaseService } from '../../common/database/database.service';
import { ConflictError, ForbiddenError, NotFoundError } from '../../common/errors/domain-error';
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
    const userIds = page.map((user) => user.id);
    // One batched query each for the whole page, not two per row (keeps the pool free for SOS).
    const [estateCounts, platformRoles] = await Promise.all([
      this.tenancy.membershipCountsOf(userIds),
      this.authz.platformRolesOf(userIds),
    ]);
    const items = page.map((user) => ({
      id: user.id,
      fullName: user.fullName,
      phone: user.phoneE164,
      email: user.email,
      status: user.status,
      mfaEnabled: user.mfaEnabled,
      estateCount: estateCounts.get(user.id) ?? 0,
      platformRoles: platformRoles.get(user.id) ?? [],
      createdAt: user.createdAt.toISOString(),
    }));
    const last = page.at(-1);
    return {
      items,
      nextCursor: hasMore && last ? encodeCursor({ id: last.id }) : null,
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

  /**
   * Lock moves `active` to `locked`; unlock moves `locked` back to `active`. Any other status
   * (e.g. `deactivated`) is left alone, so an unlock can never reactivate a closed account.
   */
  async setLock(actorId: string, userId: string, lock: boolean, reason: string) {
    if (lock && actorId === userId) {
      throw new ConflictError('CANNOT_LOCK_SELF', 'You cannot lock your own account');
    }
    await this.assertMayActOn(actorId, userId);
    const now = new Date();
    await this.db.withContext('identity', async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundError('User not found', 'USER_NOT_FOUND');
      const from = lock ? 'active' : 'locked';
      const nextStatus = lock ? 'locked' : 'active';
      if (user.status !== from) {
        throw new ConflictError(
          lock ? 'USER_NOT_ACTIVE' : 'USER_NOT_LOCKED',
          lock ? 'Only an active account can be locked' : 'Only a locked account can be unlocked',
        );
      }
      // Conditional update: a concurrent status change makes this match nothing instead of overwriting it.
      const result = await tx.user.updateMany({
        where: { id: userId, status: from },
        data: { status: nextStatus },
      });
      if (result.count === 0) {
        throw new ConflictError(
          'USER_STATUS_CHANGED',
          'The account status changed; reload and retry',
        );
      }
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
    await this.assertMayActOn(actorId, userId);
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
    await this.assertMayActOn(actorId, userId);
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

  /**
   * Platform staff accounts (anyone holding a platform role) can only be locked, signed out or have
   * MFA reset by someone who manages platform staff. Otherwise a support agent could lock out every
   * Super Admin with `platform.user.manage` alone.
   */
  private async assertMayActOn(actorId: string, targetId: string) {
    if (actorId === targetId) return;
    const targetRoles = await this.authz.platformRolesOf([targetId]);
    if ((targetRoles.get(targetId) ?? []).length === 0) return;
    const actorGrant = this.authz.grantIn(await this.authz.activeAssignments(actorId), null);
    if (!actorGrant.permissions.has('platform.staff.manage')) {
      throw new ForbiddenError(
        'Only staff managers can act on platform staff accounts',
        'PLATFORM_STAFF_PROTECTED',
      );
    }
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
    const rows = userIds.length === 0 ? [] : await this.fetchStaffProfiles(userIds);
    return new Map(rows.map((u) => [u.id, u]));
  }

  private async fetchStaffProfiles(userIds: readonly string[]) {
    return this.db.withContext('identity', (tx) =>
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
  }
}
