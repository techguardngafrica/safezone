/** Shift rules (security.md §4.2 to §4.4). Pure functions. */

export interface OpenShift {
  userId: string;
  gateId: string;
}

export type StartDecision = 'start' | 'resume' | 'conflict';

/**
 * Rule 2 (one open shift per guard until devices carry their own session): starting again at the same
 * gate resumes the open shift (a restarted phone); starting at another gate is refused until it ends.
 */
export function startDecision(open: OpenShift | null, gateId: string): StartDecision {
  if (!open) return 'start';
  return open.gateId === gateId ? 'resume' : 'conflict';
}

/** Guards end their own shift; supervisors (security.staff.manage) may end anyone's (remote sign-out). */
export function canEndShift(shiftUserId: string, callerId: string, isSupervisor: boolean): boolean {
  return shiftUserId === callerId || isSupervisor;
}
