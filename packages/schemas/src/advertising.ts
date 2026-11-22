import { z } from 'zod';
import { koboSchema, positiveKoboSchema } from './billing';

/**
 * Managed advertising (advertising.md, Phase 4; ADR-0024). Money is integer kobo. Reports are aggregate:
 * no resident personal data ever reaches an advertiser.
 */

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const cursorQuery = {
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
};

// ---- Placements and contexts --------------------------------------------------------------------

export const AD_PLACEMENT_KEYS = [
  'resident.home.banner',
  'resident.feed.sponsored',
  'resident.marketplace.banner',
  'resident.discovery.sponsored',
  'management.dashboard.info',
] as const;
export const adPlacementKeySchema = z.enum(AD_PLACEMENT_KEYS);
export type AdPlacementKey = z.infer<typeof adPlacementKeySchema>;

/** Screens that may ask for an ad. Anything else (SOS, passes, gate, payment, onboarding, messages) gets none. */
export const AD_CONTEXTS = [
  'home',
  'community_feed',
  'marketplace',
  'discovery',
  'dashboard',
] as const;
export const adContextSchema = z.string().trim().min(1).max(60);

export const AD_CATEGORIES = [
  'home_services',
  'retail',
  'food_and_drink',
  'real_estate',
  'finance',
  'education',
  'health',
  'automotive',
  'telecoms',
  'events',
  'public_service',
  'alcohol',
  'gambling',
  'political',
  'tobacco',
  'other',
] as const;
export const adCategorySchema = z.enum(AD_CATEGORIES);
export type AdCategory = z.infer<typeof adCategorySchema>;

export const adPlacementSchema = z.object({
  key: adPlacementKeySchema,
  surface: z.string(),
  formats: z.array(z.string()),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  maxFileKb: z.number().int(),
  frequencyCapPerDay: z.number().int(),
  active: z.boolean(),
});
export const updateAdPlacementSchema = z.object({
  active: z.boolean().optional(),
  frequencyCapPerDay: z.number().int().min(1).max(50).optional(),
});

// ---- Enquiries ----------------------------------------------------------------------------------

export const adEnquiryStatusSchema = z.enum([
  'submitted',
  'under_review',
  'awaiting_information',
  'proposal_sent',
  'negotiation',
  'approved',
  'rejected',
  'converted_to_campaign',
]);
export const adBudgetRangeSchema = z.enum([
  'under_100k',
  '100k_500k',
  '500k_2m',
  '2m_10m',
  'over_10m',
  'not_sure',
]);

export const createAdEnquirySchema = z.object({
  advertiserType: z.enum(['individual', 'organisation']),
  contactName: text(2, 120),
  orgName: text(2, 160).optional(),
  phone: z.string().trim().min(7).max(20),
  email: z.email().max(200),
  category: adCategorySchema,
  objectives: text(3, 500),
  description: text(10, 4000),
  budgetRange: adBudgetRangeSchema,
  durationWeeks: z.number().int().min(1).max(52).optional(),
  audience: z.string().trim().max(1000).optional(),
  placements: z.array(adPlacementKeySchema).max(5).default([]),
  /** The person accepts the advertising policy and privacy notice. */
  consent: z.literal(true),
});

