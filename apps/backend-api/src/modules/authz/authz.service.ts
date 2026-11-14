import { Injectable } from '@nestjs/common';
import { getRole, PERMISSIONS, type Permission } from '@safezone/permissions';
import { DatabaseService } from '../../common/database/database.service';
import { asModule, type Tx } from '../../common/database/tenant-context';
import { DomainError } from '../../common/errors/domain-error';

export interface ActiveAssignment {
  roleKey: string;
  level: string;
  estateId: string | null;
  scopeType: string | null;
  scopeId: string | null;
  permissions: readonly string[];
}

export interface Grant {
  roles: string[];
  permissions: Set<string>;
}

/**
 * Policy data (modules/authz.md §6). Built-in role permissions come from @safezone/permissions (code is
 * the source of truth); custom estate roles from role_permissions. Evaluated per request, so revoking an
 * assignment takes effect on the next request.
 */
@Injectable()
export class AuthzService {
  constructor(private readonly db: DatabaseService) {}

  async activeAssignments(userId: string, now: Date = new Date()): Promise<ActiveAssignment[]> {
    const rows = await this.db.withContext(
      'authz',
      (tx) =>
        tx.roleAssignment.findMany({
          where: {
            userId,
            revokedAt: null,
            validFrom: { lte: now },
            OR: [{ validTo: null }, { validTo: { gt: now } }],
          },
          include: { role: { include: { permissions: true } } },
        }),
      { userId },
    );
    return rows.map((row) => ({
      roleKey: row.role.key,
      level: row.role.level,
      estateId: row.estateId,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      permissions: row.role.isBuiltin
        ? (getRole(row.role.key)?.permissions ?? [])
        : row.role.permissions.map((p) => p.permission),
    }));
  }

  /** Roles and permissions in one estate, or at platform level when estateId is null. */
  grantIn(assignments: readonly ActiveAssignment[], estateId: string | null): Grant {
    const matching = assignments.filter((assignment) =>
      estateId === null ? assignment.level === 'platform' : assignment.estateId === estateId,
    );
    const permissions = new Set<string>();
    for (const assignment of matching)
      for (const permission of assignment.permissions) permissions.add(permission);
    return { roles: [...new Set(matching.map((assignment) => assignment.roleKey))], permissions };
  }

  /**
   * Grants a built-in role inside the caller's transaction (e.g. tenancy approving an estate). Idempotent:
   * an existing unrevoked assignment of the same role in the same estate is kept.
   */
  async assignBuiltInRole(
    tx: Tx,
    input: {
      userId: string;
      roleKey: string;
      estateId: string | null;
      grantedBy: string | null;
      reason: string;
    },
  ): Promise<void> {
    const definition = getRole(input.roleKey);
    if (!definition || (definition.level === 'platform') !== (input.estateId === null)) {
      throw new DomainError('ROLE_NOT_ASSIGNABLE', 'This role cannot be assigned here', 422);
    }
    await asModule(tx, 'authz', async () => {
      const role = await tx.role.findFirst({
        where: { key: input.roleKey, estateId: null, isBuiltin: true },
        select: { id: true },
      });
      if (!role) throw new Error(`built-in role ${input.roleKey} is not seeded`);
      const existing = await tx.roleAssignment.findFirst({
        where: { userId: input.userId, roleId: role.id, estateId: input.estateId, revokedAt: null },
        select: { id: true },
      });
      if (existing) return;
      await tx.roleAssignment.create({
        data: {
          userId: input.userId,
          roleId: role.id,
          estateId: input.estateId,
          grantedBy: input.grantedBy,
          reason: input.reason,
        },
      });
    });
  }

  /** How many users currently hold a built-in role in an estate (setup checks). */
  async countHolders(estateId: string, roleKey: string, now: Date = new Date()): Promise<number> {
    return this.db.withContext('authz', (tx) =>
      tx.roleAssignment.count({
        where: {
          estateId,
          revokedAt: null,
          validFrom: { lte: now },
          OR: [{ validTo: null }, { validTo: { gt: now } }],
          role: { key: roleKey, estateId: null, isBuiltin: true },
        },
      }),
    );
  }

  catalogue(): { key: Permission; description: string }[] {
    return (Object.entries(PERMISSIONS) as [Permission, string][]).map(([key, description]) => ({
      key,
      description,
    }));
  }
}
