/** Pass validity and gate decisions (visitor.md §5–§7). Times are evaluated in Africa/Lagos (WAT, UTC+1, no DST). */
export const WAT_OFFSET_MINUTES = 60;
/** Within this many minutes outside the window the guard sees CHECK instead of DENY. */
export const GRACE_MINUTES = 15;

export const PASS_TYPES = [
  'one_time',
  'multi_entry',
  'recurring',
  'domestic_staff',
  'delivery',
  'event',
] as const;
export type PassType = (typeof PASS_TYPES)[number];

export interface Recurrence {
  /** 0 = Sunday … 6 = Saturday, in WAT. */
  days: number[];
  from: string;
  to: string;
}

export interface PassFacts {
  type: PassType;
  validFrom: Date;
  validTo: Date;
  recurrence: Recurrence | null;
  maxUses: number | null;
  usesCount: number;
  revokedAt: Date | null;
  gateIds: readonly string[];
}

export type PassStatus = 'scheduled' | 'active' | 'used' | 'expired' | 'revoked';

export function passStatus(pass: PassFacts, now: Date = new Date()): PassStatus {
  if (pass.revokedAt) return 'revoked';
  if (pass.maxUses !== null && pass.usesCount >= pass.maxUses) return 'used';
  if (now > pass.validTo) return 'expired';
  if (now < pass.validFrom) return 'scheduled';
  return 'active';
}

function watParts(date: Date): { day: number; minutes: number } {
  const shifted = new Date(date.getTime() + WAT_OFFSET_MINUTES * 60_000);
  return {
    day: shifted.getUTCDay(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

function toMinutes(hhmm: string): number {
  const [hours = '0', minutes = '0'] = hhmm.split(':');
  return Number(hours) * 60 + Number(minutes);
}

/** Minutes outside today's recurring window (0 when inside, Infinity on a day not in the schedule). */
export function minutesOutsideRecurrence(recurrence: Recurrence, now: Date): number {
  const { day, minutes } = watParts(now);
  if (!recurrence.days.includes(day)) return Number.POSITIVE_INFINITY;
  const from = toMinutes(recurrence.from);
  const to = toMinutes(recurrence.to);
  if (minutes < from) return from - minutes;
  if (minutes > to) return minutes - to;
  return 0;
}

export type Decision = 'allow' | 'check' | 'deny';

export interface DecisionResult {
  decision: Decision;
  reasons: string[];
}

/**
 * The gate decision for an entry. Exits are always allowed (people must be able to leave). Reasons are
 * stable codes the Security App translates.
 */
export function decideEntry(
  pass: PassFacts,
  context: { now: Date; gateId: string; restricted: boolean },
): DecisionResult {
  const reasons: string[] = [];
  if (context.restricted) return { decision: 'deny', reasons: ['restricted_visitor'] };
  if (pass.revokedAt) return { decision: 'deny', reasons: ['revoked'] };
  if (pass.maxUses !== null && pass.usesCount >= pass.maxUses)
    return { decision: 'deny', reasons: ['no_uses_left'] };
  if (pass.gateIds.length > 0 && !pass.gateIds.includes(context.gateId)) {
    return { decision: 'deny', reasons: ['wrong_gate'] };
  }

  const graceMs = GRACE_MINUTES * 60_000;
  const now = context.now.getTime();
  if (now < pass.validFrom.getTime() - graceMs) return { decision: 'deny', reasons: ['too_early'] };
  if (now > pass.validTo.getTime() + graceMs) return { decision: 'deny', reasons: ['expired'] };
  if (now < pass.validFrom.getTime()) reasons.push('slightly_early');
  if (now > pass.validTo.getTime()) reasons.push('slightly_late');

  if (pass.recurrence) {
    const outside = minutesOutsideRecurrence(pass.recurrence, context.now);
    if (outside === Number.POSITIVE_INFINITY)
      return { decision: 'deny', reasons: ['not_scheduled_today'] };
    if (outside > GRACE_MINUTES) return { decision: 'deny', reasons: ['outside_hours'] };
    if (outside > 0) reasons.push('outside_hours_grace');
  }
  return { decision: reasons.length > 0 ? 'check' : 'allow', reasons };
}

/** Max uses implied by the pass type (null = unlimited within the window). */
export function defaultMaxUses(type: PassType, requested: number | undefined): number | null {
  switch (type) {
    case 'one_time':
    case 'delivery':
      return 1;
    case 'multi_entry':
      return requested ?? 5;
    default:
      return null;
  }
}
