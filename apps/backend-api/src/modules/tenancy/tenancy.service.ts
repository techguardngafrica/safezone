import { Injectable } from '@nestjs/common';
import {
  type EstateProfile,
  type EstateSettings,
  estateProfileSchema,
  estateSettingsSchema,
  FEATURE_KEYS,
  type FeatureKey,
} from '@safezone/schemas';
import type { Prisma } from '../../generated/prisma/client';
import { DatabaseService } from '../../common/database/database.service';
import type { TenantContext, Tx } from '../../common/database/tenant-context';
import { ConflictError, NotFoundError } from '../../common/errors/domain-error';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';

/** Estates that can be used at all. Suspended estates keep safety features (tenancy.md §7.5). */
const USABLE_STATUSES = new Set(['approved', 'active', 'suspended']);

export interface MembershipCheck {
  estateId: string;
  estateStatus: string;
}

/**
 * Tenancy core (Phase 0 task 7): estates as tenants, memberships, settings and entitlements.
 * Public interface for other modules; nothing else reads these tables.
 */
@Injectable()
export class TenancyService {
  constructor(private readonly db: DatabaseService) {}

  /** Active membership in a usable estate, or null. Used by the authorization guard on every estate route. */
  async activeMembership(userId: string, estateId: string): Promise<MembershipCheck | null> {
    return this.db.withContext('tenancy', async (tx) => {
      const membership = await tx.estateMembership.findUnique({
        where: { estateId_userId: { estateId, userId } },
        select: { status: true },
      });
      if (membership?.status !== 'active') return null;
      const estate = await tx.estate.findUnique({
        where: { id: estateId },
        select: { status: true },
      });
      if (!estate || !USABLE_STATUSES.has(estate.status)) return null;
      return { estateId, estateStatus: estate.status };
    });
  }

  /** The signed-in user's memberships across estates (own rows only, via RLS). */
  async membershipsOf(userId: string) {
    return this.db.withContext(
      'tenancy',
      async (tx) => {
        const memberships = await tx.estateMembership.findMany({
          where: { userId, status: { in: ['active', 'pending', 'suspended'] } },
          orderBy: { joinedAt: 'asc' },
        });
        const estates = await tx.estate.findMany({
          where: { id: { in: memberships.map((m) => m.estateId) } },
          select: { id: true, name: true, status: true },
        });
        const byId = new Map(estates.map((estate) => [estate.id, estate]));
        return memberships.flatMap((membership) => {
          const estate = byId.get(membership.estateId);
          return estate ? [{ membership, estate }] : [];
        });
      },
      { userId },
    );
  }

  /** Makes the user an active member, inside the caller's estate-scoped transaction. */
  async ensureActiveMembership(tx: Tx, estateId: string, userId: string): Promise<void> {
    await tx.estateMembership.upsert({
      where: { estateId_userId: { estateId, userId } },
      create: { estateId, userId, status: 'active' },
      update: { status: 'active', leftAt: null },
    });
  }

  /** Marks the membership as left (the user no longer lives or works in the estate). */
  async endMembership(tx: Tx, estateId: string, userId: string): Promise<void> {
    await tx.estateMembership.updateMany({
      where: { estateId, userId, status: 'active' },
      data: { status: 'left', leftAt: new Date() },
    });
  }

  /**
   * Memberships of these users in the estate for the staff directory, newest first, keyset-paged on
   * (joinedAt, userId).
   */
  async staffMemberships(
    context: TenantContext,
    userIds: readonly string[],
    options: {
      status?: string;
      after?: { joinedAt: string; userId: string };
      take: number;
    },
  ): Promise<{ userId: string; status: string; joinedAt: Date }[]> {
    if (userIds.length === 0) return [];
    const { after } = options;
    return this.db.withContext(
      'tenancy',
      (tx) =>
        tx.estateMembership.findMany({
          where: {
            estateId: context.estateId,
            userId: { in: [...userIds] },
            ...(options.status ? { status: options.status } : {}),
            ...(after
              ? {
                  OR: [
                    { joinedAt: { lt: new Date(after.joinedAt) } },
                    { joinedAt: new Date(after.joinedAt), userId: { lt: after.userId } },
                  ],
                }
              : {}),
          },
          orderBy: [{ joinedAt: 'desc' }, { userId: 'desc' }],
          take: options.take,
          select: { userId: true, status: true, joinedAt: true },
        }),
      { userId: context.userId, estateId: context.estateId },
    );
  }

