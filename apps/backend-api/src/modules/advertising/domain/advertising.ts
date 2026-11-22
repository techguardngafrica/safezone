import type { AdCampaignStatus, AdCategory, AdTargeting } from '@safezone/schemas';

/** Advertising rules (advertising.md §4 to §7, ADR-0024). Pure functions: no I/O, no clock reads. */

// ---- Contexts -----------------------------------------------------------------------------------

/** The only screens that may show ads; every other context (SOS, passes, gate, payment…) gets none. */
export const AD_ALLOWED_CONTEXTS: Readonly<Record<string, readonly string[]>> = {
  'resident.home.banner': ['home'],
  'resident.feed.sponsored': ['community_feed'],
  'resident.marketplace.banner': ['marketplace'],
  'resident.discovery.sponsored': ['discovery', 'marketplace'],
  'management.dashboard.info': ['dashboard'],
};

/** Apps that never show ads at all (the Security App, AGENTS.md §6.2). */
export const AD_FREE_APPS: ReadonlySet<string> = new Set(['security-mobile']);

export function contextAllowed(placement: string, context: string, app: string): boolean {
  if (AD_FREE_APPS.has(app)) return false;
  return AD_ALLOWED_CONTEXTS[placement]?.includes(context) ?? false;
}

// ---- Categories ---------------------------------------------------------------------------------

export const BANNED_CATEGORIES: ReadonlySet<AdCategory> = new Set(['tobacco']);
export const RESTRICTED_CATEGORIES: ReadonlySet<AdCategory> = new Set([
  'alcohol',
  'gambling',
  'political',
]);

// ---- Campaign state machine ---------------------------------------------------------------------

export type CampaignAction =
  | 'submit'
  | 'approve'
  | 'mark_paid'
  | 'reject'
  | 'schedule'
  | 'activate'
  | 'pause'
  | 'resume'
  | 'complete'
  | 'cancel';

const FROM: Readonly<Record<CampaignAction, readonly AdCampaignStatus[]>> = {
  submit: ['draft', 'rejected'],
  approve: ['submitted', 'under_review'],
  mark_paid: ['awaiting_payment'],
  reject: ['submitted', 'under_review', 'awaiting_payment'],
  schedule: ['approved'],
  activate: ['approved', 'scheduled'],
  pause: ['active', 'scheduled'],
  resume: ['paused'],
  complete: ['active', 'paused', 'scheduled', 'approved'],
  cancel: [
    'draft',
    'submitted',
    'under_review',
    'awaiting_payment',
    'approved',
    'scheduled',
    'active',
    'paused',
  ],
};

export function campaignCan(action: CampaignAction, status: AdCampaignStatus): boolean {
  return FROM[action].includes(status);
}

/** Where approval leads: straight to approved when paid or on credit, else awaiting payment. */
export function statusAfterApproval(settled: boolean): AdCampaignStatus {
  return settled ? 'approved' : 'awaiting_payment';
}

/** What the minute job does with an approved, scheduled or running campaign at `now`. */
export function scheduleStep(
  campaign: { status: AdCampaignStatus; startsAt: Date; endsAt: Date },
  now: Date,
): 'activate' | 'schedule' | 'complete' | null {
  const { status, startsAt, endsAt } = campaign;
  if (now >= endsAt && ['approved', 'scheduled', 'active', 'paused'].includes(status))
    return 'complete';
  if (status === 'approved') return now >= startsAt ? 'activate' : 'schedule';
  if (status === 'scheduled' && now >= startsAt) return 'activate';
  return null;
}

export type ApprovalProblem =
  | 'no_arcon_ref'
  | 'advertiser_not_verified'
  | 'advertiser_suspended'
  | 'banned_category'
  | 'restricted_needs_note'
  | 'no_creatives'
  | 'creatives_not_approved'
  | 'already_ended';

/** advertising.md rules 2, 4 and 12: everything that must hold before a campaign can be approved. */
export function approvalProblems(input: {
  arconRef: string | null;
  advertiser: { verificationStatus: string; status: string; category: AdCategory };
  restrictedNote: string | null;
  creativeStatuses: readonly string[];
  endsAt: Date;
  now: Date;
}): ApprovalProblem[] {
  const problems: ApprovalProblem[] = [];
  if (!input.arconRef?.trim()) problems.push('no_arcon_ref');
  if (input.advertiser.verificationStatus !== 'verified') problems.push('advertiser_not_verified');
  if (input.advertiser.status !== 'active') problems.push('advertiser_suspended');
  if (BANNED_CATEGORIES.has(input.advertiser.category)) problems.push('banned_category');
  if (RESTRICTED_CATEGORIES.has(input.advertiser.category) && !input.restrictedNote?.trim())
    problems.push('restricted_needs_note');
  if (input.creativeStatuses.length === 0) problems.push('no_creatives');
  else if (input.creativeStatuses.some((s) => s !== 'approved'))
    problems.push('creatives_not_approved');
  if (input.endsAt <= input.now) problems.push('already_ended');
  return problems;
}

// ---- Targeting and selection --------------------------------------------------------------------

export function targetsEstate(
  targeting: AdTargeting,
  estate: { id: string; state: string | null },
): boolean {
  if (targeting.scope === 'all') return true;
  if (targeting.scope === 'estates') return targeting.estateIds.includes(estate.id);
  const state = estate.state?.trim().toLowerCase();
  return state !== undefined && targeting.states.some((s) => s.trim().toLowerCase() === state);
}

/** Weighted choice; `random` is in [0, 1). Returns null for an empty list. */
export function pickWeighted<T extends { weight: number }>(
  items: readonly T[],
  random: number,
): T | null {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
  if (total <= 0) return null;
  let point = random * total;
  for (const item of items) {
    point -= Math.max(0, item.weight);
    if (point < 0) return item;
  }
  return items.at(-1) ?? null;
}

// ---- Money and reports --------------------------------------------------------------------------

/** Nigerian VAT at 7.5%, rounded to the kobo. */
export function vatKobo(amountKobo: number): number {
  if (!Number.isSafeInteger(amountKobo) || amountKobo <= 0) throw new RangeError('amount');
  return Math.round((amountKobo * 75) / 1000);
}

export const MINIMUM_AUDIENCE = 200;

/**
 * Per-estate rows only for estates with at least MINIMUM_AUDIENCE unique users; the rest are summed into
 * one "Other estates" row so no small audience can be singled out (rule 5).
 */
export function groupByAudience(
  rows: readonly { estateName: string; impressions: number; clicks: number; uniqueUsers: number }[],
  otherLabel: string,
): { estateName: string; impressions: number; clicks: number }[] {
  const shown = rows
    .filter((r) => r.uniqueUsers >= MINIMUM_AUDIENCE)
    .map(({ estateName, impressions, clicks }) => ({ estateName, impressions, clicks }));
  const rest = rows.filter((r) => r.uniqueUsers < MINIMUM_AUDIENCE);
  if (rest.length > 0)
    shown.push({
      estateName: otherLabel,
      impressions: rest.reduce((s, r) => s + r.impressions, 0),
      clicks: rest.reduce((s, r) => s + r.clicks, 0),
    });
  return shown;
}

export function ctr(impressions: number, clicks: number): number {
  return impressions === 0 ? 0 : Math.round((clicks / impressions) * 10_000) / 100;
}
