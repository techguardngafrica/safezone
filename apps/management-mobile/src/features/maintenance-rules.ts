import type { Tone } from '@safezone/mobile-ui';

export type MaintenanceStatus =
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

export type MaintenancePriority = 'low' | 'normal' | 'high' | 'urgent';

export type MaintenanceAction =
  | 'review'
  | 'approve'
  | 'reject'
  | 'request_info'
  | 'start'
  | 'await_materials'
  | 'resume'
  | 'resolve'
  | 'close'
  | 'reopen'
  | 'cancel';

export const MAINTENANCE_STATUS_TONE: Record<MaintenanceStatus, Tone> = {
  submitted: 'info',
  under_review: 'info',
  info_requested: 'warning',
  approved: 'info',
  assigned: 'info',
  in_progress: 'warning',
  awaiting_materials: 'warning',
  resolved: 'success',
  closed: 'neutral',
  rejected: 'danger',
  cancelled: 'neutral',
};

export const MAINTENANCE_PRIORITY_TONE: Record<MaintenancePriority, Tone> = {
  low: 'neutral',
  normal: 'info',
  high: 'warning',
  urgent: 'danger',
};

const ACTIONS_BY_STATUS: Record<MaintenanceStatus, readonly MaintenanceAction[]> = {
  submitted: ['review', 'approve', 'request_info', 'reject'],
  under_review: ['approve', 'request_info', 'reject'],
  info_requested: ['review', 'approve', 'reject', 'cancel'],
  approved: ['start', 'cancel'],
  assigned: ['start', 'cancel'],
  in_progress: ['resolve', 'await_materials', 'cancel'],
  awaiting_materials: ['resume', 'cancel'],
  resolved: ['close', 'reopen'],
  closed: [],
  rejected: [],
  cancelled: [],
};

/** Valid management transitions from the current maintenance status. */
export function maintenanceActions(status: MaintenanceStatus): readonly MaintenanceAction[] {
  return ACTIONS_BY_STATUS[status];
}

/** True when the action requires a mandatory reason of at least 3 characters. */
export function maintenanceNeedsReason(action: MaintenanceAction): boolean {
  return action === 'reject' || action === 'request_info' || action === 'reopen';
}

/** True when a work order can be created for this request. */
export function canAssignWorkOrder(status: MaintenanceStatus): boolean {
  return (
    status === 'approved' ||
    status === 'assigned' ||
    status === 'in_progress' ||
    status === 'awaiting_materials'
  );
}

/** True when the request is considered open (for the Home stat tile and Open filter). */
export function isMaintenanceOpen(status: MaintenanceStatus): boolean {
  return (
    status !== 'resolved' && status !== 'closed' && status !== 'rejected' && status !== 'cancelled'
  );
}