export const adEnquirySchema = z.object({
  id: z.uuid(),
  source: z.enum(['web', 'resident_app']),
  advertiserType: z.enum(['individual', 'organisation']),
  contactName: z.string(),
  orgName: z.string().nullable(),
  category: adCategorySchema,
  objectives: z.string(),
  description: z.string(),
  budgetRange: adBudgetRangeSchema,
  durationWeeks: z.number().int().nullable(),
  audience: z.string().nullable(),
  placements: z.array(adPlacementKeySchema),
  status: adEnquiryStatusSchema,
  advertiserId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
/** Techguard's view adds the contact details and internal notes. */
export const platformAdEnquirySchema = adEnquirySchema.extend({
  phone: z.string(),
  email: z.string(),
  notes: z.string().nullable(),
  assigneeId: z.uuid().nullable(),
});
export const updateAdEnquirySchema = z.object({
  status: adEnquiryStatusSchema.optional(),
  notes: z.string().trim().max(4000).optional(),
  assigneeId: z.uuid().nullable().optional(),
});
export const adEnquiryListQuerySchema = z.object({
  status: adEnquiryStatusSchema.optional(),
  ...cursorQuery,
});
export const adEnquiryReceiptSchema = z.object({ id: z.uuid(), status: adEnquiryStatusSchema });

// ---- Advertisers --------------------------------------------------------------------------------

export const advertiserRoleSchema = z.enum([
  'advertiser',
  'advertiser_organisation_owner',
  'advertiser_account_manager',
  'advertising_agency_representative',
]);
export const createAdvertiserSchema = z.object({
  type: z.enum(['individual', 'organisation']),
  name: text(2, 160),
  category: adCategorySchema,
  /** Owner's phone: the person must sign in with it to use the advertiser area. */
  ownerPhone: z.string().trim().min(7).max(20),
  enquiryId: z.uuid().optional(),
});
export const updateAdvertiserSchema = z.object({
  name: text(2, 160).optional(),
  category: adCategorySchema.optional(),
  verificationStatus: z.enum(['unverified', 'verified', 'rejected']).optional(),
  status: z.enum(['active', 'suspended']).optional(),
  reason: z.string().trim().max(500).optional(),
});
export const advertiserSchema = z.object({
  id: z.uuid(),
  type: z.enum(['individual', 'organisation']),
  name: z.string(),
  category: adCategorySchema,
  verificationStatus: z.enum(['unverified', 'verified', 'rejected']),
  status: z.enum(['active', 'suspended']),
  myRole: advertiserRoleSchema.nullable(),
  createdAt: z.iso.datetime(),
});
export const myAdvertiserSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  status: z.enum(['active', 'suspended']),
  role: advertiserRoleSchema,
});
export const advertiserListQuerySchema = z.object({
  status: z.enum(['active', 'suspended']).optional(),
  ...cursorQuery,
});
export const addAdvertiserMemberSchema = z.object({
  phone: z.string().trim().min(7).max(20),
  role: advertiserRoleSchema,
});
export const advertiserParamSchema = z.object({ advertiserId: z.uuid() });
export const advertiserItemParamsSchema = z.object({ advertiserId: z.uuid(), id: z.uuid() });

// ---- Campaigns, line items, creatives -----------------------------------------------------------

export const adCampaignStatusSchema = z.enum([
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
]);
export type AdCampaignStatus = z.infer<typeof adCampaignStatusSchema>;

export const adTargetingSchema = z
  .object({
    /** all: every participating estate; estates: the listed ones; states: estates in these states. */
    scope: z.enum(['all', 'estates', 'states']),
    estateIds: z.array(z.uuid()).max(500).default([]),
    states: z.array(text(2, 60)).max(37).default([]),
  })
  .refine((t) => t.scope !== 'estates' || t.estateIds.length > 0, {
    message: 'Choose at least one estate',
    path: ['estateIds'],
  })
  .refine((t) => t.scope !== 'states' || t.states.length > 0, {
    message: 'Choose at least one state',
    path: ['states'],
  });
export type AdTargeting = z.infer<typeof adTargetingSchema>;

export const adLineItemInputSchema = z.object({
  placementKey: adPlacementKeySchema,
  targeting: adTargetingSchema,
  weight: z.number().int().min(1).max(100).default(10),
  frequencyCapPerDay: z.number().int().min(1).max(50).optional(),
});
export const adLineItemSchema = z.object({
  id: z.uuid(),
  placementKey: adPlacementKeySchema,
  targeting: z.object({
    scope: z.enum(['all', 'estates', 'states']),
    estateIds: z.array(z.uuid()),
    states: z.array(z.string()),
  }),
  weight: z.number().int(),
  frequencyCapPerDay: z.number().int().nullable(),
});

export const createAdCampaignSchema = z
  .object({
    advertiserId: z.uuid(),
    title: text(3, 160),
    objective: text(3, 500),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    /** Agreed price for the campaign (before VAT). */
    budgetKobo: positiveKoboSchema,
    lineItems: z.array(adLineItemInputSchema).min(1).max(10),
    enquiryId: z.uuid().optional(),
  })
  .refine((c) => new Date(c.endsAt) > new Date(c.startsAt), {
    message: 'The end must be after the start',
    path: ['endsAt'],
  });
export const updateAdCampaignSchema = z.object({
  title: text(3, 160).optional(),
  objective: text(3, 500).optional(),
  startsAt: z.iso.datetime({ offset: true }).optional(),
  endsAt: z.iso.datetime({ offset: true }).optional(),
  budgetKobo: positiveKoboSchema.optional(),
  lineItems: z.array(adLineItemInputSchema).min(1).max(10).optional(),
  arconApprovalRef: z.string().trim().min(3).max(80).optional(),
  arconApprovalFileId: z.uuid().optional(),
});

export const adCreativeTypeSchema = z.enum([
  'image_banner',
  'sponsored_text',
  'sponsored_post',
  'promo_card',
]);
export const adCreativeReviewSchema = z.enum([
  'pending',
  'approved',
  'rejected',
  'revision_requested',
]);
export const createAdCreativeSchema = z
  .object({
    type: adCreativeTypeSchema,
    imageFileId: z.uuid().optional(),
    headline: text(2, 80),
    body: z.string().trim().max(280).optional(),
    cta: text(2, 24),
    destinationUrl: z.url({ protocol: /^https$/ }).max(500),
  })
  .refine((c) => c.type === 'sponsored_text' || c.imageFileId !== undefined, {
    message: 'Add an image for this format',
    path: ['imageFileId'],
  });
