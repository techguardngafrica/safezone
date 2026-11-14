/** Maintenance domain rules (maintenance.md §3, §5). Pure functions. */

export type RequestStatus =
  | 'submitted'
  | 'under_review'
  | 'info_requested'
  | 'approved'
  | 'assigned'
  | 'in_progress'
  | 'awaiting_materials'
  | 'resolved'
  | 'closed'
  | 'rejected'
  | 'cancelled';

export type RequestAction =
  | 'review'
  | 'approve'
  | 'reject'
  | 'request_info'
  | 'respond'
  | 'assign'
  | 'start'
  | 'await_materials'
  | 'resume'
  | 'resolve'
  | 'reopen'
  | 'close'
  | 'cancel';

const REQUEST_TRANSITIONS: Record<
  RequestAction,
  { from: readonly RequestStatus[]; to: RequestStatus }
> = {
  review: { from: ['submitted'], to: 'under_review' },
  approve: { from: ['submitted', 'under_review', 'info_requested'], to: 'approved' },
  reject: { from: ['submitted', 'under_review', 'info_requested', 'approved'], to: 'rejected' },
  request_info: { from: ['submitted', 'under_review'], to: 'info_requested' },
  respond: { from: ['info_requested'], to: 'under_review' },
  assign: { from: ['submitted', 'under_review', 'approved', 'assigned'], to: 'assigned' },
  start: { from: ['approved', 'assigned'], to: 'in_progress' },
  await_materials: { from: ['in_progress'], to: 'awaiting_materials' },
  resume: { from: ['awaiting_materials'], to: 'in_progress' },
  resolve: { from: ['assigned', 'in_progress', 'awaiting_materials'], to: 'resolved' },
  reopen: { from: ['resolved'], to: 'in_progress' },
  close: { from: ['resolved'], to: 'closed' },
  cancel: { from: ['submitted', 'under_review', 'info_requested'], to: 'cancelled' },
};

export function nextRequestStatus(current: string, action: RequestAction): RequestStatus | null {
  const transition = REQUEST_TRANSITIONS[action];
  return (transition.from as readonly string[]).includes(current) ? transition.to : null;
}

/** The SLA clock pauses while waiting on the resident or on materials (rule 5). */
export const PAUSED_STATUSES: readonly RequestStatus[] = ['info_requested', 'awaiting_materials'];
export const OPEN_REQUEST_STATUSES: readonly RequestStatus[] = [
  'submitted',
  'under_review',
  'info_requested',
  'approved',
  'assigned',
  'in_progress',
  'awaiting_materials',
];

export const REOPEN_WINDOW_MS = 7 * 86_400_000;

/** Rule 9: reopening is allowed within 7 days of resolution. */
export function canReopen(resolvedAt: Date | null, now: Date): boolean {
  return resolvedAt !== null && now.getTime() - resolvedAt.getTime() <= REOPEN_WINDOW_MS;
}

export type WorkOrderStatus =
  | 'open'
  | 'scheduled'
  | 'in_progress'
  | 'on_hold'
  | 'completed'
  | 'verified'
  | 'closed'
  | 'cancelled';

const WORK_ORDER_TRANSITIONS: Record<string, readonly WorkOrderStatus[]> = {
  scheduled: ['open', 'scheduled'],
  in_progress: ['open', 'scheduled', 'on_hold'],
  on_hold: ['in_progress'],
  completed: ['in_progress'],
  verified: ['completed'],
  closed: ['verified'],
  cancelled: ['open', 'scheduled', 'on_hold'],
};

export function canMoveWorkOrder(current: string, to: WorkOrderStatus): boolean {
  return (WORK_ORDER_TRANSITIONS[to] ?? []).includes(current as WorkOrderStatus);
}

export type Priority = 'low' | 'normal' | 'high' | 'urgent';

export const DEFAULT_SLA: Record<Priority, { responseMinutes: number; resolutionHours: number }> = {
  urgent: { responseMinutes: 30, resolutionHours: 4 },
  high: { responseMinutes: 120, resolutionHours: 24 },
  normal: { responseMinutes: 480, resolutionHours: 72 },
  low: { responseMinutes: 1440, resolutionHours: 168 },
};

/** Resolution due time: created + target + time spent paused. */
export function slaDueAt(createdAt: Date, resolutionHours: number, pausedMs: number): Date {
  return new Date(createdAt.getTime() + resolutionHours * 3_600_000 + pausedMs);
}

/** Paused time to add when the clock resumes. */
export function pausedFor(pausedAt: Date | null, now: Date): number {
  return pausedAt ? Math.max(0, now.getTime() - pausedAt.getTime()) : 0;
}

/**
 * Breach level now (rule 6): 1 once the due time passes (facility manager), 2 after another half of the
 * resolution target (estate manager). Paused or closed requests do not breach.
 */
export function breachLevel(
  dueAt: Date | null,
  resolutionHours: number,
  now: Date,
  paused: boolean,
): 0 | 1 | 2 {
  if (!dueAt || paused || now <= dueAt) return 0;
  return now.getTime() - dueAt.getTime() >= resolutionHours * 1_800_000 ? 2 : 1;
}

export type Frequency = 'weekly' | 'monthly' | 'quarterly' | 'annually';

/** Next run date for planned work (YYYY-MM-DD); month ends clamp (31 Jan → 28/29 Feb). */
export function nextRunDate(current: string, frequency: Frequency): string {
  const [year, month, day] = current.split('-').map(Number) as [number, number, number];
  if (frequency === 'weekly') {
    return new Date(Date.UTC(year, month - 1, day + 7)).toISOString().slice(0, 10);
  }
  const months = frequency === 'monthly' ? 1 : frequency === 'quarterly' ? 3 : 12;
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

export function formatNumber(prefix: 'MR' | 'WO', sequence: number): string {
  return `${prefix}-${String(sequence).padStart(6, '0')}`;
}
