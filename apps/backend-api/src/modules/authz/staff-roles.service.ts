import { Injectable } from '@nestjs/common';
import {
  BUILT_IN_ROLES,
  getRole,
  PERMISSIONS,
  type Permission,
  RESIDENT_ROLE_KEYS,
} from '@safezone/permissions';
import type {
  assignStaffRoleSchema,
  createEstateRoleSchema,
  inviteStaffSchema,
  staffListQuerySchema,
  updateEstateRoleSchema,
  updateStaffStatusSchema,
} from '@safezone/schemas';
import { z } from 'zod';
import type { EstateAccess } from '../../common/auth/auth.decorators';
import { DatabaseService } from '../../common/database/database.service';
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
} from '../../common/errors/domain-error';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { maskString } from '../../common/observability/redact';

const staffCursorSchema = z.object({ joinedAt: z.iso.datetime(), userId: z.uuid() });

/**
 * Permissions an estate role may carry: exactly those some built-in estate role carries. Platform,
 * advertising and vendor-approval permissions are never estate permissions, so a new platform permission
 * can never become grantable by accident.
 */
const ESTATE_ROLE_PERMISSIONS: ReadonlySet<string> = new Set(
  BUILT_IN_ROLES.filter((role) => role.level === 'estate')
    .flatMap((role) => role.permissions)
    .filter(
      (permission) =>
        !permission.startsWith('platform.') &&
        !permission.startsWith('ad.') &&
        permission !== 'vendor.approve',
    ),
);

/** Resident and owner roles come from occupancy and ownership records, never from staff management. */
function isResidentRole(key: string): boolean {
  return RESIDENT_ROLE_KEYS.includes(key);
}

/** The permissions a role grants: built-in roles from the catalogue, custom roles from their rows. */
function permissionsOfRole(role: {
  key: string;
  isBuiltin: boolean;
  permissions?: readonly { permission: string }[];
}): readonly string[] {
  if (role.isBuiltin) return getRole(role.key)?.permissions ?? [];
  return (role.permissions ?? []).map((row) => row.permission);
}

/** Permissions that make a role a management role: whoever holds them can reshape the estate's access. */
const MANAGEMENT_PERMISSIONS: readonly string[] = ['role.assign', 'estate.configure'];

/**
 * No privilege escalation (authz.md §7.2, §8 "cannot grant above own level"). Custom roles, and built-in
 * management roles, can only be granted, changed or revoked by someone who holds every permission in
 * them. Built-in operational roles (guards, accountants, facility staff) are curated in
 * @safezone/permissions and may be assigned by any `role.assign` holder, so administrators can staff the
 * estate without holding gate or billing permissions themselves (separation of duties).
 */
function assertCanGrant(
  access: EstateAccess,
  role: { key: string; isBuiltin: boolean; permissions?: readonly { permission: string }[] },
): void {
  const permissions = permissionsOfRole(role);
  const management = permissions.some((permission) => MANAGEMENT_PERMISSIONS.includes(permission));
  if (role.isBuiltin && !management) return;
  assertHolds(access, permissions);
}

/** The caller holds every one of these permissions in this estate. */
function assertHolds(access: EstateAccess, permissions: readonly string[]): void {
  const missing = permissions.filter((permission) => !access.permissions.has(permission));
  if (missing.length > 0) {
    throw new ForbiddenError(
      'You can only grant or change permissions that you hold yourself',
      'PERMISSION_NOT_HELD',
    );
  }
}

function slugifyRoleKey(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return `custom_${base || 'role'}`;
}

function validateEstatePermissions(permissions: readonly string[]): Permission[] {
  const unique = [...new Set(permissions)];
  for (const perm of unique) {
    if (!(perm in PERMISSIONS) || !ESTATE_ROLE_PERMISSIONS.has(perm)) {
      throw new DomainError(
        'PERMISSION_NOT_ASSIGNABLE',
        `Permission "${perm}" cannot be granted to an estate role`,
        422,
      );
    }
  }
  return unique as Permission[];
}

