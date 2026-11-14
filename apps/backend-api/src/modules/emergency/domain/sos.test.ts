import { describe, expect, it } from 'vitest';
import { isActiveSos, nextSosStatus, normaliseEscalation, shouldEscalate } from './sos';

describe('SOS state machine', () => {
  it.each([
    ['triggered', 'acknowledge', 'acknowledged'],
    ['triggered', 'cancel', 'cancelled'],
    ['triggered', 'assign', 'assigned'],
    ['acknowledged', 'assign', 'assigned'],
    ['assigned', 'assign', 'assigned'],
    ['acknowledged', 'responding', 'responding'],
    ['assigned', 'responding', 'responding'],
    ['responding', 'resolve', 'resolved'],
    ['triggered', 'resolve', 'resolved'],
    ['resolved', 'close', 'closed'],
    ['cancelled', 'close', 'closed'],
  ] as const)('%s --%s--> %s', (from, action, to) => {
    expect(nextSosStatus(from, action)).toBe(to);
  });

  it.each([
    ['acknowledged', 'cancel'],
    ['acknowledged', 'acknowledge'],
    ['triggered', 'responding'],
    ['resolved', 'resolve'],
    ['closed', 'close'],
    ['triggered', 'close'],
    ['cancelled', 'acknowledge'],
  ] as const)('rejects %s --%s', (from, action) => {
    expect(nextSosStatus(from, action)).toBeNull();
  });

  it('knows active statuses', () => {
    expect(isActiveSos('responding')).toBe(true);
    expect(isActiveSos('resolved')).toBe(false);
  });
});

describe('escalation', () => {
  it('sorts steps and keeps them 30 s apart', () => {
    expect(
      normaliseEscalation([
        { afterSeconds: 120, target: 'supervisor_and_managers' },
        { afterSeconds: 60, target: 'next_guard' },
        { afterSeconds: 130, target: 'emergency_contacts_voice' },
      ]).map((step) => step.afterSeconds),
    ).toEqual([60, 120, 150]);
  });
  it('fires only while unacknowledged, and drills never reach outside contacts', () => {
    expect(shouldEscalate('triggered', { afterSeconds: 60, target: 'next_guard' }, false)).toBe(
      true,
    );
    expect(shouldEscalate('acknowledged', { afterSeconds: 60, target: 'next_guard' }, false)).toBe(
      false,
    );
    expect(
      shouldEscalate('triggered', { afterSeconds: 180, target: 'emergency_contacts_voice' }, true),
    ).toBe(false);
    expect(
      shouldEscalate('triggered', { afterSeconds: 120, target: 'supervisor_and_managers' }, true),
    ).toBe(true);
  });
});
