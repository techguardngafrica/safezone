import { type CanActivate, type ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  GATE_SESSION_PERMISSIONS,
  requiresMfa,
  SUPPORT_SESSION_PERMISSIONS,
} from '@safezone/permissions';
import { z } from 'zod';
import {
  ACCESS_KEY,
  type AccessRule,
  ALLOW_GATE_SESSION_KEY,
  ALLOW_MFA_PENDING_KEY,
  type AuthenticatedRequest,
  FEATURE_KEY,
  permits,
  rulePermissions,
} from '../../common/auth/auth.decorators';
import { PUBLIC_KEY } from '../../common/auth/public.decorator';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../../common/errors/domain-error';
import { requestContext } from '../../common/http/request-context';
import { SupportAccessService } from '../platform/support-access.service';
import { blockedBySuspension } from '../tenancy/domain/estate-lifecycle';
import { TenancyService } from '../tenancy/tenancy.service';
import { AuthzService } from './authz.service';

const estateIdSchema = z.uuid();

/**
 * Second global guard (after AuthenticationGuard). Enforces, in order:
 * 1. every route declares access (@Public/@SignedIn/@Member/@Can), failing closed otherwise;
 * 2. MFA for staff and platform roles (identity.md §6.4);
 * 3. estate membership for routes with :estateId (non-members get 404, so other estates stay invisible);
 * 4. the permission, in the estate or at platform level;
 * 5. the estate's entitlement for @RequiresFeature routes;
 * 6. suspension: only reads and safety actions in a suspended estate (tenancy.md §7.5).
 * Gate shift sessions (ADR-0017) reach only their own estate, within GATE_SESSION_PERMISSIONS, plus
 * signed-in routes marked @AllowGateSession.
 * A Techguard agent who is not a member reaches an estate only through an approved, unexpired support
 * session (platform.md §4): GET requests only, within SUPPORT_SESSION_PERMISSIONS, each one audited.
 */
@Injectable()
export class AuthorizationGuard implements CanActivate {
  private readonly logger = new Logger('Authorization');

