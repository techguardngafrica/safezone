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
  | { kind: 'signed_in' }
  | { kind: 'member' }
  | {
      kind: 'permission';
      permission: Permission;
      /** Other permissions that also grant access (any one is enough). */
      alternatives?: readonly Permission[];
    };

/** Every permission that satisfies a permission rule: the primary one first. */
export function rulePermissions(rule: Extract<AccessRule, { kind: 'permission' }>): Permission[] {
  return [rule.permission, ...(rule.alternatives ?? [])];
}

/** True when the granted set holds the rule's permission or one of its alternatives. */
export function permits(
  rule: Extract<AccessRule, { kind: 'permission' }>,
  granted: ReadonlySet<string>,
): boolean {
  return rulePermissions(rule).some((permission) => granted.has(permission));
}

/** Any signed-in user acting on their own data (/v1/me, /v1/auth/signout). */
export const SignedIn = (): MethodDecorator =>
  SetMetadata(ACCESS_KEY, { kind: 'signed_in' } satisfies AccessRule);

/** Any active member of the estate in the `:estateId` path parameter. */
export const Member = (): MethodDecorator =>
  SetMetadata(ACCESS_KEY, { kind: 'member' } satisfies AccessRule);

/**
 * Requires a permission. With an `:estateId` path parameter it is evaluated in that estate;
 * `platform.*` permissions are evaluated against platform role assignments. Extra permissions are
 * alternatives: `@Can('billing.run.create', 'billing.run.approve')` admits either, so the people
 * who approve something can also read it.
 */
export const Can = (permission: Permission, ...alternatives: Permission[]): MethodDecorator =>
  SetMetadata(ACCESS_KEY, {
    kind: 'permission',
    permission,
    ...(alternatives.length > 0 ? { alternatives } : {}),
  } satisfies AccessRule);

export const ALLOW_GATE_SESSION_KEY = 'safezone:allow-gate-session';
/**
 * Lets a gate shift session (ADR-0017) call this signed-in route. Without it, gate sessions reach only
 * estate routes of their own estate, within the gate permission ceiling.
 */
export const AllowGateSession = (): MethodDecorator => SetMetadata(ALLOW_GATE_SESSION_KEY, true);

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
  /** Guard PIN session on a gate device (ADR-0017): one estate, gate permissions only. */
  gateScope?: { estateId: string; deviceId: string };
}

/** Set by AuthorizationGuard on estate routes. */
export interface EstateAccess {
  estateId: string;
  userId: string;
  roles: readonly string[];
  permissions: ReadonlySet<string>;
  /**
   * Permissions held through staff roles only. Estate-wide data (e.g. every invoice) needs these, since a
   * resident role's `invoice.read` covers only their own household. Absent means none (fail closed).
   */
  staffPermissions?: ReadonlySet<string>;
  /** Set when a Techguard agent reads the estate through an approved support session. */
  supportSessionId?: string;
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
