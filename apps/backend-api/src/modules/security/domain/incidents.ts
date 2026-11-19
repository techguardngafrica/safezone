/** Incident rules (security.md §4). Pure functions. */

export type IncidentStatus = 'reported' | 'under_review' | 'assigned' | 'resolved' | 'closed';
export type IncidentAction = 'review' | 'assign' | 'resolve' | 'reopen' | 'close';
export type ReporterType = 'guard' | 'resident' | 'manager';

const TRANSITIONS: Record<IncidentAction, { from: readonly IncidentStatus[]; to: IncidentStatus }> =
  {
    review: { from: ['reported'], to: 'under_review' },
    // Reassigning an assigned incident is allowed.
    assign: { from: ['reported', 'under_review', 'assigned'], to: 'assigned' },
    resolve: { from: ['reported', 'under_review', 'assigned'], to: 'resolved' },
    reopen: { from: ['resolved'], to: 'under_review' },
    close: { from: ['resolved'], to: 'closed' },
  };

/** The next status, or null when the action is not allowed from `current`. */
export function nextIncidentStatus(current: string, action: IncidentAction): IncidentStatus | null {
  const transition = TRANSITIONS[action];
  return (transition.from as readonly string[]).includes(current) ? transition.to : null;
}

export const OPEN_INCIDENT_STATUSES: readonly IncidentStatus[] = [
  'reported',
  'under_review',
  'assigned',
];

/** Closed incidents take no more evidence or notes; corrections reopen first. */
export function acceptsAdditions(status: string): boolean {
  return status !== 'closed';
}

/**
 * Who reported it, from the reporter's roles in the estate: managers (incident.manage) first, then gate
 * staff (gate.verify), otherwise a resident.
 */
export function reporterTypeOf(permissions: ReadonlySet<string>, isStaff: boolean): ReporterType {
  if (isStaff && permissions.has('incident.manage')) return 'manager';
  if (isStaff && permissions.has('gate.verify')) return 'guard';
  return 'resident';
}

/** Rule 8: critical incidents notify the supervisor and managers immediately. */
export function notifiesImmediately(severity: string): boolean {
  return severity === 'critical';
}

/** An incident cannot be dated in the future (5 minutes of clock skew allowed). */
export function occurredAtValid(occurredAt: Date, now: Date = new Date()): boolean {
  return occurredAt.getTime() <= now.getTime() + 5 * 60_000;
}
