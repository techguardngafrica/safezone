import { type CanActivate, type ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { requiresMfa } from '@safezone/permissions';
import { z } from 'zod';
import {
  ACCESS_KEY,
  type AccessRule,
  ALLOW_MFA_PENDING_KEY,
  type AuthenticatedRequest,
  FEATURE_KEY,
} from '../../common/auth/auth.decorators';
import { PUBLIC_KEY } from '../../common/auth/public.decorator';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../../common/errors/domain-error';
import { requestContext } from '../../common/http/request-context';
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
 */
@Injectable()
export class AuthorizationGuard implements CanActivate {
  private readonly logger = new Logger('Authorization');

  constructor(
    private readonly reflector: Reflector,
    private readonly authz: AuthzService,
    private readonly tenancy: TenancyService,
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
    if (rule.kind === 'signed_in') return true;

    const rawEstateId = request.params?.estateId;
    if (rawEstateId === undefined) {
      if (rule.kind === 'member')
        throw new Error('@Member() requires an :estateId route parameter');
      if (
        !rule.permission.startsWith('platform.') &&
        !rule.permission.startsWith('ad.') &&
        rule.permission !== 'vendor.approve'
      ) {
        throw new Error(`@Can('${rule.permission}') on a route without :estateId`);
      }
      const grant = this.authz.grantIn(assignments, null);
      if (!grant.permissions.has(rule.permission)) throw new ForbiddenError();
      return true;
    }

    if (!estateIdSchema.safeParse(rawEstateId).success)
      throw new NotFoundError('Estate not found', 'ESTATE_NOT_FOUND');
    const membership = await this.tenancy.activeMembership(auth.userId, rawEstateId);
    if (!membership) throw new NotFoundError('Estate not found', 'ESTATE_NOT_FOUND');

    const grant = this.authz.grantIn(assignments, rawEstateId);
    if (rule.kind === 'permission' && !grant.permissions.has(rule.permission))
      throw new ForbiddenError();

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
    };
    requestContext.assign({ estateId: rawEstateId });
    return true;
  }
}
