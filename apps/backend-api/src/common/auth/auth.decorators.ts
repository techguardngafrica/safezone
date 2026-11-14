import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission } from '@safezone/permissions';
import type { FeatureKey } from '@safezone/schemas';

/**
 * Route access declarations (AGENTS.md §5.3). Every route has exactly one of:
 * @Public(), @SignedIn(), @Member() or @Can('<permission>'). AuthorizationGuard rejects routes with none,
 * and test/isolation checks it for every route.
 */
export const ACCESS_KEY = 'safezone:access';
export type AccessRule =
  { kind: 'signed_in' } | { kind: 'member' } | { kind: 'permission'; permission: Permission };

/** Any signed-in user acting on their own data (/v1/me, /v1/auth/signout). */
export const SignedIn = (): MethodDecorator =>
  SetMetadata(ACCESS_KEY, { kind: 'signed_in' } satisfies AccessRule);

/** Any active member of the estate in the `:estateId` path parameter. */
export const Member = (): MethodDecorator =>
  SetMetadata(ACCESS_KEY, { kind: 'member' } satisfies AccessRule);

/**
 * Requires a permission. With an `:estateId` path parameter it is evaluated in that estate;
 * `platform.*` permissions are evaluated against platform role assignments.
 */
export const Can = (permission: Permission): MethodDecorator =>
  SetMetadata(ACCESS_KEY, { kind: 'permission', permission } satisfies AccessRule);

export const ALLOW_MFA_PENDING_KEY = 'safezone:allow-mfa-pending';
/** Reachable before MFA is completed (MFA verify and enrolment only). */
export const AllowMfaPending = (): MethodDecorator => SetMetadata(ALLOW_MFA_PENDING_KEY, true);

export const FEATURE_KEY = 'safezone:feature';
/** Estate route that needs an entitlement; disabled features return 403 FEATURE_NOT_ENABLED. */
export const RequiresFeature = (feature: FeatureKey): MethodDecorator =>
  SetMetadata(FEATURE_KEY, feature);

/** Set by AuthenticationGuard on every non-public request. */
export interface AuthContext {
  userId: string;
  sessionId: string;
  app: string;
  mfaVerified: boolean;
}

/** Set by AuthorizationGuard on estate routes. */
export interface EstateAccess {
  estateId: string;
  userId: string;
  roles: readonly string[];
  permissions: ReadonlySet<string>;
}

export interface AuthenticatedRequest {
  auth?: AuthContext;
  estateAccess?: EstateAccess;
}

export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthContext => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth) throw new Error('@CurrentAuth used on a route without authentication');
    return request.auth;
  },
);

export const CurrentEstate = createParamDecorator(
  (_data: unknown, context: ExecutionContext): EstateAccess => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.estateAccess)
      throw new Error('@CurrentEstate used on a route without estate access');
    return request.estateAccess;
  },
);
