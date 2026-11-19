import { describe, expect, it } from 'vitest';
import {
  acceptsAdditions,
  nextIncidentStatus,
  notifiesImmediately,
  occurredAtValid,
  reporterTypeOf,
  type IncidentAction,
  type IncidentStatus,
} from './incidents';

describe('incident state machine', () => {
  const allowed: [IncidentStatus, IncidentAction, IncidentStatus][] = [
    ['reported', 'review', 'under_review'],
    ['reported', 'assign', 'assigned'],
    ['under_review', 'assign', 'assigned'],
    ['assigned', 'assign', 'assigned'],
    ['reported', 'resolve', 'resolved'],
    ['under_review', 'resolve', 'resolved'],
    ['assigned', 'resolve', 'resolved'],
    ['resolved', 'reopen', 'under_review'],
    ['resolved', 'close', 'closed'],
  ];
  it.each(allowed)('%s + %s → %s', (from, action, to) => {
    expect(nextIncidentStatus(from, action)).toBe(to);
  });

  const rejected: [IncidentStatus, IncidentAction][] = [
    ['under_review', 'review'],
    ['assigned', 'review'],
    ['resolved', 'review'],
    ['closed', 'review'],
    ['resolved', 'assign'],
    ['closed', 'assign'],
    ['resolved', 'resolve'],
    ['closed', 'resolve'],
    ['reported', 'reopen'],
    ['closed', 'reopen'],
    ['reported', 'close'],
    ['assigned', 'close'],
    ['closed', 'close'],
  ];
  it.each(rejected)('rejects %s + %s', (from, action) => {
    expect(nextIncidentStatus(from, action)).toBeNull();
  });

  it('rejects unknown statuses', () => {
    expect(nextIncidentStatus('deleted', 'close')).toBeNull();
  });
});

describe('incident rules', () => {
  it('takes additions until closed', () => {
    expect(acceptsAdditions('resolved')).toBe(true);
    expect(acceptsAdditions('closed')).toBe(false);
  });

  it('derives the reporter type from roles', () => {
    expect(reporterTypeOf(new Set(['incident.manage', 'incident.report']), true)).toBe('manager');
    expect(reporterTypeOf(new Set(['gate.verify', 'incident.report']), true)).toBe('guard');
    expect(reporterTypeOf(new Set(['incident.report']), false)).toBe('resident');
    // A resident role never counts as staff, whatever its permissions.
    expect(reporterTypeOf(new Set(['incident.manage']), false)).toBe('resident');
  });

  it('notifies immediately only for critical incidents', () => {
    expect(notifiesImmediately('critical')).toBe(true);
    expect(notifiesImmediately('high')).toBe(false);
  });

  it('rejects incidents dated in the future beyond clock skew', () => {
    const now = new Date('2026-11-19T10:00:00Z');
    expect(occurredAtValid(new Date('2026-11-19T10:04:00Z'), now)).toBe(true);
    expect(occurredAtValid(new Date('2026-11-19T10:06:00Z'), now)).toBe(false);
  });
});
