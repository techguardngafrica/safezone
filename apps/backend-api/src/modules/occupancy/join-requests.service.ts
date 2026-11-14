import { Injectable } from '@nestjs/common';
import type { createJoinRequestSchema, joinRequestListQuerySchema } from '@safezone/schemas';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import type { EstateAccess } from '../../common/auth/auth.decorators';
import { DatabaseService } from '../../common/database/database.service';
import type { Tx } from '../../common/database/tenant-context';
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
} from '../../common/errors/domain-error';
import { uuidv7 } from '../../common/ids/uuidv7';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { RateLimiter } from '../../common/rate-limit/rate-limiter';
import { AuthzService } from '../authz/authz.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PropertyService } from '../property/property.service';
import { TenancyService } from '../tenancy/tenancy.service';
import {
  type Approver,
  decideJoin,
  defaultMemberPermissions,
  firstJoinStep,
  JOIN_REQUEST_TTL_MS,
  type JoinRelationship,
  OPEN_JOIN_STATUSES,
  roleForRelationship,
} from './domain/occupancy';
import { isStaffWith, OccupancyService } from './occupancy.service';

type JoinRow = Prisma.JoinRequestGetPayload<object>;
const cursorSchema = z.object({ createdAt: z.iso.datetime(), id: z.uuid() });
/** Estate-code lookups per user per hour: join codes are short, so guessing is throttled. */
const LOOKUPS_PER_HOUR = 30;

