import { describe, expect, it } from 'vitest';
import { canAssignIncident, incidentActions, needsText } from './incident-rules';
import { sosActions } from './sos-rules';

describe('incidentActions', () => {
  it('offers review and resolve on a new report', () => {
    expect(incidentActions('reported')).toEqual(['review', 'resolve']);
  });

  it('offers resolve while under review or assigned', () => {
    expect(incidentActions('under_review')).toEqual(['resolve']);
    expect(incidentActions('assigned')).toEqual(['resolve']);
  });

  it('offers reopen and close once resolved, and nothing once closed', () => {
    expect(incidentActions('resolved')).toEqual(['reopen', 'close']);
    expect(incidentActions('closed')).toEqual([]);
  });

  it('needs text only to resolve', () => {
    expect(needsText('resolve')).toBe(true);
    expect(needsText('close')).toBe(false);
  });

  it('allows assignment while open, and blocks it once resolved or closed', () => {
    expect(canAssignIncident('reported')).toBe(true);
    expect(canAssignIncident('under_review')).toBe(true);
    expect(canAssignIncident('assigned')).toBe(true);
    expect(canAssignIncident('resolved')).toBe(false);
    expect(canAssignIncident('closed')).toBe(false);
  });
});

describe('sosActions', () => {
  it('only offers acknowledge (and a note) on a new alert', () => {
    expect(sosActions('triggered')).toEqual({
      acknowledge: true,
      responding: false,
      resolve: false,
      close: false,
      note: true,
    });
  });

  it('offers responding and resolve once acknowledged or assigned', () => {
    for (const status of ['acknowledged', 'assigned'] as const)
      expect(sosActions(status)).toMatchObject({ responding: true, resolve: true });
  });

  it('offers resolve but not responding while responding', () => {
    expect(sosActions('responding')).toMatchObject({ responding: false, resolve: true });
  });

  it('offers close only after resolve, and nothing once closed or cancelled', () => {
    expect(sosActions('resolved')).toMatchObject({ close: true, resolve: false, note: true });
    for (const status of ['closed', 'cancelled'] as const)
      expect(Object.values(sosActions(status)).some(Boolean)).toBe(false);
  });
});
