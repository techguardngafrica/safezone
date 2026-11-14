/**
 * Estate lifecycle after approval (tenancy.md §3.2, §7.4–7.6):
 * approved → active (setup complete) → suspended ⇄ reactivated, and any of them → deactivated.
 * Reactivation returns a suspended estate to active if it was ever activated, otherwise to approved.
 */
export type EstateAction = 'activate' | 'suspend' | 'reactivate' | 'deactivate';

export function nextEstateStatus(
  current: string,
  action: EstateAction,
  everActivated: boolean,
): string | null {
  switch (action) {
    case 'activate':
      return current === 'approved' ? 'active' : null;
    case 'suspend':
      return current === 'approved' || current === 'active' ? 'suspended' : null;
    case 'reactivate':
      return current === 'suspended' ? (everActivated ? 'active' : 'approved') : null;
    case 'deactivate':
      return ['approved', 'active', 'suspended'].includes(current) ? 'deactivated' : null;
  }
}

/**
 * While an estate is suspended, changes are refused except these safety actions (tenancy.md §7.5):
 * visitor verification, SOS and safety records keep working. Reads are always allowed.
 */
export const SUSPENSION_EXEMPT_PERMISSIONS: ReadonlySet<string> = new Set([
  'visitor.invite',
  'gate.verify',
  'incident.report',
  'incident.manage',
  'sos.trigger',
  'sos.respond',
  'broadcast.emergency',
]);

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** True when a request must be refused because the estate is suspended. */
export function blockedBySuspension(
  estateStatus: string,
  method: string,
  permission: string | null,
): boolean {
  if (estateStatus !== 'suspended' || READ_METHODS.has(method.toUpperCase())) return false;
  return permission === null || !SUSPENSION_EXEMPT_PERMISSIONS.has(permission);
}
