import type { AdCampaignStatus } from '@safezone/schemas';
import { describe, expect, it } from 'vitest';
import {
  approvalProblems,
  campaignCan,
  contextAllowed,
  ctr,
  groupByAudience,
  pickWeighted,
  scheduleStep,
  statusAfterApproval,
  targetsEstate,
  vatKobo,
} from './advertising';

const okApproval = {
  arconRef: 'ARCON/2026/1234',
  advertiser: { verificationStatus: 'verified', status: 'active', category: 'retail' as const },
  restrictedNote: null,
  creativeStatuses: ['approved'],
  endsAt: new Date('2026-12-31'),
  now: new Date('2026-12-01'),
};

describe('contexts', () => {
  it('serves only listed screens and never the Security App', () => {
    expect(contextAllowed('resident.home.banner', 'home', 'resident-mobile')).toBe(true);
    for (const blocked of [
      'sos',
      'visitor_pass',
      'gate',
      'payment_confirmation',
      'onboarding',
      'messages',
    ])
      expect(contextAllowed('resident.home.banner', blocked, 'resident-mobile')).toBe(false);
    expect(contextAllowed('resident.home.banner', 'home', 'security-mobile')).toBe(false);
    expect(contextAllowed('unknown.placement', 'home', 'resident-mobile')).toBe(false);
  });
});

describe('campaign state machine', () => {
  const ALL: AdCampaignStatus[] = [
    'draft',
    'submitted',
    'under_review',
    'awaiting_payment',
    'approved',
    'scheduled',
    'active',
    'paused',
    'completed',
    'rejected',
    'cancelled',
  ];

  it('allows each action only from its listed statuses', () => {
    expect(ALL.filter((s) => campaignCan('approve', s))).toEqual(['submitted', 'under_review']);
    expect(ALL.filter((s) => campaignCan('resume', s))).toEqual(['paused']);
    expect(ALL.filter((s) => campaignCan('mark_paid', s))).toEqual(['awaiting_payment']);
    expect(campaignCan('cancel', 'completed')).toBe(false);
    expect(campaignCan('cancel', 'cancelled')).toBe(false);
    expect(campaignCan('submit', 'rejected')).toBe(true);
  });

  it('waits for payment unless paid or on credit', () => {
    expect(statusAfterApproval(false)).toBe('awaiting_payment');
    expect(statusAfterApproval(true)).toBe('approved');
  });

  it('schedules, activates and completes on the clock', () => {
    const startsAt = new Date('2026-12-05T00:00:00Z');
    const endsAt = new Date('2026-12-10T00:00:00Z');
    const at = (iso: string) => new Date(iso);
    expect(scheduleStep({ status: 'approved', startsAt, endsAt }, at('2026-12-01T00:00:00Z'))).toBe(
      'schedule',
    );
    expect(scheduleStep({ status: 'approved', startsAt, endsAt }, at('2026-12-06T00:00:00Z'))).toBe(
      'activate',
    );
    expect(
      scheduleStep({ status: 'scheduled', startsAt, endsAt }, at('2026-12-05T00:00:00Z')),
    ).toBe('activate');
    expect(
      scheduleStep({ status: 'active', startsAt, endsAt }, at('2026-12-07T00:00:00Z')),
    ).toBeNull();
    expect(scheduleStep({ status: 'active', startsAt, endsAt }, endsAt)).toBe('complete');
    expect(
      scheduleStep({ status: 'awaiting_payment', startsAt, endsAt }, at('2026-12-06T00:00:00Z')),
    ).toBeNull();
  });
});

describe('approval gates', () => {
  it('passes a complete campaign', () => {
    expect(approvalProblems(okApproval)).toEqual([]);
  });

  it('refuses without an ARCON reference', () => {
    expect(approvalProblems({ ...okApproval, arconRef: null })).toContain('no_arcon_ref');
    expect(approvalProblems({ ...okApproval, arconRef: '  ' })).toContain('no_arcon_ref');
  });

  it('refuses banned categories and restricted ones without a note', () => {
    const tobacco = {
      ...okApproval,
      advertiser: { ...okApproval.advertiser, category: 'tobacco' as const },
    };
    expect(approvalProblems(tobacco)).toContain('banned_category');
    const alcohol = {
      ...okApproval,
      advertiser: { ...okApproval.advertiser, category: 'alcohol' as const },
    };
    expect(approvalProblems(alcohol)).toContain('restricted_needs_note');
    expect(approvalProblems({ ...alcohol, restrictedNote: 'Adults only, licensed brand' })).toEqual(
      [],
    );
  });

  it('needs every creative approved and a verified, active advertiser', () => {
    expect(approvalProblems({ ...okApproval, creativeStatuses: [] })).toContain('no_creatives');
    expect(
      approvalProblems({ ...okApproval, creativeStatuses: ['approved', 'pending'] }),
    ).toContain('creatives_not_approved');
    expect(
      approvalProblems({
        ...okApproval,
        advertiser: { ...okApproval.advertiser, status: 'suspended' },
      }),
    ).toContain('advertiser_suspended');
    expect(
      approvalProblems({
        ...okApproval,
        advertiser: { ...okApproval.advertiser, verificationStatus: 'unverified' },
      }),
    ).toContain('advertiser_not_verified');
  });
});

describe('targeting and selection', () => {
  const estate = { id: 'est-1', state: 'Lagos' };
  it('matches all, listed estates or the estate state', () => {
    expect(targetsEstate({ scope: 'all', estateIds: [], states: [] }, estate)).toBe(true);
    expect(targetsEstate({ scope: 'estates', estateIds: ['est-2'], states: [] }, estate)).toBe(
      false,
    );
    expect(targetsEstate({ scope: 'states', estateIds: [], states: ['lagos'] }, estate)).toBe(true);
    expect(
      targetsEstate(
        { scope: 'states', estateIds: [], states: ['Abuja'] },
        { id: 'x', state: null },
      ),
    ).toBe(false);
  });

  it('picks by weight', () => {
    const items = [
      { id: 'a', weight: 1 },
      { id: 'b', weight: 3 },
    ];
    expect(pickWeighted(items, 0)?.id).toBe('a');
    expect(pickWeighted(items, 0.24)?.id).toBe('a');
    expect(pickWeighted(items, 0.25)?.id).toBe('b');
    expect(pickWeighted(items, 0.999)?.id).toBe('b');
    expect(pickWeighted([], 0.5)).toBeNull();
  });
});

describe('money and reports', () => {
  it('adds 7.5% VAT in whole kobo', () => {
    expect(vatKobo(10_000_000)).toBe(750_000);
    expect(vatKobo(333)).toBe(25);
    expect(() => vatKobo(0)).toThrow(RangeError);
  });

  it('never shows an estate with fewer than 200 unique users on its own', () => {
    const rows = groupByAudience(
      [
        { estateName: 'Big Estate', impressions: 5000, clicks: 50, uniqueUsers: 900 },
        { estateName: 'Small Estate', impressions: 300, clicks: 3, uniqueUsers: 40 },
        { estateName: 'Tiny Estate', impressions: 100, clicks: 1, uniqueUsers: 199 },
      ],
      'Other estates',
    );
    expect(rows).toEqual([
      { estateName: 'Big Estate', impressions: 5000, clicks: 50 },
      { estateName: 'Other estates', impressions: 400, clicks: 4 },
    ]);
  });

  it('computes CTR as a percentage to two places', () => {
    expect(ctr(0, 0)).toBe(0);
    expect(ctr(3000, 45)).toBe(1.5);
  });
});
