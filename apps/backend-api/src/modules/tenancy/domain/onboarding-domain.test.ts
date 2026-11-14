import { describe, expect, it } from 'vitest';
import { nextApplicationStatus, isOpenApplication } from './application-status';
import { generateEstateCode, generateEstateSlug } from './codes';
import { distanceMetres, findDuplicates, nameSimilarity } from './duplicates';
import { nextEstateStatus } from './estate-lifecycle';
import { missingSetupSteps } from './setup';

describe('application status machine', () => {
  it.each([
    ['submitted', 'start_review', 'under_review'],
    ['submitted', 'request_info', 'info_requested'],
    ['under_review', 'request_info', 'info_requested'],
    ['info_requested', 'resubmit', 'submitted'],
    ['submitted', 'approve', 'approved'],
    ['under_review', 'approve', 'approved'],
    ['under_review', 'reject', 'rejected'],
    ['info_requested', 'reject', 'rejected'],
    ['info_requested', 'withdraw', 'withdrawn'],
    ['submitted', 'withdraw', 'withdrawn'],
  ] as const)('%s --%s--> %s', (from, action, to) => {
    expect(nextApplicationStatus(from, action)).toBe(to);
  });

  it.each([
    ['info_requested', 'approve'],
    ['approved', 'reject'],
    ['rejected', 'approve'],
    ['withdrawn', 'resubmit'],
    ['approved', 'withdraw'],
    ['under_review', 'start_review'],
    ['submitted', 'resubmit'],
    ['nonsense', 'approve'],
  ] as const)('rejects %s --%s', (from, action) => {
    expect(nextApplicationStatus(from, action)).toBeNull();
  });

  it('knows which applications are still open', () => {
    expect(isOpenApplication('info_requested')).toBe(true);
    expect(isOpenApplication('approved')).toBe(false);
  });
});

describe('estate lifecycle', () => {
  it('activates only approved estates', () => {
    expect(nextEstateStatus('approved', 'activate', false)).toBe('active');
    expect(nextEstateStatus('active', 'activate', true)).toBeNull();
    expect(nextEstateStatus('suspended', 'activate', true)).toBeNull();
  });
  it('suspends and reactivates to the right status', () => {
    expect(nextEstateStatus('active', 'suspend', true)).toBe('suspended');
    expect(nextEstateStatus('approved', 'suspend', false)).toBe('suspended');
    expect(nextEstateStatus('suspended', 'reactivate', true)).toBe('active');
    expect(nextEstateStatus('suspended', 'reactivate', false)).toBe('approved');
    expect(nextEstateStatus('active', 'reactivate', true)).toBeNull();
    expect(nextEstateStatus('deactivated', 'suspend', true)).toBeNull();
  });
  it('deactivates from any live status, once', () => {
    for (const status of ['approved', 'active', 'suspended'])
      expect(nextEstateStatus(status, 'deactivate', true)).toBe('deactivated');
    expect(nextEstateStatus('deactivated', 'deactivate', true)).toBeNull();
    expect(nextEstateStatus('deactivated', 'reactivate', true)).toBeNull();
  });
});

describe('duplicate check', () => {
  const lekki = { lat: 6.4474, lng: 3.4723 };
  const nearby = { lat: 6.4489, lng: 3.4741 }; // about 250 m away
  const ikeja = { lat: 6.6018, lng: 3.3515 };

  it('measures distance', () => {
    expect(distanceMetres(lekki, nearby)).toBeGreaterThan(150);
    expect(distanceMetres(lekki, nearby)).toBeLessThan(400);
    expect(distanceMetres(lekki, ikeja)).toBeGreaterThan(15_000);
  });

  it('ignores filler words when comparing names', () => {
    expect(nameSimilarity('Palm Grove Estate', 'The Palm Grove Estates')).toBe(1);
    expect(nameSimilarity('Palm Grove', 'Cedar Court')).toBe(0);
  });

  it('flags same names in the same state and similar names nearby', () => {
    const matches = findDuplicates({ name: 'Palm Grove Estate', state: 'Lagos', location: lekki }, [
      { kind: 'estate', id: 'a', name: 'Palm Grove', state: 'lagos', location: ikeja },
      { kind: 'application', id: 'b', name: 'Palm Springs', state: 'Lagos', location: nearby },
      { kind: 'estate', id: 'c', name: 'Palm Grove', state: 'Abuja', location: null },
      { kind: 'estate', id: 'd', name: 'Cedar Court', state: 'Lagos', location: nearby },
      { kind: 'estate', id: 'e', name: 'Palm Springs', state: 'Lagos', location: ikeja },
    ]);
    expect(matches.map((match) => [match.id, match.reason])).toEqual([
      ['a', 'same_name'],
      ['b', 'similar_name_nearby'],
    ]);
  });
});

describe('codes', () => {
  it('makes readable join codes and slugs', () => {
    for (let index = 0; index < 50; index += 1) {
      expect(generateEstateCode()).toMatch(/^[A-HJ-KM-NP-Z2-9]{6}$/);
    }
    expect(generateEstateSlug('Palm Grove Estate, Lekki!')).toMatch(
      /^palm-grove-estate-lekki-[a-z2-9]{4}$/,
    );
    expect(generateEstateSlug('***')).toMatch(/^estate-[a-z2-9]{4}$/);
  });
});

describe('setup steps', () => {
  it('lists required steps still missing', () => {
    expect(missingSetupSteps(new Set(['profile', 'spaces', 'sos_policy']))).toEqual([
      'gates',
      'security_supervisor',
    ]);
    expect(
      missingSetupSteps(new Set(['spaces', 'gates', 'security_supervisor', 'sos_policy'])),
    ).toEqual([]);
  });
});

describe('suspension', () => {
  it('blocks management writes but not reads or safety actions', async () => {
    const { blockedBySuspension } = await import('./estate-lifecycle.js');
    expect(blockedBySuspension('suspended', 'PATCH', 'estate.configure')).toBe(true);
    expect(blockedBySuspension('suspended', 'POST', null)).toBe(true);
    expect(blockedBySuspension('suspended', 'GET', 'estate.configure')).toBe(false);
    expect(blockedBySuspension('suspended', 'POST', 'gate.verify')).toBe(false);
    expect(blockedBySuspension('suspended', 'POST', 'sos.trigger')).toBe(false);
    expect(blockedBySuspension('active', 'PATCH', 'estate.configure')).toBe(false);
  });
});
