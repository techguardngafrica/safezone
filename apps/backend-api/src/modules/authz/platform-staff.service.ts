import { Injectable } from '@nestjs/common';
import { getRole } from '@safezone/permissions';
import type { assignPlatformRoleSchema } from '@safezone/schemas';
import type { z } from 'zod';
import { DatabaseService } from '../../common/database/database.service';
import { ConflictError, NotFoundError, ValidationError } from '../../common/errors/domain-error';
import { appendOutboxEvents } from '../../common/outbox/outbox-writer';

/** Assignment validity window: started and not yet ended. */
function activeAt(now: Date) {
  return {
    validFrom: { lte: now },
    OR: [{ validTo: null }, { validTo: { gt: now } }],
  };
}

/**
 * Platform staff role management (super-admin.md §6.3, ADR-0022).
 * Only grants `level === 'platform'` roles; never allows removing the last active `super_admin`.
 */
@Injectable()
export class PlatformStaffService {
  constructor(private readonly db: DatabaseService) {}

  async listAssignments() {
    return this.db.withContext('authz', async (tx) => {
      return tx.roleAssignment.findMany({
        where: {
          estateId: null,
          revokedAt: null,
          ...activeAt(new Date()),
          role: { level: 'platform' },
        },
        include: { role: { select: { key: true, name: true } } },
        orderBy: { grantedAt: 'desc' },
      });
    });
  }

  async assignRole(actorId: string, input: z.infer<typeof assignPlatformRoleSchema>) {
    const def = getRole(input.roleKey);
    if (!def || def.level !== 'platform') {
      throw new ValidationError([
        { path: 'roleKey', message: 'Only platform-level roles can be granted here' },
      ]);
    }
    return this.db.withContext('authz', async (tx) => {
      const role = await tx.role.findFirst({
        where: { key: input.roleKey, level: 'platform', estateId: null },
      });
      if (!role) throw new NotFoundError('Platform role not found', 'ROLE_NOT_FOUND');

      const now = new Date();
      // Only a currently valid assignment blocks a new grant; an expired one can be granted again.
      const existing = await tx.roleAssignment.findFirst({
        where: {
          userId: input.userId,
          roleId: role.id,
          estateId: null,
          revokedAt: null,
          ...activeAt(now),
        },
      });
      if (existing) {
        throw new ConflictError(
          'ROLE_ALREADY_ASSIGNED',
          'This user already holds that platform role',
        );
      }

      const created = await tx.roleAssignment.create({
        data: {
          userId: input.userId,
          roleId: role.id,
          estateId: null,
          grantedBy: actorId,
          reason: input.reason,
        },
        include: { role: { select: { key: true, name: true } } },
      });

      await appendOutboxEvents(tx, [
        {
          type: 'authz.platform_role.granted',
          estateId: null,
          aggregateType: 'role_assignment',
          aggregateId: created.id,
          payload: { userId: input.userId, roleKey: role.key },
          audit: {
            actorType: 'platform_staff',
            actorId,
            action: 'platform.staff.grant_role',
            resourceType: 'role_assignment',
            resourceId: created.id,
            after: { userId: input.userId, roleKey: role.key },
            reason: input.reason,
          },
        },
      ]);

      return {
        assignmentId: created.id,
        roleKey: created.role.key,
        roleName: created.role.name,
        grantedAt: created.grantedAt.toISOString(),
      };
    });
  }

  async revokeRole(actorId: string, assignmentId: string, reason: string) {
    return this.db.withContext('authz', async (tx) => {
      const assignment = await tx.roleAssignment.findFirst({
        where: { id: assignmentId, estateId: null, revokedAt: null },
        include: { role: { select: { id: true, key: true, level: true } } },
      });
      if (!assignment || assignment.role.level !== 'platform') {
        throw new NotFoundError('Platform role assignment not found', 'ASSIGNMENT_NOT_FOUND');
      }

      if (assignment.role.key === 'super_admin') {
        // Serialize Super Admin revocations so two concurrent revokes cannot both see the other
        // as "remaining" and leave the platform with none. Released at commit/rollback.
        await tx.$executeRaw`select pg_advisory_xact_lock(hashtext('authz.super_admin.revoke'))`;
        const stillActive = await tx.roleAssignment.findFirst({
          where: { id: assignmentId, revokedAt: null },
          select: { id: true },
        });
        if (!stillActive) {
          throw new NotFoundError('Platform role assignment not found', 'ASSIGNMENT_NOT_FOUND');
        }
        const remaining = await tx.roleAssignment.count({
          where: {
            roleId: assignment.role.id,
            estateId: null,
            revokedAt: null,
            id: { not: assignmentId },
            ...activeAt(new Date()),
          },
        });
        if (remaining === 0) {
          throw new ConflictError(
            'LAST_SUPER_ADMIN',
            'Cannot revoke the last active Super Admin role',
          );
        }
      }

      await tx.roleAssignment.update({
        where: { id: assignmentId },
        data: { revokedAt: new Date() },
      });

      await appendOutboxEvents(tx, [
        {
          type: 'authz.platform_role.revoked',
          estateId: null,
          aggregateType: 'role_assignment',
          aggregateId: assignmentId,
          payload: { userId: assignment.userId, roleKey: assignment.role.key },
          audit: {
            actorType: 'platform_staff',
            actorId,
            action: 'platform.staff.revoke_role',
            resourceType: 'role_assignment',
            resourceId: assignmentId,
            before: { userId: assignment.userId, roleKey: assignment.role.key },
            reason,
          },
        },
      ]);

      return { assignmentId, revoked: true };
    });
  }
}
