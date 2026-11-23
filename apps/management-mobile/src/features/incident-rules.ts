import type { Tone } from '@safezone/mobile-ui';

export type IncidentStatus = 'reported' | 'under_review' | 'assigned' | 'resolved' | 'closed';
export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';
export type IncidentAction = 'review' | 'resolve' | 'reopen' | 'close';

/**
 * The transitions offered on mobile, from the security module's state machine
 * (`backend-api/src/modules/security/domain/incidents.ts`). Assigning is done on the web.
 */
const FROM: Record<IncidentAction, readonly IncidentStatus[]> = {
  review: ['reported'],
  resolve: ['reported', 'under_review', 'assigned'],
  reopen: ['resolved'],
  close: ['resolved'],
};

export function incidentActions(status: IncidentStatus): IncidentAction[] {
  return (Object.keys(FROM) as IncidentAction[]).filter((action) => FROM[action].includes(status));
}

/** True when an incident can be assigned or reassigned to a staff member or guard. */
export function canAssignIncident(status: IncidentStatus): boolean {
  return status === 'reported' || status === 'under_review' || status === 'assigned';
}

/** Resolving needs a resolution of 3+ characters, as the API requires. */
export function needsText(action: IncidentAction): boolean {
  return action === 'resolve';
}

export const INCIDENT_STATUS_TONE: Record<IncidentStatus, Tone> = {
  reported: 'warning',
  under_review: 'info',
  assigned: 'info',
  resolved: 'success',
  closed: 'neutral',
};

export const SEVERITY_TONE: Record<IncidentSeverity, Tone> = {
  low: 'neutral',
  medium: 'info',
  high: 'warning',
  critical: 'danger',
};