  /** Makes an invited staff member an active member of the estate (creating the membership if needed). */
  async activateStaffMembership(
    context: TenantContext,
    userId: string,
  ): Promise<{ status: string; joinedAt: Date }> {
    const select = { id: true, status: true, joinedAt: true } as const;
    return this.db.withContext(
      'tenancy',
      async (tx) => {
        const existing = await tx.estateMembership.findFirst({
          where: { userId, estateId: context.estateId },
          select,
        });
        if (existing) {
          if (existing.status !== 'active') {
            return tx.estateMembership.update({
              where: { id: existing.id },
              data: { status: 'active' },
              select,
            });
          }
          return existing;
        }
        return tx.estateMembership.create({
          data: { userId, estateId: context.estateId, status: 'active' },
          select,
        });
      },
      { userId: context.userId, estateId: context.estateId },
    );
  }

  /** Suspends or reactivates a staff member's membership, with an audited `tenancy.staff.*` event. */
  async setStaffMembershipStatus(
    context: TenantContext & { userId: string },
    targetUserId: string,
    status: 'active' | 'suspended',
    reason: string | undefined,
  ): Promise<{ userId: string; status: 'active' | 'suspended' }> {
    return this.db.withContext(
      'tenancy',
      async (tx) => {
        const existing = await tx.estateMembership.findFirst({
          where: { userId: targetUserId, estateId: context.estateId },
        });
        if (!existing) throw new NotFoundError('Staff member not found', 'STAFF_NOT_FOUND');
        const updated = await tx.estateMembership.update({
          where: { id: existing.id },
          data: { status },
        });
        await appendOutboxEvents(tx, [
          {
            type: `tenancy.staff.${status}`,
            estateId: context.estateId,
            aggregateType: 'estate_membership',
            aggregateId: targetUserId,
            payload: { userId: targetUserId, status },
            audit: {
              actorType: 'user',
              actorId: context.userId,
              action: `tenancy.staff.${status}`,
              resourceType: 'user',
              resourceId: targetUserId,
              reason,
            },
          },
        ]);
        return { userId: updated.userId, status: updated.status as 'active' | 'suspended' };
      },
      { userId: context.userId, estateId: context.estateId },
    );
  }

  /** Active members of an estate (emergency broadcasts, estate-wide announcements). */
  async activeMemberIds(estateId: string): Promise<string[]> {
    const rows = await this.db.withTenant({ estateId, userId: null }, (tx) =>
      tx.estateMembership.findMany({
        where: { estateId, status: 'active' },
        select: { userId: true },
      }),
    );
    return rows.map((row) => row.userId);
  }

  /** Estate by its join code, for residents asking to join. Only estates that accept residents. */
  /** True when the estate exists (any status). For platform flows that run before any estate context. */
  async estateExists(estateId: string): Promise<boolean> {
    return this.db.withContext('tenancy', async (tx) => {
      const estate = await tx.estate.findUnique({ where: { id: estateId }, select: { id: true } });
      return estate !== null;
    });
  }