function formatPhone(phone: string, canViewPii: boolean): string {
  return canViewPii ? phone : maskString(phone);
}

/**
 * Estate-level non-security staff directory and custom role management (management-web.md §6.5).
 * Enforces permission boundaries, prevents self-suspension or removing the last Estate Owner,
 * and audits every role or membership status change.
 */
@Injectable()
export class StaffRolesService {
  constructor(private readonly db: DatabaseService) {}

  // ---- Roles ---------------------------------------------------------------------------------

  async listRoles(access: EstateAccess) {
    const customRows = await this.db.withContext(
      'authz',
      (tx) =>
        tx.role.findMany({
          where: { estateId: access.estateId, isBuiltin: false },
          include: { permissions: true },
          orderBy: { name: 'asc' },
        }),
      { userId: access.userId, estateId: access.estateId },
    );

    const builtins = BUILT_IN_ROLES.filter((role) => role.level === 'estate').map((role) => ({
      id: null as string | null,
      key: role.key,
      name: role.name,
      isBuiltin: true,
      permissions: [...role.permissions],
    }));

    const customs = customRows.map((row) => ({
      id: row.id,
      key: row.key,
      name: row.name,
      isBuiltin: false,
      permissions: row.permissions.map((p) => p.permission).sort(),
    }));

    return [...builtins, ...customs];
  }

  async createRole(access: EstateAccess, input: z.infer<typeof createEstateRoleSchema>) {
    const permissions = validateEstatePermissions(input.permissions);
    assertHolds(access, permissions);
    const key = slugifyRoleKey(input.name);

    return this.db.withContext(
      'authz',
      async (tx) => {
        const existing = await tx.role.findFirst({
          where: { estateId: access.estateId, key },
          select: { id: true },
        });
        if (existing) {
          throw new ConflictError(
            'ROLE_EXISTS',
            'A custom role with a similar name already exists',
          );
        }
        const role = await tx.role.create({
          data: {
            level: 'estate',
            key,
            name: input.name,
            isBuiltin: false,
            estateId: access.estateId,
            permissions: {
              createMany: {
                data: permissions.map((permission) => ({ permission })),
              },
            },
          },
          include: { permissions: true },
        });
        await appendOutboxEvents(tx, [
          {
            type: 'authz.role.created',
            estateId: access.estateId,
            aggregateType: 'role',
            aggregateId: role.id,
            payload: { roleId: role.id, key: role.key, permissions },
            audit: {
              actorType: 'user',
              actorId: access.userId,
              action: 'authz.role.create',
              resourceType: 'role',
              resourceId: role.id,
            },
          },
        ]);
        return {
          id: role.id,
          key: role.key,
          name: role.name,
          isBuiltin: false,
          permissions: role.permissions.map((p) => p.permission).sort(),
        };
      },
      { userId: access.userId, estateId: access.estateId },
    );
  }

  async updateRole(
    access: EstateAccess,
    roleId: string,
    input: z.infer<typeof updateEstateRoleSchema>,
  ) {
    const permissions =
      input.permissions !== undefined ? validateEstatePermissions(input.permissions) : undefined;
    if (permissions) assertHolds(access, permissions);

    return this.db.withContext(
      'authz',
      async (tx) => {
        const existing = await tx.role.findFirst({
          where: { id: roleId, estateId: access.estateId, isBuiltin: false },
          include: { permissions: true },
        });
        if (!existing) throw new NotFoundError('Custom role not found', 'ROLE_NOT_FOUND');
        assertCanGrant(access, existing);

        if (input.name !== undefined) {
          await tx.role.update({
            where: { id: existing.id },
            data: { name: input.name },
          });
        }
        if (permissions !== undefined) {
          await tx.rolePermission.deleteMany({ where: { roleId: existing.id } });
          await tx.rolePermission.createMany({
            data: permissions.map((permission) => ({ roleId: existing.id, permission })),
          });
        }
        const updated = await tx.role.findUniqueOrThrow({
          where: { id: existing.id },
          include: { permissions: true },
        });
        await appendOutboxEvents(tx, [
          {
            type: 'authz.role.updated',
            estateId: access.estateId,
            aggregateType: 'role',
            aggregateId: updated.id,
            payload: { roleId: updated.id, name: updated.name },
            audit: {
              actorType: 'user',
              actorId: access.userId,
              action: 'authz.role.update',
              resourceType: 'role',
              resourceId: updated.id,
            },
          },
        ]);
        return {
          id: updated.id,
          key: updated.key,
          name: updated.name,
          isBuiltin: false,
          permissions: updated.permissions.map((p) => p.permission).sort(),
        };
      },
      { userId: access.userId, estateId: access.estateId },
    );
  }

