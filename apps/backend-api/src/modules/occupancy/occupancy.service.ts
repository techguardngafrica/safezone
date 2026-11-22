import { Injectable } from '@nestjs/common';
import { maskPhone } from '@safezone/auth';
import { RESIDENT_ROLE_KEYS } from '@safezone/permissions';
import type {
  addHouseholdMemberSchema,
  createDomesticStaffSchema,
  createEmergencyContactSchema,
  createOccupancySchema,
  createVehicleSchema,
  residentListQuerySchema,
  updateHouseholdMemberSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import type { EstateAccess } from '../../common/auth/auth.decorators';
import { DatabaseService } from '../../common/database/database.service';
import type { ImportOutcome } from '../../common/imports/import-outcome';
import type { TenantContext, Tx } from '../../common/database/tenant-context';
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
} from '../../common/errors/domain-error';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { AuthzService } from '../authz/authz.service';
import { IdentityService } from '../identity/identity.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PropertyService } from '../property/property.service';
import { TenancyService } from '../tenancy/tenancy.service';
import {
  defaultMemberPermissions,
  HEAD_PERMISSIONS,
  type MemberPermissions,
  normalisePlate,
  parsePermissions,
} from './domain/occupancy';

type HouseholdRow = Prisma.HouseholdGetPayload<{ include: { members: true; occupancies: true } }>;
type StaffRow = Prisma.DomesticStaffGetPayload<object>;
type VehicleRow = Prisma.VehicleGetPayload<object>;

export interface BillingOccupant {
  householdId: string;
  payerUserId: string;
  payerName: string | null;
  /** YYYY-MM-DD, null when the household has no active occupancy record. */
  startsOn: string | null;
}

const MAX_EMERGENCY_CONTACTS = 5;
const residentCursorSchema = z.object({ name: z.string(), id: z.uuid() });

/** True when the caller is estate staff with this permission (not a resident holding it via homeowner). */
export function isStaffWith(access: EstateAccess, permission: string): boolean {
  return (
    access.permissions.has(permission) &&
    access.roles.some((role) => !RESIDENT_ROLE_KEYS.includes(role))
  );
}

function toDate(value: string | undefined): Date {
  return value
    ? new Date(`${value}T00:00:00.000Z`)
    : new Date(new Date().toISOString().slice(0, 10));
}

/**
 * Occupancy module (occupancy.md): households, members, occupancies, vehicles, domestic staff and
 * emergency contacts. Other modules use `householdsOf`, `vehicleByPlate` and `activeStaff`.
 */