/** Join requests (occupancy.md §4): a signed-in person asks to join an estate and unit. */
@Injectable()
export class JoinRequestsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly occupancy: OccupancyService,
    private readonly property: PropertyService,
    private readonly tenancy: TenancyService,
    private readonly authz: AuthzService,
    private readonly notifications: NotificationsService,
    private readonly rateLimiter: RateLimiter,
  ) {}

  async lookupEstate(userId: string, code: string) {
    await this.throttle(userId);
    const estate = await this.tenancy.findByJoinCode(code);
    if (!estate) throw new NotFoundError('No estate with that code', 'ESTATE_CODE_NOT_FOUND');
    return estate;
  }

  async lookupUnits(userId: string, code: string, q: string) {
    const estate = await this.lookupEstate(userId, code);
    return this.property.joinableUnits(estate.id, userId, q);
  }

  async submit(userId: string, input: z.infer<typeof createJoinRequestSchema>) {
    const estate = await this.tenancy
      .getProfile({ estateId: input.estateId, userId })
      .catch(() => null);
    if (!estate || (estate.status !== 'approved' && estate.status !== 'active')) {
      throw new NotFoundError('Estate not found', 'ESTATE_NOT_FOUND');
    }
    const settings = await this.tenancy.getSettings({ estateId: input.estateId, userId });
    try {
      return await this.db.withTenant({ estateId: input.estateId, userId }, async (tx) => {
        const unit = await this.property.unit(tx, input.estateId, input.spaceId);
        if (!unit) throw new NotFoundError('Unit not found', 'SPACE_NOT_FOUND');
        const household = await tx.household.findFirst({
          where: { estateId: input.estateId, spaceId: unit.id, status: 'active' },
        });
        if (input.relationship === 'household_member' && !household) {
          throw new DomainError(
            'NO_HOUSEHOLD',
            'Nobody lives in this unit yet. Ask to join as owner or tenant.',
            422,
          );
        }
        if (input.relationship !== 'household_member' && household) {
          throw new ConflictError(
            'UNIT_OCCUPIED',
            'This unit already has a household. Ask to join it as a household member.',
          );
        }
        if (household) {
          const already = await tx.householdMember.count({
            where: { householdId: household.id, userId, status: 'active' },
          });
          if (already > 0)
            throw new ConflictError('ALREADY_MEMBER', 'You are already in this household');
        }
        const owners =
          (await this.property.activeOwners(tx, input.estateId, [unit.id])).get(unit.id) ?? [];
        const status = firstJoinStep(
          input.relationship,
          settings.tenant_approval,
          owners.length > 0,
        );
        const id = uuidv7();
        const row = await tx.joinRequest.create({
          data: {
            id,
            estateId: input.estateId,
            userId,
            spaceId: unit.id,
            relationship: input.relationship,
            householdId: household?.id ?? null,
            fullName: input.fullName,
            message: input.message ?? null,
            evidenceFileIds: input.evidenceFileIds,
            status,
            expiresAt: new Date(Date.now() + JOIN_REQUEST_TTL_MS),
          },
        });
        await appendOutboxEvents(tx, [
          {
            type: 'occupancy.join_request.submitted',
            estateId: input.estateId,
            aggregateType: 'join_request',
            aggregateId: id,
            payload: { joinRequestId: id, status, relationship: input.relationship },
            audit: {
              actorType: 'user',
              actorId: userId,
              action: 'occupancy.join_request.submit',
              resourceType: 'join_request',
              resourceId: id,
            },
          },
        ]);
        if (household && status === 'awaiting_household_head') {
          await this.notifications.request(tx, {
            intent: 'occupancy.join_request_waiting',
            userIds: [household.headUserId],
            estateId: input.estateId,
            data: { name: input.fullName, unitCode: unit.code },
            dedupeKey: `join:${id}:waiting`,
          });
        }
        if (status === 'awaiting_owner') {
          await this.notifications.request(tx, {
            intent: 'occupancy.join_request_waiting',
            userIds: owners.map((owner) => owner.userId),
            estateId: input.estateId,
            data: { name: input.fullName, unitCode: unit.code },
            dedupeKey: `join:${id}:owner`,
          });
        }
        return this.view(row, unit);
      });
    } catch (error) {
      if ((error as { code?: unknown }).code === 'P2002') {
        throw new ConflictError('JOIN_REQUEST_OPEN', 'You already asked to join this unit');
      }
      throw error;
    }
  }

  async mine(userId: string) {
    const rows = await this.db.withUser(userId, (tx) =>
      tx.joinRequest.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 20 }),
    );
    return Promise.all(
      rows.map(async (row) => {
        const [unit] = await this.db.withTenant({ estateId: row.estateId, userId }, (tx) =>
          this.property.spacesByIds(tx, row.estateId, [row.spaceId]),
        );
        return this.view(row, unit);
      }),
    );
  }

  async cancel(userId: string, requestId: string) {
    const row = await this.db.withUser(userId, (tx) =>
      tx.joinRequest.findFirst({ where: { id: requestId, userId } }),
    );
    if (!row) throw new NotFoundError('Request not found', 'JOIN_REQUEST_NOT_FOUND');
    return this.db.withTenant({ estateId: row.estateId, userId }, async (tx) => {
      const updated = await tx.joinRequest.updateMany({
        where: { id: row.id, status: { in: [...OPEN_JOIN_STATUSES] } },
        data: { status: 'cancelled', decidedAt: new Date(), version: { increment: 1 } },
      });
      if (updated.count === 0)
        throw new ConflictError('JOIN_REQUEST_CLOSED', 'This request is already closed');
      const [unit] = await this.property.spacesByIds(tx, row.estateId, [row.spaceId]);
      return this.view(await tx.joinRequest.findUniqueOrThrow({ where: { id: row.id } }), unit);
    });
  }

  /**
   * Approvals queue. Staff with resident.approve see the estate's queue; a household head sees requests
   * to join their household.
   */
  async list(access: EstateAccess, query: z.infer<typeof joinRequestListQuerySchema>) {
    const after = query.cursor
      ? decodeCursor(
          query.cursor,
          (value): value is z.infer<typeof cursorSchema> => cursorSchema.safeParse(value).success,
        )
      : undefined;
    const staff = isStaffWith(access, 'resident.approve');
    const rows = await this.db.withTenant(access, async (tx) => {
      const headOf = staff
        ? []
        : (
            await tx.household.findMany({
              where: { estateId: access.estateId, headUserId: access.userId, status: 'active' },
              select: { id: true },
            })
          ).map((household) => household.id);
      const owned = staff
        ? []
        : (await this.property.ownedUnits(tx, access.estateId, access.userId)).map(
            (item) => item.ownership.spaceId,
          );
      if (!staff && headOf.length === 0 && owned.length === 0) return [];
      return tx.joinRequest.findMany({
        where: {
          estateId: access.estateId,
          ...(staff
            ? {}
            : {
                OR: [
                  { householdId: { in: headOf } },
                  { spaceId: { in: owned }, relationship: 'tenant' },
                ],
              }),
          ...(query.status
            ? { status: query.status }
            : { status: { in: [...OPEN_JOIN_STATUSES] } }),
          ...(after
            ? {
                OR: [
                  { createdAt: { gt: new Date(after.createdAt) } },
                  { createdAt: new Date(after.createdAt), id: { gt: after.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: query.limit + 1,
      });
    });
    const page = rows.slice(0, query.limit);
    const units = await this.db.withTenant(access, (tx) =>
      this.property.spacesByIds(
        tx,
        access.estateId,
        page.map((row) => row.spaceId),
      ),
    );
    const byId = new Map(units.map((unit) => [unit.id, unit]));
    const last = page.at(-1);
    return {
      items: page.map((row) => this.view(row, byId.get(row.spaceId))),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  async decide(
    access: EstateAccess,
    requestId: string,
    decision: 'approve' | 'reject',
    reason: string | null,
  ) {
    const settings = await this.tenancy.getSettings(access);
    const estate = await this.tenancy.getProfile(access);
    return this.db.withTenant(access, async (tx) => {
      const row = await tx.joinRequest.findFirst({
        where: { id: requestId, estateId: access.estateId },
      });
      if (!row) throw new NotFoundError('Request not found', 'JOIN_REQUEST_NOT_FOUND');
      const approver = await this.approverRole(tx, access, row);
      if (!approver) throw new NotFoundError('Request not found', 'JOIN_REQUEST_NOT_FOUND');
      if (row.userId === access.userId)
        throw new ForbiddenError('You cannot decide your own request');
      const next = decideJoin(row.status, approver, decision, settings.tenant_approval);
      if (!next) {
        throw new ConflictError(
          'JOIN_REQUEST_INVALID_STATE',
          'This request is not waiting for your decision',
        );
      }
      const claimed = await tx.joinRequest.updateMany({
        where: { id: row.id, status: row.status, version: row.version },
        data: {
          status: next,
          version: { increment: 1 },
          ...(next === 'approved' || next === 'rejected'
            ? { decidedAt: new Date(), decidedBy: access.userId, reason }
            : {}),
        },
      });
      if (claimed.count === 0) {
        throw new ConflictError(
          'JOIN_REQUEST_STATE_CHANGED',
          'Someone else decided this request. Reload.',
        );
      }
      const unit = await this.property.unit(tx, access.estateId, row.spaceId);
      if (next === 'approved') await this.applyApproval(tx, row, access.userId);

      const eventType =
        next === 'approved'
          ? 'occupancy.join_request.approved'
          : next === 'rejected'
            ? 'occupancy.join_request.rejected'
            : 'occupancy.join_request.forwarded';
      await appendOutboxEvents(tx, [
        {
          type: eventType,
          estateId: access.estateId,
          aggregateType: 'join_request',
          aggregateId: row.id,
          payload: { joinRequestId: row.id, status: next },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            actingRole: approver,
            action: `occupancy.join_request.${decision}`,
            resourceType: 'join_request',
            resourceId: row.id,
            before: { status: row.status },
            after: { status: next },
            ...(reason ? { reason } : {}),
          },
        },
      ]);
      if (next === 'approved' || next === 'rejected') {
        await this.notifications.request(tx, {
          intent:
            next === 'approved'
              ? 'occupancy.join_request_approved'
              : 'occupancy.join_request_rejected',
          userIds: [row.userId],
          estateId: access.estateId,
          data: { estateName: estate.name, unitCode: unit?.code ?? '', reason: reason ?? '' },
          dedupeKey: `join:${row.id}:${next}`,
        });
      }
      return this.view(
        await tx.joinRequest.findUniqueOrThrow({ where: { id: row.id } }),
        unit ?? undefined,
      );
    });
  }

  // ---- Internals -----------------------------------------------------------------------------

  /** Owners and tenants start a household; household members join the target one. */
  private async applyApproval(tx: Tx, row: JoinRow, actorId: string) {
    const relationship = row.relationship as JoinRelationship;
    if (relationship !== 'household_member') {
      await this.occupancy.startOccupancy(tx, {
        estateId: row.estateId,
        spaceId: row.spaceId,
        headUserId: row.userId,
        headName: row.fullName,
        type: relationship === 'owner' ? 'owner_occupier' : 'tenant',
        startsOn: new Date(new Date().toISOString().slice(0, 10)),
        endsOn: null,
        actorId,
      });
      return;
    }
    const household = row.householdId
      ? await tx.household.findFirst({ where: { id: row.householdId, status: 'active' } })
      : null;
    if (!household)
      throw new ConflictError('HOUSEHOLD_ENDED', 'That household no longer lives here');
    const member = await tx.householdMember.create({
      data: {
        estateId: row.estateId,
        householdId: household.id,
        userId: row.userId,
        fullName: row.fullName,
        relationship: 'other',
        permissions: { ...defaultMemberPermissions(false) },
      },
    });
    await this.tenancy.ensureActiveMembership(tx, row.estateId, row.userId);
    await this.authz.assignBuiltInRole(tx, {
      userId: row.userId,
      roleKey: roleForRelationship(relationship),
      estateId: row.estateId,
      grantedBy: actorId,
      reason: `join request ${row.id}`,
    });
    await appendOutboxEvents(tx, [
      {
        type: 'occupancy.member.added',
        estateId: row.estateId,
        aggregateType: 'household',
        aggregateId: household.id,
        payload: { householdId: household.id, memberId: member.id, userId: row.userId },
      },
    ]);
  }

  /** Who the caller is for this request: manager (staff with resident.approve) or household head. */
  private async approverRole(tx: Tx, access: EstateAccess, row: JoinRow): Promise<Approver | null> {
    if (isStaffWith(access, 'resident.approve')) return 'manager';
    if (row.householdId) {
      const household = await tx.household.findFirst({
        where: { id: row.householdId, headUserId: access.userId, status: 'active' },
        select: { id: true },
      });
      if (household) return 'household_head';
    }
    if (row.status === 'awaiting_owner') {
      const owners =
        (await this.property.activeOwners(tx, row.estateId, [row.spaceId])).get(row.spaceId) ?? [];
      if (owners.some((owner) => owner.userId === access.userId)) return 'owner';
    }
    return null;
  }

  private async throttle(userId: string) {
    const limit = await this.rateLimiter.hit(`join:lookup:${userId}`, LOOKUPS_PER_HOUR, 3600);
    if (!limit.allowed) throw new RateLimitedError(limit.retryAfterSeconds);
  }

  private view(row: JoinRow, unit: { id: string; code: string; name: string } | undefined) {
    return {
      id: row.id,
      estateId: row.estateId,
      userId: row.userId,
      fullName: row.fullName,
      unit: unit ?? { id: row.spaceId, code: '', name: '' },
      relationship: row.relationship as JoinRelationship,
      householdId: row.householdId,
      message: row.message,
      status: row.status as 'awaiting_manager',
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
      decidedAt: row.decidedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt.toISOString(),
    };
  }
}