  /** Estate membership counts per user (same statuses as membershipsOf), in one query. */
  async membershipCountsOf(userIds: readonly string[]): Promise<Map<string, number>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.db.withContext('tenancy', (tx) =>
      tx.estateMembership.groupBy({
        by: ['userId'],
        where: {
          userId: { in: [...userIds] },
          status: { in: ['active', 'pending', 'suspended'] },
        },
        _count: { _all: true },
      }),
    );
    return new Map(rows.map((row) => [row.userId, row._count._all]));
  }

  async estateNamesByIds(ids: readonly string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.db.withContext('tenancy', (tx) =>
      tx.estate.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } }),
    );
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  async findByJoinCode(code: string): Promise<{ id: string; name: string } | null> {
    return this.db.withContext('tenancy', async (tx) => {
      const estate = await tx.estate.findUnique({
        where: { code: code.trim().toUpperCase() },
        select: { id: true, name: true, status: true },
      });
      return estate && (estate.status === 'approved' || estate.status === 'active')
        ? { id: estate.id, name: estate.name }
        : null;
    });
  }

  async getProfile(context: TenantContext): Promise<EstateProfile> {
    return this.db.withTenant(context, async (tx) => {
      const estate = await tx.estate.findUnique({ where: { id: context.estateId } });
      if (!estate) throw new NotFoundError('Estate not found', 'ESTATE_NOT_FOUND');
      return estateProfileSchema.parse(estate);
    });
  }

  /** Optimistic concurrency: `expectedVersion` comes from If-Match. */
  async updateProfile(
    context: TenantContext,
    changes: { name?: string; address?: string; state?: string; lga?: string },
    expectedVersion?: number,
  ): Promise<EstateProfile> {
    return this.db.withTenant(context, async (tx) => {
      const before = await tx.estate.findUnique({ where: { id: context.estateId } });
      if (!before) throw new NotFoundError('Estate not found', 'ESTATE_NOT_FOUND');
      const updated = await tx.estate.updateMany({
        where: {
          id: context.estateId,
          ...(expectedVersion !== undefined ? { version: expectedVersion } : {}),
        },
        data: { ...changes, version: { increment: 1 } },
      });
      if (updated.count === 0) {
        throw new ConflictError(
          'VERSION_MISMATCH',
          'This estate was changed by someone else. Reload and try again.',
        );
      }
      const after = await tx.estate.findUniqueOrThrow({ where: { id: context.estateId } });
      const changed = Object.fromEntries(
        Object.keys(changes).map((key) => [key, (before as Record<string, unknown>)[key] ?? null]),
      ) as Prisma.InputJsonValue;
      await appendOutboxEvents(tx, [
        {
          type: 'tenancy.estate.updated',
          estateId: context.estateId,
          aggregateType: 'estate',
          aggregateId: context.estateId,
          payload: { fields: Object.keys(changes) },
          audit: {
            actorType: 'user',
            actorId: context.userId,
            action: 'tenancy.estate.update',
            resourceType: 'estate',
            resourceId: context.estateId,
            before: changed,
            after: changes as Prisma.InputJsonValue,
          },
        },
      ]);
      return estateProfileSchema.parse(after);
    });
  }

  async getSettings(context: TenantContext): Promise<EstateSettings> {
    return this.db.withTenant(context, async (tx) => {
      const rows = await tx.estateSetting.findMany({ where: { estateId: context.estateId } });
      return this.mergeSettings(rows);
    });
  }

  async updateSettings(
    context: TenantContext,
    changes: Partial<EstateSettings>,
  ): Promise<EstateSettings> {
    return this.db.withTenant(context, async (tx) => {
      const existing = await tx.estateSetting.findMany({ where: { estateId: context.estateId } });
      const before = this.mergeSettings(existing);
      for (const [key, value] of Object.entries(changes)) {
        await tx.estateSetting.upsert({
          where: { estateId_key: { estateId: context.estateId, key } },
          create: {
            estateId: context.estateId,
            key,
            value: value as Prisma.InputJsonValue,
            updatedBy: context.userId,
          },
          update: {
            value: value as Prisma.InputJsonValue,
            updatedBy: context.userId,
            updatedAt: new Date(),
          },
        });
      }
      const keys = Object.keys(changes);
      await appendOutboxEvents(tx, [
        {
          type: 'tenancy.settings.updated',
          estateId: context.estateId,
          aggregateType: 'estate',
          aggregateId: context.estateId,
          payload: { keys },
          audit: {
            actorType: 'user',
            actorId: context.userId,
            action: 'tenancy.settings.update',
            resourceType: 'estate_settings',
            resourceId: context.estateId,
            before: Object.fromEntries(
              keys.map((key) => [key, before[key as keyof EstateSettings]]),
            ) as Prisma.InputJsonValue,
            after: changes as Prisma.InputJsonValue,
          },
        },
      ]);
      return { ...before, ...changes };
    });
  }

  /** Usable estates with a feature enabled (daily jobs fan out over these). */
  async estateIdsWithFeature(feature: FeatureKey): Promise<string[]> {
    const estates = await this.db.withContext('tenancy', (tx) =>
      tx.estate.findMany({
        where: { status: { in: [...USABLE_STATUSES] } },
        select: { id: true },
        orderBy: { id: 'asc' },
      }),
    );
    const result: string[] = [];
    for (const estate of estates) {
      if ((await this.enabledFeatures(estate.id)).includes(feature)) result.push(estate.id);
    }
    return result;
  }

  /** Plan features adjusted by unexpired per-estate overrides. All estates are on the free core plan. */
  async enabledFeatures(estateId: string): Promise<FeatureKey[]> {
    return this.db.withContext(
      'tenancy',
      async (tx) => {
        const estate = await tx.estate.findUnique({
          where: { id: estateId },
          select: { planKey: true },
        });
        if (!estate) return [];
        const plan = await tx.plan.findUnique({ where: { key: estate.planKey } });
        const enabled = new Set<string>(plan?.features ?? []);
        const overrides = await tx.entitlement.findMany({ where: { estateId } });
        const now = new Date();
        for (const override of overrides) {
          if (override.validTo && override.validTo <= now) continue;
          if (override.enabled) enabled.add(override.featureKey);
          else enabled.delete(override.featureKey);
        }
        return FEATURE_KEYS.filter((key) => enabled.has(key));
      },
      { estateId },
    );
  }

  private mergeSettings(rows: readonly { key: string; value: unknown }[]): EstateSettings {
    const stored: Record<string, unknown> = {};
    for (const row of rows) stored[row.key] = row.value;
    // Unknown or invalid stored keys fall back to defaults instead of breaking the estate.
    const result = estateSettingsSchema.safeParse(stored);
    if (result.success) return result.data;
    const defaults = estateSettingsSchema.parse({});
    for (const [key, value] of Object.entries(stored)) {
      const single = estateSettingsSchema.shape[key as keyof EstateSettings];
      if (single?.safeParse(value).success) (defaults as Record<string, unknown>)[key] = value;
    }
    return defaults;
  }
}
