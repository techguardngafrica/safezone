/** Occupancy rules (occupancy.md §4, §6). */

export type JoinRelationship = 'owner' | 'tenant' | 'household_member';
export type JoinStatus =
  | 'awaiting_household_head'
  | 'awaiting_owner'
  | 'awaiting_manager'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'expired';

export const OPEN_JOIN_STATUSES: readonly JoinStatus[] = [
  'awaiting_household_head',
  'awaiting_owner',
  'awaiting_manager',
];

/** Requests not decided in 30 days expire (occupancy.md §4.5). */
export const JOIN_REQUEST_TTL_MS = 30 * 24 * 3600_000;

export type TenantApprovalPolicy = 'owner_then_manager_override' | 'manager_only' | 'owner_only';

/**
 * First approval step for a new request.
 * - household_member: the household head.
 * - owner: the manager (who checks the ownership record).
 * - tenant: the unit's owner when one is known and the policy involves owners, otherwise the manager.
 */
export function firstJoinStep(
  relationship: JoinRelationship,
  policy: TenantApprovalPolicy,
  knownOwner: boolean,
): JoinStatus {
  if (relationship === 'household_member') return 'awaiting_household_head';
  if (relationship === 'tenant' && policy !== 'manager_only' && knownOwner) return 'awaiting_owner';
  return 'awaiting_manager';
}

export type Approver = 'household_head' | 'owner' | 'manager';

/**
 * What a decision does. Managers may override any open step (owner unreachable, household head absent).
 * The owner step leads to the manager unless the policy is owner_only.
 */
export function decideJoin(
  status: string,
  approver: Approver,
  decision: 'approve' | 'reject',
  policy: TenantApprovalPolicy,
): JoinStatus | null {
  if (!(OPEN_JOIN_STATUSES as readonly string[]).includes(status)) return null;
  const allowed =
    approver === 'manager' ||
    (approver === 'household_head' && status === 'awaiting_household_head') ||
    (approver === 'owner' && status === 'awaiting_owner');
  if (!allowed) return null;
  if (decision === 'reject') return 'rejected';
  if (status === 'awaiting_owner' && approver === 'owner' && policy !== 'owner_only') {
    return 'awaiting_manager';
  }
  return 'approved';
}

export function roleForRelationship(relationship: JoinRelationship): string {
  return relationship === 'owner'
    ? 'homeowner'
    : relationship === 'tenant'
      ? 'tenant'
      : 'household_member';
}

export interface MemberPermissions {
  inviteVisitors: boolean;
  triggerSos: boolean;
  payBills: boolean;
  viewBills: boolean;
  receiveGateAlerts: boolean;
}

export const HEAD_PERMISSIONS: MemberPermissions = {
  inviteVisitors: true,
  triggerSos: true,
  payBills: true,
  viewBills: true,
  receiveGateAlerts: true,
};

/** Adults can invite visitors and raise SOS by default; money is the head's call. Minors get SOS only. */
export function defaultMemberPermissions(isMinor: boolean): MemberPermissions {
  return isMinor
    ? {
        inviteVisitors: false,
        triggerSos: true,
        payBills: false,
        viewBills: false,
        receiveGateAlerts: false,
      }
    : {
        inviteVisitors: true,
        triggerSos: true,
        payBills: false,
        viewBills: false,
        receiveGateAlerts: true,
      };
}

export function parsePermissions(value: unknown): MemberPermissions {
  const source = (typeof value === 'object' && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const flag = (key: keyof MemberPermissions) => source[key] === true;
  return {
    inviteVisitors: flag('inviteVisitors'),
    triggerSos: flag('triggerSos'),
    payBills: flag('payBills'),
    viewBills: flag('viewBills'),
    receiveGateAlerts: flag('receiveGateAlerts'),
  };
}

/** "lag 123-ab" → "LAG123AB" (occupancy.md §6.6). */
export function normalisePlate(plate: string): string {
  return plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