@Injectable()
export class OccupancyService {
  constructor(
    private readonly db: DatabaseService,
    private readonly property: PropertyService,
    private readonly tenancy: TenancyService,
    private readonly authz: AuthzService,
    private readonly identity: IdentityService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---- Public interface for other modules ----------------------------------------------------

  /** The user's active households in an estate, with their permissions there. */
  /** True when the user is flagged as a minor in any active household of the estate (no ads for minors). */
  async isMinorIn(estateId: string, userId: string): Promise<boolean> {
    const count = await this.db.withTenant({ estateId, userId }, (tx) =>
      tx.householdMember.count({ where: { estateId, userId, status: 'active', isMinor: true } }),
    );
    return count > 0;
  }

  async householdsOf(estateId: string, userId: string) {
    const rows = await this.db.withTenant({ estateId, userId }, (tx) =>
      tx.householdMember.findMany({
        where: { estateId, userId, status: 'active', household: { status: 'active' } },
        include: {
          household: { select: { id: true, spaceId: true, name: true, headUserId: true } },
        },
      }),
    );
    return rows.map((row) => ({
      householdId: row.household.id,
      spaceId: row.household.spaceId,
      householdName: row.household.name,
      isHead: row.household.headUserId === userId,
      permissions: parsePermissions(row.permissions),
    }));
  }

  /** Active household members' user ids (e.g. walk-in approvals, gate alerts). */
  async householdUserIds(
    tx: Tx,
    estateId: string,
    householdId: string,
    permission?: keyof MemberPermissions,
  ) {
    const rows = await tx.householdMember.findMany({
      where: { estateId, householdId, status: 'active', userId: { not: null } },
      select: { userId: true, permissions: true },
    });
    return rows
      .filter((row) => !permission || parsePermissions(row.permissions)[permission])
      .map((row) => row.userId as string);
  }

  /** The active household living in a unit, inside the caller's transaction. */
  async activeHouseholdAt(tx: Tx, estateId: string, spaceId: string) {
    return tx.household.findFirst({
      where: { estateId, spaceId, status: 'active' },
      select: { id: true, name: true, headUserId: true },
    });
  }

  /**
   * Who pays occupant charges in each unit (billing.md rule 7): the active household's head, with the
   * date their occupancy started (for proration). Units without an active household are left out.
   */
  async billingOccupants(tx: Tx, estateId: string, unitIds: readonly string[]) {
    if (unitIds.length === 0) return new Map<string, BillingOccupant>();
    const households = await tx.household.findMany({
      where: { estateId, status: 'active', spaceId: { in: [...unitIds] } },
      select: {
        id: true,
        spaceId: true,
        headUserId: true,
        members: {
          where: { relationship: 'head', status: 'active' },
          select: { userId: true, fullName: true },
        },
        occupancies: {
          where: { status: 'active' },
          select: { startsOn: true },
          orderBy: { startsOn: 'asc' },
          take: 1,
        },
      },
    });
    return new Map(
      households.map((household) => [
        household.spaceId,
        {
          householdId: household.id,
          payerUserId: household.headUserId,
          payerName:
            household.members.find((member) => member.userId === household.headUserId)?.fullName ??
            null,
          startsOn: household.occupancies[0]?.startsOn.toISOString().slice(0, 10) ?? null,
        } satisfies BillingOccupant,
      ]),
    );
  }

  /** The user's active household units with the date they joined each (community history windows). */
  async unitsSince(tx: Tx, estateId: string, userId: string) {
    const rows = await tx.householdMember.findMany({
      where: { estateId, userId, status: 'active', household: { status: 'active' } },
      select: { joinedAt: true, household: { select: { id: true, spaceId: true } } },
    });
    return rows.map((row) => ({
      householdId: row.household.id,
      spaceId: row.household.spaceId,
      joinedAt: row.joinedAt,
    }));
  }

  /** Users living in these units (announcement audiences). */
  async residentUserIdsInUnits(
    tx: Tx,
    estateId: string,
    unitIds: readonly string[],
  ): Promise<string[]> {
    if (unitIds.length === 0) return [];
    const rows = await tx.householdMember.findMany({
      where: {
        estateId,
        status: 'active',
        userId: { not: null },
        household: { status: 'active', spaceId: { in: [...unitIds] } },
      },
      select: { userId: true },
    });
    return [...new Set(rows.map((row) => row.userId as string))];
  }

  /** The unit of an active household, or null. */
  async activeHouseholdUnit(tx: Tx, estateId: string, householdId: string): Promise<string | null> {
    const household = await tx.household.findFirst({
      where: { id: householdId, estateId, status: 'active' },
      select: { spaceId: true },
    });
    return household?.spaceId ?? null;
  }

  /** The member's permissions in a household, or null when they are not an active member. */
  async memberPermissions(tx: Tx, estateId: string, householdId: string, userId: string) {
    const member = await tx.householdMember.findFirst({
      where: { estateId, householdId, userId, status: 'active', household: { status: 'active' } },
      select: { permissions: true },
    });
    return member ? parsePermissions(member.permissions) : null;
  }

  // ---- Occupancies ---------------------------------------------------------------------------

  /**
   * Starts a household in a unit with its head (join approval or a manager recording residents). One
   * active household per unit; the unit becomes occupied. Runs inside the caller's transaction.
   */
  async startOccupancy(
    tx: Tx,
    input: {
      estateId: string;
      spaceId: string;
      headUserId: string;
      headName: string;
      type: 'owner_occupier' | 'tenant' | 'other';
      startsOn: Date;
      endsOn: Date | null;
      actorId: string | null;
    },
  ) {
    const unit = await this.property.unit(tx, input.estateId, input.spaceId);
    if (!unit) throw new NotFoundError('Unit not found', 'SPACE_NOT_FOUND');
    const occupied = await tx.household.count({
      where: { estateId: input.estateId, spaceId: input.spaceId, status: 'active' },
    });
    if (occupied > 0) {
      throw new ConflictError('UNIT_OCCUPIED', 'This unit already has an active household');
    }
    const household = await tx.household.create({
      data: {
        estateId: input.estateId,
        spaceId: input.spaceId,
        headUserId: input.headUserId,
        name: `${input.headName} household`,
      },
    });
    await tx.householdMember.create({
      data: {
        estateId: input.estateId,
        householdId: household.id,
        userId: input.headUserId,
        fullName: input.headName,
        relationship: 'head',
        permissions: { ...HEAD_PERMISSIONS },
      },
    });
    const occupancy = await tx.occupancy.create({
      data: {
        estateId: input.estateId,
        spaceId: input.spaceId,
        householdId: household.id,
        type: input.type,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        createdBy: input.actorId,
      },
    });
    await this.property.setUnitStatus(tx, input.estateId, input.spaceId, 'occupied');
    await this.tenancy.ensureActiveMembership(tx, input.estateId, input.headUserId);
    await this.authz.assignBuiltInRole(tx, {
      userId: input.headUserId,
      roleKey: input.type === 'owner_occupier' ? 'homeowner' : 'tenant',
      estateId: input.estateId,
      grantedBy: input.actorId,
      reason: `occupancy ${occupancy.id}`,
    });
    await appendOutboxEvents(tx, [
      {
        type: 'occupancy.occupancy.started',
        estateId: input.estateId,
        aggregateType: 'occupancy',
        aggregateId: occupancy.id,
        payload: {
          occupancyId: occupancy.id,
          householdId: household.id,
          spaceId: input.spaceId,
          type: input.type,
        },
        audit: {
          actorType: input.actorId ? 'user' : 'system',
          actorId: input.actorId,
          action: 'occupancy.occupancy.start',
          resourceType: 'occupancy',
          resourceId: occupancy.id,
          after: { spaceId: input.spaceId, type: input.type },
        },
      },
    ]);
    return { household, occupancy, unit };
  }

  /** Manager records an occupancy for someone by phone (they sign in later with that number). */
  async createOccupancy(access: EstateAccess, input: z.infer<typeof createOccupancySchema>) {
    const headUserId = await this.identity.findOrCreateByPhone(
      input.head.phone,
      input.head.fullName,
      access.userId,
    );
    const estate = await this.tenancy.getProfile(access);
    return this.db.withTenant(access, async (tx) => {
      const { household, unit } = await this.startOccupancy(tx, {
        estateId: access.estateId,
        spaceId: input.spaceId,
        headUserId,
        headName: input.head.fullName,
        type: input.type,
        startsOn: toDate(input.startsOn),
        endsOn: input.endsOn ? toDate(input.endsOn) : null,
        actorId: access.userId,
      });
      await this.notifications.request(tx, {
        intent: 'occupancy.added_to_household',
        userIds: [headUserId],
        estateId: access.estateId,
        data: { unitCode: unit.code, estateName: estate.name },
        dedupeKey: `household:${household.id}:added:${headUserId}`,
      });
      return this.householdView(tx, access.estateId, household.id);
    });
  }

  /**
   * Ends an occupancy (occupancy.md §5, the Phase 1 part): household ended, members leave, unit vacant,
   * resident roles revoked where the person has no other home in the estate. Visitor passes are revoked by
   * the visitor module on `occupancy.occupancy.ended`. History is kept.
   */
  /** Renews a lease: a new end date (occupancy.md §5, lease expiry). */
  async renewOccupancy(access: EstateAccess, occupancyId: string, endsOn: string) {
    return this.db.withTenant(access, async (tx) => {
      const occupancy = await tx.occupancy.findFirst({
        where: { id: occupancyId, estateId: access.estateId, status: 'active' },
      });
      if (!occupancy) throw new NotFoundError('Occupancy not found', 'OCCUPANCY_NOT_FOUND');
      if (endsOn <= occupancy.startsOn.toISOString().slice(0, 10))
        throw new DomainError(
          'OCCUPANCY_DATES_INVALID',
          'The new end date must be after the start',
          422,
        );
      await tx.occupancy.update({
        where: { id: occupancyId },
        data: { endsOn: new Date(`${endsOn}T00:00:00.000Z`) },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'occupancy.occupancy.renewed',
          estateId: access.estateId,
          aggregateType: 'occupancy',
          aggregateId: occupancyId,
          payload: { occupancyId, endsOn },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'occupancy.occupancy.renew',
            resourceType: 'occupancy',
            resourceId: occupancyId,
            before: { endsOn: occupancy.endsOn?.toISOString().slice(0, 10) ?? null },
            after: { endsOn },
          },
        },
      ]);
      return { id: occupancyId, endsOn };
    });
  }

  /** Ends an occupancy (manager now, or the move-out job with `userId: null`). */
  async endOccupancy(
    access: { estateId: string; userId: string | null },
    occupancyId: string,
    reason: string,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const occupancy = await tx.occupancy.findFirst({
        where: { id: occupancyId, estateId: access.estateId },
      });
      if (!occupancy) throw new NotFoundError('Occupancy not found', 'OCCUPANCY_NOT_FOUND');
      if (occupancy.status !== 'active') {
        throw new ConflictError('OCCUPANCY_NOT_ACTIVE', 'This occupancy has already ended');
      }
      const now = new Date();
      await tx.occupancy.update({
        where: { id: occupancy.id },
        data: {
          status: 'ended',
          endedAt: now,
          endedBy: access.userId,
          endsOn: occupancy.endsOn ?? now,
        },
      });
      await tx.household.update({
        where: { id: occupancy.householdId },
        data: { status: 'ended', endedAt: now },
      });
      const members = await tx.householdMember.findMany({
        where: { householdId: occupancy.householdId, status: 'active' },
      });
      await tx.householdMember.updateMany({
        where: { householdId: occupancy.householdId, status: 'active' },
        data: { status: 'removed', leftAt: now },
      });
      await tx.vehicle.updateMany({
        where: { householdId: occupancy.householdId, status: 'active' },
        data: { status: 'inactive' },
      });
      await tx.domesticStaff.updateMany({
        where: {
          householdId: occupancy.householdId,
          status: { in: ['pending', 'active', 'suspended'] },
        },
        data: { status: 'ended' },
      });
      await this.property.setUnitStatus(tx, access.estateId, occupancy.spaceId, 'vacant');
      for (const member of members) {
        if (member.userId)
          await this.releaseIfHomeless(tx, access.estateId, member.userId, access.userId);
      }
      await appendOutboxEvents(tx, [
        {
          type: 'occupancy.occupancy.ended',
          estateId: access.estateId,
          aggregateType: 'occupancy',
          aggregateId: occupancy.id,
          payload: {
            occupancyId: occupancy.id,
            householdId: occupancy.householdId,
            spaceId: occupancy.spaceId,
          },
          audit: {
            actorType: access.userId ? 'user' : 'system',
            actorId: access.userId,
            action: 'occupancy.occupancy.end',
            resourceType: 'occupancy',
            resourceId: occupancy.id,
            reason,
          },
        },
      ]);
      return { id: occupancy.id, status: 'ended' as const };
    });
  }

  // ---- Households and members ----------------------------------------------------------------

  /**
   * Owner mode (property.md rule 8): the caller's owned units and who lives there (household name and
   * occupancy type only, never contact details).
   */
  async ownedUnits(access: EstateAccess) {
    return this.db.withTenant(access, async (tx) => {
      const owned = await this.property.ownedUnits(tx, access.estateId, access.userId);
      const households = await tx.household.findMany({
        where: {
          estateId: access.estateId,
          status: 'active',
          spaceId: { in: owned.map((o) => o.ownership.spaceId) },
        },
        select: {
          spaceId: true,
          name: true,
          occupancies: { where: { status: 'active' }, select: { type: true }, take: 1 },
        },
      });
      const bySpace = new Map(households.map((household) => [household.spaceId, household]));
      return owned.map(({ ownership, space }) => {
        const household = bySpace.get(ownership.spaceId);
        return {
          ownershipId: ownership.id,
          spaceId: ownership.spaceId,
          unitCode: space?.code ?? '',
          unitName: space?.name ?? '',
          shareBasisPoints: ownership.shareBp,
          unitStatus: space?.status ?? null,
          household: household
            ? { name: household.name, occupancyType: household.occupancies[0]?.type ?? 'other' }
            : null,
        };
      });
    });
  }

  async myHouseholds(access: EstateAccess) {
    return this.db.withTenant(access, async (tx) => {
      const rows = await tx.householdMember.findMany({
        where: {
          estateId: access.estateId,
          userId: access.userId,
          status: 'active',
          household: { status: 'active' },
        },
        select: { householdId: true },
      });
      return Promise.all(
        rows.map((row) => this.householdView(tx, access.estateId, row.householdId)),
      );
    });
  }

  /** Members of the household, the head's view of it, or staff with resident.read. */
  async household(access: EstateAccess, householdId: string) {
    return this.db.withTenant(access, async (tx) => {
      const view = await this.householdView(tx, access.estateId, householdId);
      const member = view.members.some((m) => m.userId === access.userId);
      if (!member && !isStaffWith(access, 'resident.read')) {
        throw new NotFoundError('Household not found', 'HOUSEHOLD_NOT_FOUND');
      }
      return view;
    });
  }

  async addMember(
    access: EstateAccess,
    householdId: string,
    input: z.infer<typeof addHouseholdMemberSchema>,
  ) {
    const userId = input.phone
      ? await this.identity.findOrCreateByPhone(input.phone, input.fullName, access.userId)
      : null;
    const estate = await this.tenancy.getProfile(access);
    return this.db.withTenant(access, async (tx) => {
      const household = await this.manageableHousehold(tx, access, householdId);
      if (userId) {
        const existing = await tx.householdMember.count({
          where: { householdId, userId, status: 'active' },
        });
        if (existing > 0)
          throw new ConflictError('ALREADY_MEMBER', 'This person is already in the household');
      }
      const permissions = { ...defaultMemberPermissions(input.isMinor), ...input.permissions };
      const member = await tx.householdMember.create({
        data: {
          estateId: access.estateId,
          householdId,
          userId,
          fullName: input.fullName,
          relationship: input.relationship,
          isMinor: input.isMinor,
          permissions,
        },
      });
      if (userId) {
        await this.tenancy.ensureActiveMembership(tx, access.estateId, userId);
        await this.authz.assignBuiltInRole(tx, {
          userId,
          roleKey: 'household_member',
          estateId: access.estateId,
          grantedBy: access.userId,
          reason: `household ${householdId}`,
        });
        const unit = await this.property.unit(tx, access.estateId, household.spaceId);
        await this.notifications.request(tx, {
          intent: 'occupancy.added_to_household',
          userIds: [userId],
          estateId: access.estateId,
          data: { unitCode: unit?.code ?? '', estateName: estate.name },
          dedupeKey: `household:${householdId}:added:${userId}`,
        });
      }
      await appendOutboxEvents(tx, [
        {
          type: 'occupancy.member.added',
          estateId: access.estateId,
          aggregateType: 'household',
          aggregateId: householdId,
          payload: { householdId, memberId: member.id, userId },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'occupancy.member.add',
            resourceType: 'household_member',
            resourceId: member.id,
            after: { relationship: input.relationship, isMinor: input.isMinor },
          },
        },
      ]);
      return this.householdView(tx, access.estateId, householdId);
    });
  }

  async updateMember(
    access: EstateAccess,
    memberId: string,
    input: z.infer<typeof updateHouseholdMemberSchema>,
  ) {
    return this.db.withTenant(access, async (tx) => {
      const member = await this.activeMember(tx, access.estateId, memberId);
      await this.manageableHousehold(tx, access, member.householdId);
      if (member.relationship === 'head') {
        throw new DomainError(
          'HEAD_PERMISSIONS_FIXED',
          'The household head always has every permission',
          422,
        );
      }
      const permissions = { ...parsePermissions(member.permissions), ...input.permissions };
      await tx.householdMember.update({
        where: { id: member.id },
        data: { permissions, ...(input.relationship ? { relationship: input.relationship } : {}) },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'occupancy.member.updated',
          estateId: access.estateId,
          aggregateType: 'household',
          aggregateId: member.householdId,
          payload: { householdId: member.householdId, memberId },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'occupancy.member.update',
            resourceType: 'household_member',
            resourceId: memberId,
            before: {
              permissions: parsePermissions(member.permissions),
              relationship: member.relationship,
            } as unknown as Prisma.InputJsonValue,
            after: {
              permissions,
              relationship: input.relationship ?? member.relationship,
            } as unknown as Prisma.InputJsonValue,
          },
        },
      ]);
      return this.householdView(tx, access.estateId, member.householdId);
    });
  }

  async removeMember(access: EstateAccess, memberId: string) {
    return this.db.withTenant(access, async (tx) => {
      const member = await this.activeMember(tx, access.estateId, memberId);
      await this.manageableHousehold(tx, access, member.householdId);
      if (member.relationship === 'head') {
        throw new DomainError(
          'CANNOT_REMOVE_HEAD',
          'End the occupancy to remove the household head',
          422,
        );
      }
      await tx.householdMember.update({
        where: { id: member.id },
        data: { status: 'removed', leftAt: new Date() },
      });
      if (member.userId)
        await this.releaseIfHomeless(tx, access.estateId, member.userId, access.userId);
      await appendOutboxEvents(tx, [
        {
          type: 'occupancy.member.removed',
          estateId: access.estateId,
          aggregateType: 'household',
          aggregateId: member.householdId,
          payload: { householdId: member.householdId, memberId, userId: member.userId },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'occupancy.member.remove',
            resourceType: 'household_member',
            resourceId: memberId,
          },
        },
      ]);
      return this.householdView(tx, access.estateId, member.householdId);
    });
  }

  /** Estate-wide active households directory for staff (management-web.md §6.5). */
  async listHouseholds(
    access: EstateAccess,
    query: { q?: string; spaceId?: string; limit: number; cursor?: string },
  ) {
    const cursorSchema = z.object({ createdAt: z.iso.datetime(), id: z.uuid() });
    const after = query.cursor
      ? decodeCursor(
          query.cursor,
          (value): value is z.infer<typeof cursorSchema> => cursorSchema.safeParse(value).success,
        )
      : undefined;
    return this.db.withTenant(access, async (tx) => {
      const rows = await tx.household.findMany({
        where: {
          estateId: access.estateId,
          status: 'active',
          ...(query.spaceId ? { spaceId: query.spaceId } : {}),
          ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
          ...(after
            ? {
                OR: [
                  { createdAt: { lt: new Date(after.createdAt) } },
                  { createdAt: new Date(after.createdAt), id: { lt: after.id } },
                ],
              }
            : {}),
        },
        include: {
          occupancies: { where: { status: 'active' }, orderBy: { startsOn: 'desc' }, take: 1 },
          _count: { select: { members: { where: { status: 'active' } } } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      });
      const page = rows.slice(0, query.limit);
      const householdIds = page.map((r) => r.id);
      const [units, vehicles, domestic] = await Promise.all([
        this.property.spacesByIds(tx, access.estateId, [...new Set(page.map((r) => r.spaceId))]),
        householdIds.length > 0
          ? tx.vehicle.groupBy({
              by: ['householdId'],
              where: {
                estateId: access.estateId,
                householdId: { in: householdIds },
                status: 'active',
              },
              _count: { _all: true },
            })
          : [],
        householdIds.length > 0
          ? tx.domesticStaff.groupBy({
              by: ['householdId'],
              where: {
                estateId: access.estateId,
                householdId: { in: householdIds },
                status: 'active',
              },
              _count: { _all: true },
            })
          : [],
      ]);
      const unitById = new Map(units.map((u) => [u.id, u.code]));
      const vehicleCount = new Map(vehicles.map((v) => [v.householdId, v._count._all]));
      const domesticCount = new Map(domestic.map((d) => [d.householdId, d._count._all]));
      const last = page.at(-1);
      return {
        items: page.map((row) => {
          const occ = row.occupancies[0];
          return {
            id: row.id,
            name: row.name,
            spaceId: row.spaceId,
            unitCode: unitById.get(row.spaceId) ?? null,
            occupancyType: occ?.type ?? 'tenant',
            startsOn: occ?.startsOn ? occ.startsOn.toISOString().slice(0, 10) : null,
            endsOn: occ?.endsOn ? occ.endsOn.toISOString().slice(0, 10) : null,
            memberCount: row._count.members,
            vehicleCount: vehicleCount.get(row.id) ?? 0,
            domesticStaffCount: domesticCount.get(row.id) ?? 0,
          };
        }),
        nextCursor:
          rows.length > query.limit && last
            ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
            : null,
      };
    });
  }

  /** Resident directory for staff (occupancy.md §7). Phones are masked without pii.view. */
  async residents(access: EstateAccess, query: z.infer<typeof residentListQuerySchema>) {
    const after = query.cursor
      ? decodeCursor(
          query.cursor,
          (value): value is z.infer<typeof residentCursorSchema> =>
            residentCursorSchema.safeParse(value).success,
        )
      : undefined;
    const rows = await this.db.withTenant(access, (tx) =>
      tx.householdMember.findMany({
        where: {
          estateId: access.estateId,
          status: 'active',
          household: { status: 'active', ...(query.spaceId ? { spaceId: query.spaceId } : {}) },
          ...(query.q ? { fullName: { contains: query.q, mode: 'insensitive' } } : {}),
          ...(after
            ? {
                OR: [
                  { fullName: { gt: after.name } },
                  { fullName: after.name, id: { gt: after.id } },
                ],
              }
            : {}),
        },
        include: { household: { select: { id: true, spaceId: true } } },
        orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
        take: query.limit + 1,
      }),
    );
    const page = rows.slice(0, query.limit);
    const [contacts, units] = await Promise.all([
      this.identity.contactsOf(page.flatMap((row) => (row.userId ? [row.userId] : []))),
      this.db.withTenant(access, (tx) =>
        this.property.spacesByIds(
          tx,
          access.estateId,
          page.map((row) => row.household.spaceId),
        ),
      ),
    ]);
    const unitById = new Map(units.map((unit) => [unit.id, unit]));
    const showPhone = access.permissions.has('pii.view');
    const last = page.at(-1);
    return {
      items: page.map((row) => {
        const phone = row.userId ? (contacts.get(row.userId)?.phone ?? null) : null;
        return {
          userId: row.userId,
          memberId: row.id,
          fullName: row.fullName,
          phone: phone && !showPhone ? maskPhone(phone) : phone,
          relationship: row.relationship as 'head',
          householdId: row.household.id,
          unit: {
            id: row.household.spaceId,
            code: unitById.get(row.household.spaceId)?.code ?? '',
          },
        };
      }),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({ name: last.fullName, id: last.id })
          : null,
    };
  }

  // ---- Vehicles ------------------------------------------------------------------------------

  async vehicles(access: EstateAccess, householdId: string) {
    return this.db.withTenant(access, async (tx) => {
      await this.visibleHousehold(tx, access, householdId);
      const rows = await tx.vehicle.findMany({
        where: { estateId: access.estateId, householdId },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map(toVehicle);
    });
  }

  async addVehicle(access: EstateAccess, input: z.infer<typeof createVehicleSchema>) {
    const plate = normalisePlate(input.plate);
    if (plate.length < 3) throw new DomainError('PLATE_INVALID', 'Enter a valid plate number', 422);
    try {
      return await this.db.withTenant(access, async (tx) => {
        await this.visibleHousehold(tx, access, input.householdId, true);
        const row = await tx.vehicle.create({
          data: {
            estateId: access.estateId,
            householdId: input.householdId,
            plateNormalised: plate,
            plateDisplay: input.plate.toUpperCase(),
            make: input.make ?? null,
            model: input.model ?? null,
            colour: input.colour ?? null,
            tagNumber: input.tagNumber ?? null,
            createdBy: access.userId,
          },
        });
        await appendOutboxEvents(tx, [
          {
            type: 'occupancy.vehicle.registered',
            estateId: access.estateId,
            aggregateType: 'vehicle',
            aggregateId: row.id,
            payload: { vehicleId: row.id, householdId: input.householdId },
            audit: {
              actorType: 'user',
              actorId: access.userId,
              action: 'occupancy.vehicle.register',
              resourceType: 'vehicle',
              resourceId: row.id,
            },
          },
        ]);
        return toVehicle(row);
      });
    } catch (error) {
      if ((error as { code?: unknown }).code === 'P2002') {
        throw new ConflictError(
          'PLATE_REGISTERED',
          'This plate is already registered in the estate',
        );
      }
      throw error;
    }
  }

  // ---- Bulk import (tenancy.md §7.8) --------------------------------------------------------------

  private async importTarget(access: EstateAccess, unitCode: string) {
    const found = await this.db.withTenant(access, async (tx) => {
      const unit = await this.property.unitByCode(tx, access.estateId, unitCode);
      if (!unit) return null;
      return { unit, household: await this.activeHouseholdAt(tx, access.estateId, unit.id) };
    });
    if (!found) throw new NotFoundError(`Unit ${unitCode} not found`, 'SPACE_NOT_FOUND');
    return found;
  }

  /**
   * One resident row: starts an occupancy with them as head when the unit is empty, otherwise adds
   * them to the unit's household. Someone already in that household is unchanged.
   */
  async importResident(
    access: EstateAccess,
    row: {
      unitCode: string;
      fullName: string;
      phone: string;
      occupancyType: 'owner_occupier' | 'tenant' | 'other';
    },
  ): Promise<ImportOutcome> {
    const { unit, household } = await this.importTarget(access, row.unitCode);
    if (!household) {
      await this.createOccupancy(access, {
        spaceId: unit.id,
        type: row.occupancyType,
        head: { fullName: row.fullName, phone: row.phone },
      });
      return 'created';
    }
    const userId = await this.identity.findOrCreateByPhone(row.phone, row.fullName, access.userId);
    const already = await this.db.withTenant(access, (tx) =>
      tx.householdMember.count({
        where: { estateId: access.estateId, householdId: household.id, userId, status: 'active' },
      }),
    );
    if (already > 0) return 'unchanged';
    await this.addMember(access, household.id, {
      fullName: row.fullName,
      phone: row.phone,
      relationship: row.occupancyType === 'tenant' ? 'tenant_co_occupant' : 'other',
      isMinor: false,
    });
    return 'created';
  }

  /**
   * One household row: starts the occupancy when the unit is empty, or renames the household when the
   * same head already lives there. A unit with a different head is a conflict (use move-out first).
   */
  async importHousehold(
    access: EstateAccess,
    row: {
      unitCode: string;
      householdName: string;
      headName: string;
      headPhone: string;
      occupancyType: 'owner_occupier' | 'tenant' | 'other';
    },
  ): Promise<ImportOutcome> {
    const { unit, household } = await this.importTarget(access, row.unitCode);
    let target = household;
    let outcome: ImportOutcome = 'unchanged';
    if (!target) {
      const created = await this.createOccupancy(access, {
        spaceId: unit.id,
        type: row.occupancyType,
        head: { fullName: row.headName, phone: row.headPhone },
      });
      target = { id: created.id, name: created.name, headUserId: '' };
      outcome = 'created';
    } else {
      const headUserId = await this.identity.findOrCreateByPhone(
        row.headPhone,
        row.headName,
        access.userId,
      );
      if (target.headUserId !== headUserId) {
        throw new ConflictError(
          'UNIT_OCCUPIED',
          'This unit already has a household with a different head. Record the move-out first.',
        );
      }
    }
    if (target.name === row.householdName) return outcome;
    const householdId = target.id;
    const previousName = target.name;
    await this.db.withTenant(access, async (tx) => {
      await tx.household.update({ where: { id: householdId }, data: { name: row.householdName } });
      await appendOutboxEvents(tx, [
        {
          type: 'occupancy.household.renamed',
          estateId: access.estateId,
          aggregateType: 'household',
          aggregateId: householdId,
          payload: { householdId },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'occupancy.household.rename',
            resourceType: 'household',
            resourceId: householdId,
            before: { name: previousName },
            after: { name: row.householdName },
          },
        },
      ]);
    });
    return outcome === 'created' ? 'created' : 'updated';
  }

  /**
   * One vehicle row: registered to the unit's active household. A plate already registered to that
   * household is updated in place; a plate registered elsewhere in the estate is a conflict.
   */
  async importVehicle(
    access: EstateAccess,
    row: {
      unitCode: string;
      plate: string;
      make: string | null;
      model: string | null;
      colour: string | null;
    },
  ): Promise<ImportOutcome> {
    const { household } = await this.importTarget(access, row.unitCode);
    if (!household) {
      throw new DomainError(
        'HOUSEHOLD_REQUIRED',
        'This unit has no active household. Import residents or households first.',
        422,
      );
    }
    const plate = normalisePlate(row.plate);
    const existing = await this.db.withTenant(access, (tx) =>
      tx.vehicle.findFirst({
        where: { estateId: access.estateId, plateNormalised: plate, status: 'active' },
      }),
    );
    if (!existing) {
      await this.addVehicle(access, {
        householdId: household.id,
        plate: row.plate,
        ...(row.make ? { make: row.make } : {}),
        ...(row.model ? { model: row.model } : {}),
        ...(row.colour ? { colour: row.colour } : {}),
      });
      return 'created';
    }
    if (existing.householdId !== household.id) {
      throw new ConflictError('PLATE_REGISTERED', 'This plate is registered to another household');
    }
    const changes: Prisma.VehicleUpdateInput = {};
    if (row.make !== null && row.make !== existing.make) changes.make = row.make;
    if (row.model !== null && row.model !== existing.model) changes.model = row.model;
    if (row.colour !== null && row.colour !== existing.colour) changes.colour = row.colour;
    if (Object.keys(changes).length === 0) return 'unchanged';
    await this.db.withTenant(access, async (tx) => {
      await tx.vehicle.update({ where: { id: existing.id }, data: changes });
      await appendOutboxEvents(tx, [
        {
          type: 'occupancy.vehicle.updated',
          estateId: access.estateId,
          aggregateType: 'vehicle',
          aggregateId: existing.id,
          payload: { vehicleId: existing.id, householdId: household.id },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'occupancy.vehicle.update',
            resourceType: 'vehicle',
            resourceId: existing.id,
            after: changes as Prisma.InputJsonValue,
          },
        },
      ]);
    });
    return 'updated';
  }

  async deactivateVehicle(access: EstateAccess, vehicleId: string) {
    return this.db.withTenant(access, async (tx) => {
      const vehicle = await tx.vehicle.findFirst({
        where: { id: vehicleId, estateId: access.estateId },
      });
      if (!vehicle) throw new NotFoundError('Vehicle not found', 'VEHICLE_NOT_FOUND');
      await this.visibleHousehold(tx, access, vehicle.householdId, true);
      const row = await tx.vehicle.update({
        where: { id: vehicle.id },
        data: { status: 'inactive' },
      });
      await appendOutboxEvents(tx, [
        {
          type: 'occupancy.vehicle.deactivated',
          estateId: access.estateId,
          aggregateType: 'vehicle',
          aggregateId: row.id,
          payload: { vehicleId: row.id },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'occupancy.vehicle.deactivate',
            resourceType: 'vehicle',
            resourceId: row.id,
          },
        },
      ]);
      return toVehicle(row);
    });
  }

  /** Gate lookup: the minimum a guard needs (AGENTS.md §6.5). */
  async vehicleByPlate(context: TenantContext, plate: string) {
    return this.db.withTenant(context, async (tx) => {
      const vehicle = await tx.vehicle.findFirst({
        where: {
          estateId: context.estateId,
          plateNormalised: normalisePlate(plate),
          status: 'active',
        },
      });
      if (!vehicle) return null;
      const household = await tx.household.findUniqueOrThrow({
        where: { id: vehicle.householdId },
        select: { name: true, spaceId: true },
      });
      const unit = await this.property.unit(tx, context.estateId, household.spaceId);
      return {
        plate: vehicle.plateDisplay,
        make: vehicle.make,
        model: vehicle.model,
        colour: vehicle.colour,
        unitCode: unit?.code ?? '',
        householdName: household.name,
      };
    });
  }

  // ---- Domestic staff ------------------------------------------------------------------------

  async staff(access: EstateAccess, householdId: string | undefined, status: string | undefined) {
    return this.db.withTenant(access, async (tx) => {
      if (householdId) await this.visibleHousehold(tx, access, householdId);
      else if (!isStaffWith(access, 'resident.read')) throw new ForbiddenError();
      const rows = await tx.domesticStaff.findMany({
        where: {
          estateId: access.estateId,
          ...(householdId ? { householdId } : {}),
          ...(status ? { status } : {}),
        },
        orderBy: { createdAt: 'asc' },
        take: 200,
      });
      return rows.map(toStaff);
    });
  }

  /** Registered by the household head; needs manager approval when the estate says so (occupancy.md §6.5). */
  async addStaff(access: EstateAccess, input: z.infer<typeof createDomesticStaffSchema>) {
    const settings = await this.tenancy.getSettings(access);
    return this.db.withTenant(access, async (tx) => {
      await this.manageableHousehold(tx, access, input.householdId);
      const needsApproval =
        settings['staff_pass.requires_manager_approval'] &&
        !isStaffWith(access, 'resident.approve');
      const row = await tx.domesticStaff.create({
        data: {
          estateId: access.estateId,
          householdId: input.householdId,
          name: input.name,
          phone: input.phone ?? null,
          role: input.role,
          schedule: input.schedule,
          status: needsApproval ? 'pending' : 'active',
          approvedBy: needsApproval ? null : access.userId,
          createdBy: access.userId,
        },
      });
      await appendOutboxEvents(tx, [
        {
          type: needsApproval ? 'occupancy.staff.registered' : 'occupancy.staff.approved',
          estateId: access.estateId,
          aggregateType: 'domestic_staff',
          aggregateId: row.id,
          payload: { staffId: row.id, householdId: input.householdId },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'occupancy.staff.register',
            resourceType: 'domestic_staff',
            resourceId: row.id,
          },
        },
      ]);
      return toStaff(row);
    });
  }

  /** Approve (pending → active), suspend or end. Managers approve; heads may suspend or end their own. */
  async setStaffStatus(
    access: EstateAccess,
    staffId: string,
    status: 'active' | 'suspended' | 'ended',
  ) {
    return this.db.withTenant(access, async (tx) => {
      const row = await tx.domesticStaff.findFirst({
        where: { id: staffId, estateId: access.estateId },
      });
      if (!row) throw new NotFoundError('Staff record not found', 'STAFF_NOT_FOUND');
      if (row.status === 'ended')
        throw new ConflictError('STAFF_ENDED', 'This staff pass has ended');
      const manager = isStaffWith(access, 'resident.approve');
      if (!manager) {
        await this.manageableHousehold(tx, access, row.householdId);
        if (status === 'active' && row.status === 'pending') {
          throw new ForbiddenError('A manager must approve this staff member');
        }
      }
      const updated = await tx.domesticStaff.update({
        where: { id: row.id },
        data: {
          status,
          ...(status === 'active' && row.status === 'pending' ? { approvedBy: access.userId } : {}),
        },
      });
      await appendOutboxEvents(tx, [
        {
          type: `occupancy.staff.${status === 'active' ? 'approved' : status}`,
          estateId: access.estateId,
          aggregateType: 'domestic_staff',
          aggregateId: row.id,
          payload: { staffId: row.id, householdId: row.householdId, status },
          audit: {
            actorType: 'user',
            actorId: access.userId,
            action: 'occupancy.staff.status',
            resourceType: 'domestic_staff',
            resourceId: row.id,
            before: { status: row.status },
            after: { status },
          },
        },
      ]);
      return toStaff(updated);
    });
  }

  /** Active staff of a household (visitor module issues their long-term passes). */
  async activeStaff(tx: Tx, estateId: string, staffId: string): Promise<StaffRow | null> {
    return tx.domesticStaff.findFirst({ where: { id: staffId, estateId, status: 'active' } });
  }

  // ---- Emergency contacts (user-level) -------------------------------------------------------

  async emergencyContacts(userId: string) {
    const rows = await this.db.withUser(userId, (tx) =>
      tx.emergencyContact.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    );
    return rows.map(toContact);
  }

  async addEmergencyContact(userId: string, input: z.infer<typeof createEmergencyContactSchema>) {
    return this.db.withUser(userId, async (tx) => {
      const count = await tx.emergencyContact.count({ where: { userId } });
      if (count >= MAX_EMERGENCY_CONTACTS) {
        throw new DomainError(
          'TOO_MANY_CONTACTS',
          `At most ${MAX_EMERGENCY_CONTACTS} emergency contacts`,
          422,
        );
      }
      const row = await tx.emergencyContact.create({
        data: {
          userId,
          name: input.name,
          phone: input.phone,
          relationship: input.relationship,
          consentConfirmedAt: new Date(),
        },
      });
      return toContact(row);
    });
  }

  async removeEmergencyContact(userId: string, contactId: string) {
    const removed = await this.db.withUser(userId, (tx) =>
      tx.emergencyContact.deleteMany({ where: { id: contactId, userId } }),
    );
    if (removed.count === 0) throw new NotFoundError('Contact not found', 'CONTACT_NOT_FOUND');
  }

  // ---- Internals -----------------------------------------------------------------------------

  /** Revokes resident roles and the membership when the user no longer lives anywhere in the estate. */
  private async releaseIfHomeless(
    tx: Tx,
    estateId: string,
    userId: string,
    actorId: string | null,
  ) {
    const remaining = await tx.householdMember.count({
      where: { estateId, userId, status: 'active', household: { status: 'active' } },
    });
    if (remaining > 0) return;
    for (const roleKey of RESIDENT_ROLE_KEYS) {
      await this.authz.revokeBuiltInRole(tx, { userId, roleKey, estateId, revokedBy: actorId });
    }
    if ((await this.authz.countEstateRoles(tx, userId, estateId)) === 0) {
      await this.tenancy.endMembership(tx, estateId, userId);
    }
  }

  private async householdView(tx: Tx, estateId: string, householdId: string) {
    const row: HouseholdRow | null = await tx.household.findFirst({
      where: { id: householdId, estateId },
      include: {
        members: { where: { status: 'active' }, orderBy: { joinedAt: 'asc' } },
        occupancies: { where: { status: 'active' } },
      },
    });
    if (!row) throw new NotFoundError('Household not found', 'HOUSEHOLD_NOT_FOUND');
    const [unit] = await this.property.spacesByIds(tx, estateId, [row.spaceId]);
    const occupancy = row.occupancies[0];
    return {
      id: row.id,
      name: row.name,
      status: row.status as 'active' | 'ended',
      headUserId: row.headUserId,
      unit: unit ?? { id: row.spaceId, code: '', name: '' },
      occupancy: occupancy
        ? {
            id: occupancy.id,
            type: occupancy.type as 'owner_occupier' | 'tenant' | 'other',
            startsOn: occupancy.startsOn.toISOString().slice(0, 10),
            endsOn: occupancy.endsOn?.toISOString().slice(0, 10) ?? null,
          }
        : null,
      members: row.members.map((member) => ({
        id: member.id,
        userId: member.userId,
        fullName: member.fullName,
        relationship: member.relationship as 'head',
        isMinor: member.isMinor,
        permissions: parsePermissions(member.permissions),
        joinedAt: member.joinedAt.toISOString(),
      })),
    };
  }

  /** The household head, or staff with household.manage-equivalent rights (resident.approve), may change it. */
  private async manageableHousehold(tx: Tx, access: EstateAccess, householdId: string) {
    const household = await tx.household.findFirst({
      where: { id: householdId, estateId: access.estateId, status: 'active' },
    });
    if (!household) throw new NotFoundError('Household not found', 'HOUSEHOLD_NOT_FOUND');
    if (household.headUserId !== access.userId && !isStaffWith(access, 'resident.approve')) {
      const member = await tx.householdMember.count({
        where: { householdId, userId: access.userId, status: 'active' },
      });
      if (member === 0) throw new NotFoundError('Household not found', 'HOUSEHOLD_NOT_FOUND');
      throw new ForbiddenError('Only the household head can do this', 'NOT_HOUSEHOLD_HEAD');
    }
    return household;
  }

  /** Members see their household; `write` lets any active member register (e.g. their own car). */
  private async visibleHousehold(tx: Tx, access: EstateAccess, householdId: string, write = false) {
    const household = await tx.household.findFirst({
      where: { id: householdId, estateId: access.estateId, ...(write ? { status: 'active' } : {}) },
    });
    if (!household) throw new NotFoundError('Household not found', 'HOUSEHOLD_NOT_FOUND');
    const staffPermission = write ? 'resident.approve' : 'resident.read';
    if (isStaffWith(access, staffPermission)) return household;
    const member = await tx.householdMember.count({
      where: { householdId, userId: access.userId, status: 'active' },
    });
    if (member === 0) throw new NotFoundError('Household not found', 'HOUSEHOLD_NOT_FOUND');
    return household;
  }

  private async activeMember(tx: Tx, estateId: string, memberId: string) {
    const member = await tx.householdMember.findFirst({
      where: { id: memberId, estateId, status: 'active' },
    });
    if (!member) throw new NotFoundError('Member not found', 'MEMBER_NOT_FOUND');
    return member;
  }

  // ---- Reads for other modules (search, reports), inside the caller's tenant transaction ----------

  /** Active household members whose name contains `q` (global search). */
  async searchMembers(tx: Tx, estateId: string, q: string, take: number) {
    const rows = await tx.householdMember.findMany({
      where: { estateId, status: 'active', fullName: { contains: q, mode: 'insensitive' } },
      select: { id: true, fullName: true, household: { select: { name: true } } },
      take,
      orderBy: { fullName: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      fullName: row.fullName,
      householdName: row.household.name,
    }));
  }

  /** Active vehicles whose plate matches `q`, normalised or as displayed (global search). */
  async searchVehicles(tx: Tx, estateId: string, q: string, take: number) {
    return tx.vehicle.findMany({
      where: {
        estateId,
        status: 'active',
        OR: [
          { plateNormalised: { contains: q.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() } },
          { plateDisplay: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: { id: true, plateDisplay: true, make: true, model: true, colour: true },
      take,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Active households and active residents (estate reports). */
  async residencyCounts(
    tx: Tx,
    estateId: string,
  ): Promise<{ activeHouseholds: number; activeResidents: number }> {
    const [activeHouseholds, activeResidents] = await Promise.all([
      tx.household.count({ where: { estateId, status: 'active' } }),
      tx.householdMember.count({ where: { estateId, status: 'active' } }),
    ]);
    return { activeHouseholds, activeResidents };
  }
}

function toVehicle(row: VehicleRow) {
  return {
    id: row.id,
    householdId: row.householdId,
    plate: row.plateDisplay,
    make: row.make,
    model: row.model,
    colour: row.colour,
    tagNumber: row.tagNumber,
    status: row.status as 'active' | 'inactive',
  };
}

function toStaff(row: StaffRow) {
  return {
    id: row.id,
    householdId: row.householdId,
    name: row.name,
    phone: row.phone,
    role: row.role as 'cleaner',
    schedule: row.schedule as { days: number[]; from: string; to: string },
    status: row.status as 'pending' | 'active' | 'suspended' | 'ended',
  };
}

function toContact(row: Prisma.EmergencyContactGetPayload<object>) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    relationship: row.relationship,
    consentConfirmedAt: row.consentConfirmedAt.toISOString(),
  };
}