export const adCreativeSchema = z.object({
  id: z.uuid(),
  campaignId: z.uuid(),
  type: adCreativeTypeSchema,
  imageFileId: z.uuid().nullable(),
  headline: z.string(),
  body: z.string().nullable(),
  cta: z.string(),
  destinationUrl: z.string(),
  version: z.number().int(),
  reviewStatus: adCreativeReviewSchema,
  reviewNotes: z.string().nullable(),
  active: z.boolean(),
  createdAt: z.iso.datetime(),
});
export const reviewAdCreativeSchema = z
  .object({
    decision: z.enum(['approved', 'rejected', 'revision_requested']),
    notes: z.string().trim().max(1000).optional(),
  })
  .refine((r) => r.decision === 'approved' || (r.notes?.length ?? 0) >= 3, {
    message: 'Say what needs to change',
    path: ['notes'],
  });

export const adCampaignSchema = z.object({
  id: z.uuid(),
  advertiserId: z.uuid(),
  advertiserName: z.string(),
  title: z.string(),
  objective: z.string(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  budgetKobo: z.number().int(),
  status: adCampaignStatusSchema,
  arconApprovalRef: z.string().nullable(),
  paid: z.boolean(),
  creditApproved: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const adCampaignDetailSchema = adCampaignSchema.extend({
  lineItems: z.array(adLineItemSchema),
  creatives: z.array(adCreativeSchema),
  restrictedNote: z.string().nullable(),
  rejectionReason: z.string().nullable(),
});
export const adCampaignListQuerySchema = z.object({
  status: adCampaignStatusSchema.optional(),
  advertiserId: z.uuid().optional(),
  ...cursorQuery,
});
export const adCampaignActionSchema = z.object({ reason: z.string().trim().max(500).optional() });
export const approveAdCampaignSchema = z.object({
  /** Required when the advertiser's category is restricted (alcohol, gambling, political). */
  restrictedNote: z.string().trim().min(10).max(1000).optional(),
});
export const adCreditSchema = z.object({ note: text(10, 1000) });

// ---- Invoices -----------------------------------------------------------------------------------

export const adInvoiceSchema = z.object({
  id: z.uuid(),
  campaignId: z.uuid(),
  number: z.string(),
  amountKobo: koboSchema,
  vatKobo: koboSchema,
  totalKobo: koboSchema,
  status: z.enum(['issued', 'paid', 'void']),
  paidAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export const createAdInvoiceSchema = z.object({ campaignId: z.uuid() });
export const adInvoicePaySchema = z.object({ callbackUrl: z.url().max(500).optional() });
export const adInvoiceCheckoutSchema = z.object({
  invoiceId: z.uuid(),
  totalKobo: z.number().int(),
  authorizationUrl: z.string(),
});

// ---- Decision, tracking, reports ----------------------------------------------------------------

export const adDecisionQuerySchema = z.object({
  placement: adPlacementKeySchema,
  estateId: z.uuid(),
  context: adContextSchema,
});
export const adDecisionSchema = z.object({
  /** Always shown with the ad (advertising.md rule 3). */
  label: z.literal('Sponsored'),
  placement: adPlacementKeySchema,
  type: adCreativeTypeSchema,
  imageFileId: z.uuid().nullable(),
  headline: z.string(),
  body: z.string().nullable(),
  cta: z.string(),
  advertiserName: z.string(),
  impressionUrl: z.string(),
  clickUrl: z.string(),
});
export const adTokenParamSchema = z.object({ token: z.string().min(20).max(600) });

export const adReportSchema = z.object({
  campaignId: z.uuid(),
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  impressions: z.number().int(),
  clicks: z.number().int(),
  ctr: z.number(),
  uniqueReachEstimate: z.number().int(),
  daily: z.array(
    z.object({ day: z.string(), impressions: z.number().int(), clicks: z.number().int() }),
  ),
  /** Estates below the audience threshold are grouped under "Other estates" (rule 5). */
  byEstate: z.array(
    z.object({ estateName: z.string(), impressions: z.number().int(), clicks: z.number().int() }),
  ),
  minimumAudience: z.number().int(),
});

// ---- Estate opt-outs ----------------------------------------------------------------------------

export const estateAdSettingsSchema = z.object({
  blockedCategories: z.array(adCategorySchema),
  dashboardInfoEnabled: z.boolean(),
});
export const updateEstateAdSettingsSchema = z.object({
  blockedCategories: z.array(adCategorySchema).max(AD_CATEGORIES.length).optional(),
  dashboardInfoEnabled: z.boolean().optional(),
});
