/** SOS states (emergency.md §3). */
export const ACTIVE_SOS_STATUSES = ['triggered', 'acknowledged', 'assigned', 'responding'] as const;
export type SosStatus = (typeof ACTIVE_SOS_STATUSES)[number] | 'resolved' | 'closed' | 'cancelled';
export type SosAction = 'cancel' | 'acknowledge' | 'assign' | 'responding' | 'resolve' | 'close';

export const SOS_CATEGORIES = [
  'security_threat',
  'medical',
  'fire',
  'accident',
  'suspicious_activity',
  'general',
] as const;

const TRANSITIONS: Record<SosAction, { from: readonly string[]; to: SosStatus }> = {
  // The triggerer may cancel only before anyone acknowledges (emergency.md §8.3).
  cancel: { from: ['triggered'], to: 'cancelled' },
  acknowledge: { from: ['triggered'], to: 'acknowledged' },
  assign: { from: ['triggered', 'acknowledged', 'assigned'], to: 'assigned' },
  responding: { from: ['acknowledged', 'assigned'], to: 'responding' },
  resolve: { from: ['triggered', 'acknowledged', 'assigned', 'responding'], to: 'resolved' },
  close: { from: ['resolved', 'cancelled'], to: 'closed' },
};

export function nextSosStatus(current: string, action: SosAction): SosStatus | null {
  return TRANSITIONS[action].from.includes(current) ? TRANSITIONS[action].to : null;
}

export function isActiveSos(status: string): boolean {
  return (ACTIVE_SOS_STATUSES as readonly string[]).includes(status);
}

export interface EscalationStep {
  afterSeconds: number;
  target: 'next_guard' | 'supervisor_and_managers' | 'emergency_contacts_voice';
}

/** Steps sorted by time, at least 30 s apart (emergency.md §6), ready to schedule as delayed jobs. */
export function normaliseEscalation(steps: readonly EscalationStep[]): EscalationStep[] {
  const sorted = [...steps].sort((a, b) => a.afterSeconds - b.afterSeconds);
  const result: EscalationStep[] = [];
  for (const step of sorted) {
    const previous = result.at(-1);
    if (previous && step.afterSeconds - previous.afterSeconds < 30) {
      result.push({ ...step, afterSeconds: previous.afterSeconds + 30 });
    } else {
      result.push(step);
    }
  }
  return result;
}

/** Whether an escalation step still applies: only unacknowledged alerts escalate; drills skip outside contacts. */
export function shouldEscalate(status: string, step: EscalationStep, isDrill: boolean): boolean {
  if (status !== 'triggered') return false;
  return !(isDrill && step.target === 'emergency_contacts_voice');
}