  async deleteRole(access: EstateAccess, roleId: string): Promise<void> {
    await this.db.withContext(
      'authz',
      async (tx) => {
        const existing = await tx.role.findFirst({
          where: { id: roleId, estateId: access.estateId, isBuiltin: false },
        });
        if (!existing) throw new NotFoundError('Custom role not found', 'ROLE_NOT_FOUND');

        const activeCount = await tx.roleAssignment.count({
          where: { roleId: existing.id, revokedAt: null },
        });
        if (activeCount > 0) {
          throw new ConflictError(
            'ROLE_IN_USE',
            'Revoke this role from all staff members before deleting it',
          );
        }
        await tx.rolePermission.deleteMany({ where: { roleId: existing.id } });
        await tx.role.delete({ where: { id: existing.id } });
        await appendOutboxEvents(tx, [
          {
            type: 'authz.role.deleted',
            estateId: access.estateId,
            aggregateType: 'role',
            aggregateId: existing.id,
            payload: { roleId: existing.id, key: existing.key },
            audit: {
              actorType: 'user',
              actorId: access.userId,
              action: 'authz.role.delete',
              resourceType: 'role',
              resourceId: existing.id,
            },
          },
        ]);
      },
      { userId: access.userId, estateId: access.estateId },
    );
  }

  // ---- Staff ---------------------------------------------------------------------------------