  constructor(
    private readonly reflector: Reflector,
    private readonly authz: AuthzService,
    private readonly tenancy: TenancyService,
    private readonly support: SupportAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const rule = this.reflector.getAllAndOverride<AccessRule | undefined>(ACCESS_KEY, targets);
    if (!rule) {
      this.logger.error(
        `route without an access declaration: ${context.getClass().name}.${context.getHandler().name}`,
      );
      throw new ForbiddenError();
    }

    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest & { params?: Record<string, string>; method?: string }>();
    const auth = request.auth;
    if (!auth) throw new UnauthorizedError();

    const assignments = await this.authz.activeAssignments(auth.userId);
    const allowMfaPending =
      this.reflector.getAllAndOverride<boolean>(ALLOW_MFA_PENDING_KEY, targets) ?? false;
    if (!auth.mfaVerified && !allowMfaPending && requiresMfa(assignments.map((a) => a.roleKey))) {
      throw new ForbiddenError('Complete two-step verification to continue', 'MFA_REQUIRED');
    }
    const gateScope = auth.gateScope;
    if (rule.kind === 'signed_in') {
      if (gateScope && !this.reflector.getAllAndOverride<boolean>(ALLOW_GATE_SESSION_KEY, targets))
        throw new ForbiddenError('Not available on a gate device', 'GATE_SESSION_SCOPE');
      return true;
    }

    const rawEstateId = request.params?.estateId;
    if (gateScope && rawEstateId !== gateScope.estateId) {
      if (rawEstateId === undefined)
        throw new ForbiddenError('Not available on a gate device', 'GATE_SESSION_SCOPE');
      throw new NotFoundError('Estate not found', 'ESTATE_NOT_FOUND');
    }
    if (rawEstateId === undefined) {
      if (rule.kind === 'member')
        throw new Error('@Member() requires an :estateId route parameter');
      for (const permission of rulePermissions(rule)) {
        if (
          !permission.startsWith('platform.') &&
          !permission.startsWith('ad.') &&
          permission !== 'vendor.approve'
        ) {
          throw new Error(`@Can('${permission}') on a route without :estateId`);
        }
      }
      const grant = this.authz.grantIn(assignments, null);
      if (!permits(rule, grant.permissions)) throw new ForbiddenError();
      return true;
    }

    if (!estateIdSchema.safeParse(rawEstateId).success)
      throw new NotFoundError('Estate not found', 'ESTATE_NOT_FOUND');
    const membership = await this.tenancy.activeMembership(auth.userId, rawEstateId);
    if (!membership) {
      if (gateScope) throw new NotFoundError('Estate not found', 'ESTATE_NOT_FOUND');
      return this.admitSupportSession(request, rule, assignments, rawEstateId, targets);
    }

    const fullGrant = this.authz.grantIn(assignments, rawEstateId);
    const grant = gateScope
      ? {
          ...fullGrant,
          permissions: new Set(
            GATE_SESSION_PERMISSIONS.filter((permission) => fullGrant.permissions.has(permission)),
          ),
          staffPermissions: new Set(
            GATE_SESSION_PERMISSIONS.filter((permission) =>
              fullGrant.staffPermissions.has(permission),
            ),
          ),
        }
      : fullGrant;
    if (rule.kind === 'permission' && !permits(rule, grant.permissions)) throw new ForbiddenError();

    if (
      blockedBySuspension(
        membership.estateStatus,
        request.method ?? 'GET',
        rule.kind === 'permission' ? rule.permission : null,
      )
    ) {
      throw new ForbiddenError(
        'This estate is suspended. Only safety features are available.',
        'ESTATE_SUSPENDED',
      );
    }

    const feature = this.reflector.getAllAndOverride<string | undefined>(FEATURE_KEY, targets);
    if (feature) {
      const features = await this.tenancy.enabledFeatures(rawEstateId);
      if (!features.includes(feature as never)) {
        throw new ForbiddenError(
          'This feature is not enabled for your estate',
          'FEATURE_NOT_ENABLED',
        );
      }
    }

    request.estateAccess = {
      estateId: rawEstateId,
      userId: auth.userId,
      roles: grant.roles,
      permissions: grant.permissions,
      staffPermissions: grant.staffPermissions,
    };
    requestContext.assign({ estateId: rawEstateId });
    return true;
  }

  /** Non-members: only a Techguard agent with an approved support session, read-only (platform.md §4). */
  private async admitSupportSession(
    request: AuthenticatedRequest & {
      params?: Record<string, string>;
      method?: string;
      route?: { path?: string };
    },
    rule: AccessRule,
    assignments: Awaited<ReturnType<AuthzService['activeAssignments']>>,
    estateId: string,
    targets: Parameters<Reflector['getAllAndOverride']>[1],
  ): Promise<boolean> {
    const auth = request.auth;
    const platform = this.authz.grantIn(assignments, null);
    if (!auth || !platform.permissions.has('platform.support_access')) {
      throw new NotFoundError('Estate not found', 'ESTATE_NOT_FOUND');
    }
    const session = await this.support.activeSession(auth.userId, estateId);
    if (!session) throw new NotFoundError('Estate not found', 'ESTATE_NOT_FOUND');
    const method = (request.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      throw new ForbiddenError('Support sessions are read-only', 'SUPPORT_SESSION_READ_ONLY');
    }
    const permissions = new Set<string>(SUPPORT_SESSION_PERMISSIONS);
    if (rule.kind === 'permission' && !permits(rule, permissions)) throw new ForbiddenError();
    const feature = this.reflector.getAllAndOverride<string | undefined>(FEATURE_KEY, targets);
    if (feature && !(await this.tenancy.enabledFeatures(estateId)).includes(feature as never)) {
      throw new ForbiddenError(
        'This feature is not enabled for your estate',
        'FEATURE_NOT_ENABLED',
      );
    }
    await this.support.recordAccess({
      estateId,
      platformUserId: auth.userId,
      sessionId: session.id,
      method,
      route: request.route?.path ?? 'unknown',
    });
    request.estateAccess = {
      estateId,
      userId: auth.userId,
      roles: ['support_agent'],
      permissions,
      staffPermissions: permissions,
      supportSessionId: session.id,
    };
    requestContext.assign({ estateId });
    return true;
  }
}
