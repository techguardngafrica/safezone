import { Controller, Get } from '@nestjs/common';
import {
  membershipSummarySchema,
  permissionCatalogueSchema,
  permissionSnapshotQuerySchema,
  permissionSnapshotSchema,
} from '@safezone/schemas';
import { GATE_SESSION_PERMISSIONS } from '@safezone/permissions';
import { z } from 'zod';
import {
  AllowGateSession,
  type AuthContext,
  CurrentAuth,
  SignedIn,
} from '../../common/auth/auth.decorators';
import { Contract, ValidQuery } from '../../common/contract/contract';
import { TenancyService } from '../tenancy/tenancy.service';
import { AuthzService } from './authz.service';

/**
 * What the signed-in user can see and do: memberships, permission snapshot and the catalogue.
 * Lives in authz (which depends on tenancy) so the module graph stays acyclic.
 */
@Controller('v1')
export class AccessController {
  constructor(
    private readonly authz: AuthzService,
    private readonly tenancy: TenancyService,
  ) {}

  @Get('me/memberships')
  @SignedIn()
  @AllowGateSession()
  @Contract({
    summary: 'My estates and roles',
    tags: ['me'],
    response: z.array(membershipSummarySchema),
  })
  async memberships(@CurrentAuth() auth: AuthContext) {
    const [memberships, assignments] = await Promise.all([
      this.tenancy.membershipsOf(auth.userId),
      this.authz.activeAssignments(auth.userId),
    ]);
    return (
      memberships
        // A gate session lists only the estate of its device (ADR-0017).
        .filter(({ estate }) => !auth.gateScope || estate.id === auth.gateScope.estateId)
        .map(({ membership, estate }) => ({
          estate,
          status: membership.status,
          roles: this.authz.grantIn(assignments, estate.id).roles,
          joinedAt: membership.joinedAt.toISOString(),
        }))
    );
  }

  @Get('me/permissions')
  @SignedIn()
  @AllowGateSession()
  @Contract({
    summary: 'Permission snapshot for showing and hiding UI',
    tags: ['me'],
    query: permissionSnapshotQuerySchema,
    response: permissionSnapshotSchema,
  })
  async permissions(
    @CurrentAuth() auth: AuthContext,
    @ValidQuery() query: z.infer<typeof permissionSnapshotQuerySchema>,
  ) {
    const assignments = await this.authz.activeAssignments(auth.userId);
    const estateId = query.estateId ?? null;
    // A gate session sees only its own estate and its ceiling (ADR-0017).
    if (auth.gateScope && estateId !== auth.gateScope.estateId)
      return { estateId, roles: [], permissions: [], features: [] };
    if (estateId) {
      const membership = await this.tenancy.activeMembership(auth.userId, estateId);
      if (!membership) return { estateId, roles: [], permissions: [], features: [] };
    }
    const grant = this.authz.grantIn(assignments, estateId);
    const permissions = auth.gateScope
      ? GATE_SESSION_PERMISSIONS.filter((permission) => grant.permissions.has(permission))
      : [...grant.permissions];
    const features = estateId ? await this.tenancy.enabledFeatures(estateId) : [];
    return { estateId, roles: grant.roles, permissions: permissions.sort(), features };
  }

  @Get('permissions/catalogue')
  @SignedIn()
  @Contract({
    summary: 'Permission catalogue',
    tags: ['authz'],
    response: permissionCatalogueSchema,
  })
  catalogue() {
    return this.authz.catalogue();
  }
}