  async listStaff(access: EstateAccess, query: z.infer<typeof staffListQuerySchema>) {
    const after = query.cursor
      ? decodeCursor(
          query.cursor,
          (value): value is z.infer<typeof staffCursorSchema> =>
            staffCursorSchema.safeParse(value).success,
        )
      : undefined;
    const now = new Date();
    const canViewPii = access.permissions.has('pii.view');

    const assignments = await this.db.withContext(
      'authz',
      (tx) =>
        tx.roleAssignment.findMany({
          where: {
            estateId: access.estateId,
            revokedAt: null,
            OR: [{ validTo: null }, { validTo: { gt: now } }],
            role: {
              key: query.roleKey ? query.roleKey : { notIn: [...RESIDENT_ROLE_KEYS] },
            },
          },
          include: { role: true },
          orderBy: { grantedAt: 'asc' },
        }),
      { userId: access.userId, estateId: access.estateId },
    );

    const byUser = new Map<string, typeof assignments>();
    for (const row of assignments) {
      const list = byUser.get(row.userId) ?? [];
      list.push(row);
      byUser.set(row.userId, list);
    }

    const staffUserIds = [...byUser.keys()];
    if (staffUserIds.length === 0) return { items: [], nextCursor: null };

    const memberships = await this.db.withContext(
      'tenancy',
      (tx) =>
        tx.estateMembership.findMany({
          where: {
            estateId: access.estateId,
            userId: { in: staffUserIds },
            ...(query.status ? { status: query.status } : {}),
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
          take: query.q ? 500 : query.limit + 1,
        }),
      { userId: access.userId, estateId: access.estateId },
    );

    const users = await this.db.withContext(
      'identity',
      (tx) =>
        tx.user.findMany({
          where: { id: { in: memberships.map((m) => m.userId) } },
          select: { id: true, fullName: true, phoneE164: true, email: true },
        }),
      { userId: access.userId, estateId: access.estateId },
    );
    const userById = new Map(users.map((u) => [u.id, u]));

    const q = query.q?.toLowerCase();
    const filtered = memberships.filter((m) => {
      if (!q) return true;
      const u = userById.get(m.userId);
      return (
        u?.fullName?.toLowerCase().includes(q) ||
        u?.phoneE164.toLowerCase().includes(q) ||
        u?.email?.toLowerCase().includes(q)
      );
    });

    const page = filtered.slice(0, query.limit);
    const last = page.at(-1);

    return {
      items: page.map((m) => {
        const u = userById.get(m.userId);
        return {
          userId: m.userId,
          fullName: u?.fullName ?? null,
          phone: u ? formatPhone(u.phoneE164, canViewPii) : '-',
          email: u?.email ?? null,
          status: m.status as 'active' | 'suspended' | 'pending' | 'left',
          joinedAt: m.joinedAt.toISOString(),
          assignments: (byUser.get(m.userId) ?? []).map((a) => ({
            id: a.id,
            roleKey: a.role.key,
            roleName: a.role.name,
            validFrom: a.validFrom.toISOString(),
            validTo: a.validTo?.toISOString() ?? null,
          })),
        };
      }),
      nextCursor:
        filtered.length > query.limit && last
          ? encodeCursor({ joinedAt: last.joinedAt.toISOString(), userId: last.userId })
          : null,
    };
  }

  async inviteStaff(access: EstateAccess, input: z.infer<typeof inviteStaffSchema>) {
    // 1. Find or create user in identity context
    const user = await this.db.withContext(
      'identity',
      async (tx) => {
        const existing = await tx.user.findUnique({ where: { phoneE164: input.phone } });
        if (existing) {
          if (!existing.fullName && input.fullName) {
            return tx.user.update({
              where: { id: existing.id },
              data: { fullName: input.fullName, ...(input.email ? { email: input.email } : {}) },
            });
          }
          return existing;
        }
        return tx.user.create({
          data: {
            phoneE164: input.phone,
            fullName: input.fullName,
            email: input.email ?? null,
          },
        });
      },
      { userId: access.userId, estateId: access.estateId },
    );

    if (user.id === access.userId) {
      throw new ForbiddenError('You cannot change your own roles', 'CANNOT_ASSIGN_SELF');
    }

    // 2. Ensure active estate membership
    const membership = await this.db.withContext(
      'tenancy',
      async (tx) => {
        const existing = await tx.estateMembership.findFirst({
          where: { userId: user.id, estateId: access.estateId },
        });
        if (existing) {
          if (existing.status !== 'active') {
            return tx.estateMembership.update({
              where: { id: existing.id },
              data: { status: 'active' },
            });
          }
          return existing;
        }
        return tx.estateMembership.create({
          data: { userId: user.id, estateId: access.estateId, status: 'active' },
        });
      },
      { userId: access.userId, estateId: access.estateId },
    );

    // 3. Assign requested estate roles
    const assignments = await this.db.withContext(
      'authz',
      async (tx) => {
        const validTo = input.validTo ? new Date(input.validTo) : null;
        for (const roleKey of [...new Set(input.roleKeys)]) {
          const role = await tx.role.findFirst({
            where: {
              key: roleKey,
              level: 'estate',
              OR: [{ estateId: null, isBuiltin: true }, { estateId: access.estateId }],
            },
            include: { permissions: true },
          });
          if (!role || isResidentRole(role.key)) {
            throw new DomainError('ROLE_NOT_FOUND', `Role "${roleKey}" not found`, 422);
          }
          assertCanGrant(access, role);
          const existing = await tx.roleAssignment.findFirst({
            where: { userId: user.id, roleId: role.id, estateId: access.estateId, revokedAt: null },
          });
          if (!existing) {
            await tx.roleAssignment.create({
              data: {
                userId: user.id,
                roleId: role.id,
                estateId: access.estateId,
                validTo,
                grantedBy: access.userId,
                reason: 'Staff invitation',
              },
            });
          }
        }
        await appendOutboxEvents(tx, [
          {
            type: 'authz.staff.invited',
            estateId: access.estateId,
            aggregateType: 'estate_membership',
            aggregateId: user.id,
            payload: { userId: user.id, roleKeys: input.roleKeys },
            audit: {
              actorType: 'user',
              actorId: access.userId,
              action: 'authz.staff.invite',
              resourceType: 'user',
              resourceId: user.id,
            },
          },
        ]);
        return tx.roleAssignment.findMany({
          where: { userId: user.id, estateId: access.estateId, revokedAt: null },
          include: { role: true },
        });
      },
      { userId: access.userId, estateId: access.estateId },
    );

    const canViewPii = access.permissions.has('pii.view');
    return {
      userId: user.id,
      fullName: user.fullName,
      phone: formatPhone(user.phoneE164, canViewPii),
      email: user.email,
      status: membership.status as 'active',
      joinedAt: membership.joinedAt.toISOString(),
      assignments: assignments.map((a) => ({
        id: a.id,
        roleKey: a.role.key,
        roleName: a.role.name,
        validFrom: a.validFrom.toISOString(),
        validTo: a.validTo?.toISOString() ?? null,
      })),
    };
  }

  async assignRole(
    access: EstateAccess,
    targetUserId: string,
    input: z.infer<typeof assignStaffRoleSchema>,
  ) {
    if (targetUserId === access.userId) {
      throw new ForbiddenError('You cannot change your own roles', 'CANNOT_ASSIGN_SELF');
    }
    return this.db.withContext(
      'authz',
      async (tx) => {
        const role = await tx.role.findFirst({
          where: {
            key: input.roleKey,
            level: 'estate',
            OR: [{ estateId: null, isBuiltin: true }, { estateId: access.estateId }],
          },
          include: { permissions: true },
        });
        if (!role || isResidentRole(role.key)) {
          throw new DomainError('ROLE_NOT_FOUND', 'Role not found', 404);
        }
        assertCanGrant(access, role);

        const existing = await tx.roleAssignment.findFirst({
          where: {
            userId: targetUserId,
            roleId: role.id,
            estateId: access.estateId,
            revokedAt: null,
          },
          include: { role: true },
        });
        if (existing) {
          return {
            id: existing.id,
            roleKey: existing.role.key,
            roleName: existing.role.name,
            validFrom: existing.validFrom.toISOString(),
            validTo: existing.validTo?.toISOString() ?? null,
          };
        }

        const created = await tx.roleAssignment.create({
          data: {
            userId: targetUserId,
            roleId: role.id,
            estateId: access.estateId,
            validTo: input.validTo ? new Date(input.validTo) : null,
            grantedBy: access.userId,
            reason: input.reason ?? 'Assigned by estate administrator',
          },
          include: { role: true },
        });
        await appendOutboxEvents(tx, [
          {
            type: 'authz.role.assigned',
            estateId: access.estateId,
            aggregateType: 'role_assignment',
            aggregateId: created.id,
            payload: { userId: targetUserId, roleKey: role.key, validTo: input.validTo ?? null },
            audit: {
              actorType: 'user',
              actorId: access.userId,
              action: 'authz.role.assign',
              resourceType: 'role_assignment',
              resourceId: created.id,
              reason: input.reason ?? null,
            },
          },
        ]);
        return {
          id: created.id,
          roleKey: created.role.key,
          roleName: created.role.name,
          validFrom: created.validFrom.toISOString(),
          validTo: created.validTo?.toISOString() ?? null,
        };
      },
      { userId: access.userId, estateId: access.estateId },
    );
  }

  async revokeRole(
    access: EstateAccess,
    targetUserId: string,
    assignmentId: string,
  ): Promise<void> {
    if (targetUserId === access.userId) {
      throw new ForbiddenError('You cannot change your own roles', 'CANNOT_ASSIGN_SELF');
    }
    await this.db.withContext(
      'authz',
      async (tx) => {
        const assignment = await tx.roleAssignment.findFirst({
          where: {
            id: assignmentId,
            userId: targetUserId,
            estateId: access.estateId,
            revokedAt: null,
          },
          include: { role: { include: { permissions: true } } },
        });
        if (!assignment || isResidentRole(assignment.role.key)) {
          throw new NotFoundError('Role assignment not found', 'ASSIGNMENT_NOT_FOUND');
        }
        assertCanGrant(access, assignment.role);
        if (assignment.role.key === 'estate_owner') {
          const ownerCount = await tx.roleAssignment.count({
            where: {
              estateId: access.estateId,
              revokedAt: null,
              role: { key: 'estate_owner' },
            },
          });
          if (ownerCount <= 1) {
            throw new ConflictError(
              'LAST_ESTATE_OWNER',
              'Cannot revoke the last Estate Owner role',
            );
          }
        }
        await tx.roleAssignment.update({
          where: { id: assignment.id },
          data: { revokedAt: new Date(), revokedBy: access.userId },
        });
        await appendOutboxEvents(tx, [
          {
            type: 'authz.role.revoked',
            estateId: access.estateId,
            aggregateType: 'role_assignment',
            aggregateId: assignment.id,
            payload: { userId: targetUserId, roleKey: assignment.role.key },
            audit: {
              actorType: 'user',
              actorId: access.userId,
              action: 'authz.role.revoke',
              resourceType: 'role_assignment',
              resourceId: assignment.id,
            },
          },
        ]);
      },
      { userId: access.userId, estateId: access.estateId },
    );
  }

  async updateStaffStatus(
    access: EstateAccess,
    targetUserId: string,
    input: z.infer<typeof updateStaffStatusSchema>,
  ) {
    if (targetUserId === access.userId && input.status === 'suspended') {
      throw new ConflictError('CANNOT_SUSPEND_SELF', 'You cannot suspend your own account');
    }
    const targetRoles = await this.db.withContext(
      'authz',
      (tx) =>
        tx.roleAssignment.findMany({
          where: { userId: targetUserId, estateId: access.estateId, revokedAt: null },
          include: { role: { include: { permissions: true } } },
        }),
      { userId: access.userId, estateId: access.estateId },
    );
    for (const assignment of targetRoles) {
      if (!isResidentRole(assignment.role.key)) assertCanGrant(access, assignment.role);
    }
    if (input.status === 'suspended') {
      const owners = await this.db.withContext(
        'authz',
        (tx) =>
          tx.roleAssignment.findMany({
            where: { estateId: access.estateId, revokedAt: null, role: { key: 'estate_owner' } },
            select: { userId: true },
          }),
        { userId: access.userId, estateId: access.estateId },
      );
      if (owners.length === 1 && owners[0]?.userId === targetUserId) {
        throw new ConflictError('LAST_ESTATE_OWNER', 'Cannot suspend the last Estate Owner');
      }
    }

    return this.db.withContext(
      'tenancy',
      async (tx) => {
        const existing = await tx.estateMembership.findFirst({
          where: { userId: targetUserId, estateId: access.estateId },
        });
        if (!existing) throw new NotFoundError('Staff member not found', 'STAFF_NOT_FOUND');
        const updated = await tx.estateMembership.update({
          where: { id: existing.id },
          data: { status: input.status },
        });
        await appendOutboxEvents(tx, [
          {
            type: `tenancy.staff.${input.status}`,
            estateId: access.estateId,
            aggregateType: 'estate_membership',
            aggregateId: targetUserId,
            payload: { userId: targetUserId, status: input.status },
            audit: {
              actorType: 'user',
              actorId: access.userId,
              action: `tenancy.staff.${input.status}`,
              resourceType: 'user',
              resourceId: targetUserId,
              reason: input.reason,
            },
          },
        ]);
        return { userId: updated.userId, status: updated.status as 'active' | 'suspended' };
      },
      { userId: access.userId, estateId: access.estateId },
    );
  }
}
