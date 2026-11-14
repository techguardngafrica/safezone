/** Self-service application lifecycle (tenancy.md §4.1). */
export const APPLICATION_STATUSES = [
  'submitted',
  'under_review',
  'info_requested',
  'approved',
  'rejected',
  'withdrawn',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export type ApplicationAction =
  'start_review' | 'request_info' | 'resubmit' | 'approve' | 'reject' | 'withdraw';

const TRANSITIONS: Record<
  ApplicationAction,
  { from: readonly ApplicationStatus[]; to: ApplicationStatus }
> = {
  start_review: { from: ['submitted'], to: 'under_review' },
  request_info: { from: ['submitted', 'under_review'], to: 'info_requested' },
  resubmit: { from: ['info_requested'], to: 'submitted' },
  approve: { from: ['submitted', 'under_review'], to: 'approved' },
  reject: { from: ['submitted', 'under_review', 'info_requested'], to: 'rejected' },
  withdraw: { from: ['submitted', 'under_review', 'info_requested'], to: 'withdrawn' },
};

/** The next status, or null when the action is not allowed from `current`. */
export function nextApplicationStatus(
  current: string,
  action: ApplicationAction,
): ApplicationStatus | null {
  const rule = TRANSITIONS[action];
  return (rule.from as readonly string[]).includes(current) ? rule.to : null;
}

export function isOpenApplication(status: string): boolean {
  return status === 'submitted' || status === 'under_review' || status === 'info_requested';
}
