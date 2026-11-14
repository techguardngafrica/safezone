import { describe, expect, it } from 'vitest';
import {
  breachLevel,
  canMoveWorkOrder,
  canReopen,
  formatNumber,
  nextRequestStatus,
  nextRunDate,
  pausedFor,
  slaDueAt,
} from './maintenance';

describe('request status machine', () => {
  it('follows the documented path', () => {
    expect(nextRequestStatus('submitted', 'review')).toBe('under_review');
    expect(nextRequestStatus('under_review', 'request_info')).toBe('info_requested');
    expect(nextRequestStatus('info_requested', 'respond')).toBe('under_review');
    expect(nextRequestStatus('under_review', 'approve')).toBe('approved');
    expect(nextRequestStatus('approved', 'assign')).toBe('assigned');
    expect(nextRequestStatus('assigned', 'start')).toBe('in_progress');
    expect(nextRequestStatus('in_progress', 'await_materials')).toBe('awaiting_materials');
    expect(nextRequestStatus('awaiting_materials', 'resume')).toBe('in_progress');
    expect(nextRequestStatus('in_progress', 'resolve')).toBe('resolved');
    expect(nextRequestStatus('resolved', 'reopen')).toBe('in_progress');
    expect(nextRequestStatus('resolved', 'close')).toBe('closed');
  });

  it('rejects invalid moves', () => {
    expect(nextRequestStatus('closed', 'reopen')).toBeNull();
    expect(nextRequestStatus('in_progress', 'cancel')).toBeNull();
    expect(nextRequestStatus('resolved', 'approve')).toBeNull();
    expect(nextRequestStatus('rejected', 'start')).toBeNull();
    expect(nextRequestStatus('submitted', 'resolve')).toBeNull();
    expect(nextRequestStatus('cancelled', 'respond')).toBeNull();
  });

  it('allows reopening only within 7 days', () => {
    const resolved = new Date('2027-01-01T10:00:00Z');
    expect(canReopen(resolved, new Date('2027-01-08T10:00:00Z'))).toBe(true);
    expect(canReopen(resolved, new Date('2027-01-08T10:00:01Z'))).toBe(false);
    expect(canReopen(null, new Date())).toBe(false);
  });
});

describe('work orders', () => {
  it('moves through scheduling to verification', () => {
    expect(canMoveWorkOrder('open', 'scheduled')).toBe(true);
    expect(canMoveWorkOrder('scheduled', 'in_progress')).toBe(true);
    expect(canMoveWorkOrder('in_progress', 'on_hold')).toBe(true);
    expect(canMoveWorkOrder('on_hold', 'in_progress')).toBe(true);
    expect(canMoveWorkOrder('in_progress', 'completed')).toBe(true);
    expect(canMoveWorkOrder('completed', 'verified')).toBe(true);
    expect(canMoveWorkOrder('verified', 'closed')).toBe(true);
  });

  it('rejects skipping steps or reviving finished work', () => {
    expect(canMoveWorkOrder('open', 'completed')).toBe(false);
    expect(canMoveWorkOrder('completed', 'cancelled')).toBe(false);
    expect(canMoveWorkOrder('closed', 'in_progress')).toBe(false);
    expect(canMoveWorkOrder('scheduled', 'verified')).toBe(false);
  });
});

describe('SLA', () => {
  const created = new Date('2027-01-01T08:00:00Z');

  it('adds paused time to the due time', () => {
    expect(slaDueAt(created, 4, 0).toISOString()).toBe('2027-01-01T12:00:00.000Z');
    expect(slaDueAt(created, 4, 3_600_000).toISOString()).toBe('2027-01-01T13:00:00.000Z');
    expect(pausedFor(new Date('2027-01-01T09:00:00Z'), new Date('2027-01-01T09:30:00Z'))).toBe(
      1_800_000,
    );
    expect(pausedFor(null, new Date())).toBe(0);
  });

  it('breaches at the due time and escalates after half the target again', () => {
    const due = slaDueAt(created, 4, 0);
    expect(breachLevel(due, 4, new Date('2027-01-01T11:59:00Z'), false)).toBe(0);
    expect(breachLevel(due, 4, new Date('2027-01-01T12:01:00Z'), false)).toBe(1);
    expect(breachLevel(due, 4, new Date('2027-01-01T14:00:00Z'), false)).toBe(2);
    expect(breachLevel(due, 4, new Date('2027-01-01T14:00:00Z'), true)).toBe(0);
  });
});

describe('planned work', () => {
  it('advances by frequency and clamps month ends', () => {
    expect(nextRunDate('2027-01-31', 'monthly')).toBe('2027-02-28');
    expect(nextRunDate('2028-01-31', 'monthly')).toBe('2028-02-29');
    expect(nextRunDate('2027-11-15', 'quarterly')).toBe('2028-02-15');
    expect(nextRunDate('2027-12-29', 'weekly')).toBe('2028-01-05');
    expect(nextRunDate('2027-03-01', 'annually')).toBe('2028-03-01');
    expect(formatNumber('WO', 7)).toBe('WO-000007');
  });
});
