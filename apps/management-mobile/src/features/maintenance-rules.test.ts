import { describe, expect, it } from 'vitest';
import {
  canAssignWorkOrder,
  isMaintenanceOpen,
  maintenanceActions,
  maintenanceNeedsReason,
} from './maintenance-rules';

describe('maintenanceActions', () => {
  it('returns valid triage actions for submitted and under_review', () => {
    expect(maintenanceActions('submitted')).toEqual([
      'review',
      'approve',
      'request_info',
      'reject',
    ]);
    expect(maintenanceActions('under_review')).toEqual(['approve', 'request_info', 'reject']);
  });

  it('returns execution actions for approved, in_progress and awaiting_materials', () => {
    expect(maintenanceActions('approved')).toEqual(['start', 'cancel']);
    expect(maintenanceActions('in_progress')).toEqual(['resolve', 'await_materials', 'cancel']);
    expect(maintenanceActions('awaiting_materials')).toEqual(['resume', 'cancel']);
  });

  it('allows close or reopen once resolved, and nothing on terminal statuses', () => {
    expect(maintenanceActions('resolved')).toEqual(['close', 'reopen']);
    expect(maintenanceActions('closed')).toEqual([]);
    expect(maintenanceActions('rejected')).toEqual([]);
    expect(maintenanceActions('cancelled')).toEqual([]);
  });
});

describe('maintenanceNeedsReason', () => {
  it('requires a reason for reject, request_info and reopen only', () => {
    expect(maintenanceNeedsReason('reject')).toBe(true);
    expect(maintenanceNeedsReason('request_info')).toBe(true);
    expect(maintenanceNeedsReason('reopen')).toBe(true);
    expect(maintenanceNeedsReason('approve')).toBe(false);
    expect(maintenanceNeedsReason('resolve')).toBe(false);
  });
});

describe('canAssignWorkOrder & isMaintenanceOpen', () => {
  it('allows work orders only after approval and before resolution', () => {
    expect(canAssignWorkOrder('submitted')).toBe(false);
    expect(canAssignWorkOrder('approved')).toBe(true);
    expect(canAssignWorkOrder('in_progress')).toBe(true);
    expect(canAssignWorkOrder('resolved')).toBe(false);
  });

  it('identifies open statuses accurately', () => {
    expect(isMaintenanceOpen('submitted')).toBe(true);
    expect(isMaintenanceOpen('awaiting_materials')).toBe(true);
    expect(isMaintenanceOpen('resolved')).toBe(false);
    expect(isMaintenanceOpen('closed')).toBe(false);
    expect(isMaintenanceOpen('rejected')).toBe(false);
    expect(isMaintenanceOpen('cancelled')).toBe(false);
  });
});
