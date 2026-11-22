import { z } from 'zod';
import { koboSchema, positiveKoboSchema } from './billing';

/**
 * Marketplace (marketplace.md, Phase 4; ADR-0023): vendors, listings, estate approvals, orders, reviews,
 * disputes and estate classifieds. Money is integer kobo; commission is in basis points (100 = 1%).
 */

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const photosSchema = z.array(z.uuid()).max(6);

// ---- Categories ---------------------------------------------------------------------------------

export const listingKindSchema = z.enum(['service', 'goods']);

export const serviceCategorySchema = z.object({
  id: z.uuid(),
  parentId: z.uuid().nullable(),
  slug: z.string(),
  name: z.string(),
  kind: listingKindSchema,
});

// ---- Vendors ------------------------------------------------------------------------------------

export const vendorTypeSchema = z.enum(['individual', 'company']);
export const vendorStatusSchema = z.enum([
  'applied',
  'under_review',
  'approved',
  'rejected',
  'suspended',
]);
export const vendorRoleSchema = z.enum([
  'vendor_owner',
  'vendor_administrator',
  'vendor_employee',
  'vendor_service_personnel',
]);
export const nigerianStateSchema = text(2, 60);

export const vendorServiceAreaSchema = z
  .object({
    state: nigerianStateSchema.optional(),
    lga: text(2, 80).optional(),
    estateId: z.uuid().optional(),
  })
  .refine((area) => area.state !== undefined || area.estateId !== undefined, {
    message: 'Give a state or an estate',
  });

/** Public application (signed in: the applicant becomes the Vendor Owner). */
export const vendorApplicationSchema = z
  .object({
    name: text(2, 120),
    type: vendorTypeSchema,
    description: text(10, 2000),
    /** Required for companies (business tier). */
    cacNumber: z
      .string()
      .trim()
      .regex(/^(RC|BN|IT)?\s?\d{4,8}$/i, 'Enter a valid CAC number')
      .optional(),
    contactEmail: z.email().max(200),
    categoryIds: z.array(z.uuid()).min(1).max(10),
    serviceAreas: z.array(vendorServiceAreaSchema).min(1).max(50),
    documentFileIds: z.array(z.uuid()).max(10).default([]),
  })
  .refine((input) => input.type === 'individual' || input.cacNumber !== undefined, {
    message: 'Companies need a CAC number',
    path: ['cacNumber'],
  });

export const updateVendorSchema = z.object({
  name: text(2, 120).optional(),
  description: text(10, 2000).optional(),
  contactEmail: z.email().max(200).optional(),
  logoFileId: z.uuid().nullable().optional(),
  serviceAreas: z.array(vendorServiceAreaSchema).min(1).max(50).optional(),
});

export const vendorPublicSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: vendorTypeSchema,
  description: z.string(),
  logoFileId: z.uuid().nullable(),
  ratingAvg: z.number().nullable(),
  ratingCount: z.number().int(),
  verified: z.boolean(),
});

export const vendorSchema = vendorPublicSchema.extend({
  status: vendorStatusSchema,
  verificationTier: z.enum(['individual', 'business']),
  cacNumber: z.string().nullable(),
  contactEmail: z.string(),
  serviceAreas: z.array(
    z.object({
      state: z.string().nullable(),
      lga: z.string().nullable(),
      estateId: z.uuid().nullable(),
    }),
  ),
  categoryIds: z.array(z.uuid()),
  payout: z.object({
    ready: z.boolean(),
    bankName: z.string().nullable(),
    accountLast4: z.string().nullable(),
  }),
  rejectionReason: z.string().nullable(),
  suspendedReason: z.string().nullable(),
  /** The caller's own role in this vendor. */
  myRole: vendorRoleSchema.nullable(),
  createdAt: z.iso.datetime(),
});

export const myVendorSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  status: vendorStatusSchema,
  role: vendorRoleSchema,
});

export const vendorPayoutSetupSchema = z.object({
  bankCode: z.string().trim().min(2).max(10),
  accountNumber: z.string().regex(/^\d{10}$/, 'Account numbers are 10 digits'),
});

export const vendorMemberSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  displayName: z.string().nullable(),
  role: vendorRoleSchema,
  createdAt: z.iso.datetime(),
});
export const addVendorMemberSchema = z.object({
  /** The person must already have a Safezone account with this phone number. */
  phone: z.string().trim().min(7).max(20),
  role: vendorRoleSchema.exclude(['vendor_owner']),
});
export const updateVendorMemberSchema = z.object({
  role: vendorRoleSchema.exclude(['vendor_owner']),
});

export const vendorParamSchema = z.object({ vendorId: z.uuid() });
export const vendorItemParamsSchema = z.object({ vendorId: z.uuid(), id: z.uuid() });

// ---- Listings -----------------------------------------------------------------------------------

export const priceTypeSchema = z.enum(['fixed', 'from', 'quote']);
export const listingStatusSchema = z.enum(['draft', 'active', 'paused', 'archived']);

const listingFields = {
  categoryId: z.uuid(),
  title: text(3, 120),
  description: text(10, 4000),
  photoFileIds: photosSchema.default([]),
  priceType: priceTypeSchema,
  /** Required unless the price type is quote. */
  priceKobo: positiveKoboSchema.optional(),
  durationMinutes: z.number().int().min(15).max(10_080).optional(),
};

export const createListingSchema = z
  .object({ ...listingFields, status: z.enum(['draft', 'active']).default('draft') })
  .refine((l) => l.priceType === 'quote' || l.priceKobo !== undefined, {
    message: 'Set a price, or choose "on quote"',
    path: ['priceKobo'],
  });

export const updateListingSchema = z.object({
  categoryId: z.uuid().optional(),
  title: text(3, 120).optional(),
  description: text(10, 4000).optional(),
  photoFileIds: photosSchema.optional(),
  priceType: priceTypeSchema.optional(),
  priceKobo: positiveKoboSchema.nullable().optional(),
  durationMinutes: z.number().int().min(15).max(10_080).nullable().optional(),
  status: listingStatusSchema.optional(),
});

export const listingSchema = z.object({
  id: z.uuid(),
  vendorId: z.uuid(),
  categoryId: z.uuid(),
  kind: listingKindSchema,
  title: z.string(),
  description: z.string(),
  photoFileIds: z.array(z.uuid()),
  priceType: priceTypeSchema,
  priceKobo: z.number().int().nullable(),
  durationMinutes: z.number().int().nullable(),
  status: listingStatusSchema,
  updatedAt: z.iso.datetime(),
});

/** What a resident sees when browsing: the listing with its vendor's public profile. */
export const marketplaceListingSchema = listingSchema
  .omit({ status: true })
  .extend({ vendor: vendorPublicSchema });

export const marketplaceBrowseQuerySchema = z.object({
  category: z.uuid().optional(),
  q: z.string().trim().min(2).max(80).optional(),
  vendorId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).optional(),
});

export const vendorListingQuerySchema = z.object({
  status: listingStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});

// ---- Estate approval ----------------------------------------------------------------------------

export const vendorApprovalStatusSchema = z.enum(['approved', 'blocked']);
export const estateVendorSchema = z.object({
  vendor: vendorPublicSchema,
  /** Null when the estate has not decided (visible only if the estate allows all verified vendors). */
  status: vendorApprovalStatusSchema.nullable(),
  decidedAt: z.iso.datetime().nullable(),
});
export const setVendorApprovalSchema = z.object({
  vendorId: z.uuid(),
  status: vendorApprovalStatusSchema,
  reason: z.string().trim().max(500).optional(),
});

// ---- Orders -------------------------------------------------------------------------------------

export const orderStatusSchema = z.enum([
  'requested',
  'quoted',
  'accepted',
  'scheduled',
  'in_progress',
  'completed',
  'reviewed',
  'declined',
  'cancelled_by_resident',
  'cancelled_by_vendor',
  'disputed',
  'refunded',
]);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

export const placeOrderSchema = z.object({
  listingId: z.uuid(),
  /** The resident's unit where the work or delivery happens. */
  spaceId: z.uuid().optional(),
  preferredAt: z.iso.datetime({ offset: true }).optional(),
  details: text(3, 2000),
});

export const orderSchema = z.object({
  id: z.uuid(),
  estateId: z.uuid(),
  vendorId: z.uuid(),
  vendorName: z.string(),
  listingId: z.uuid(),
  listingTitle: z.string(),
  spaceId: z.uuid().nullable(),
  details: z.string(),
  status: orderStatusSchema,
  preferredAt: z.iso.datetime().nullable(),
  scheduledAt: z.iso.datetime().nullable(),
  quoteKobo: z.number().int().nullable(),
  amountKobo: z.number().int().nullable(),
  /** Shown to the vendor and Techguard only. */
  commissionKobo: z.number().int().nullable(),
  vendorAmountKobo: z.number().int().nullable(),
  paid: z.boolean(),
  paidAt: z.iso.datetime().nullable(),
  assignedMemberId: z.uuid().nullable(),
  cancelReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const orderEventSchema = z.object({
  fromStatus: orderStatusSchema.nullable(),
  toStatus: orderStatusSchema,
  actorKind: z.enum(['resident', 'vendor', 'platform', 'system']),
  note: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export const orderDetailSchema = orderSchema.extend({
  events: z.array(orderEventSchema),
  review: z
    .object({
      rating: z.number().int(),
      comment: z.string().nullable(),
      vendorResponse: z.string().nullable(),
    })
    .nullable(),
});

export const orderListQuerySchema = z.object({
  status: orderStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().min(1).optional(),
});

export const orderQuoteSchema = z.object({
  amountKobo: positiveKoboSchema,
  note: z.string().trim().max(1000).optional(),
});
export const orderScheduleSchema = z.object({ scheduledAt: z.iso.datetime({ offset: true }) });
export const orderReasonSchema = z.object({ reason: text(3, 500) });
export const orderAssignSchema = z.object({ memberId: z.uuid() });
export const orderPaySchema = z.object({ callbackUrl: z.url().max(500).optional() });
export const orderCheckoutSchema = z.object({
  orderId: z.uuid(),
  amountKobo: z.number().int(),
  authorizationUrl: z.string(),
});

export const orderMessageSchema = z.object({
  id: z.uuid(),
  authorKind: z.enum(['resident', 'vendor']),
  body: z.string(),
  createdAt: z.iso.datetime(),
});
export const postOrderMessageSchema = z.object({ body: text(1, 2000) });

export const reviewOrderSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(2000).optional(),
});
export const reviewResponseSchema = z.object({ response: text(2, 2000) });
export const vendorReviewSchema = z.object({
  id: z.uuid(),
  rating: z.number().int(),
  comment: z.string().nullable(),
  vendorResponse: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export const openDisputeSchema = z.object({
  reason: text(10, 2000),
  evidenceFileIds: z.array(z.uuid()).max(6).default([]),
});
export const disputeStatusSchema = z.enum(['open', 'resolved']);
export const disputeResolutionSchema = z.enum(['refund', 'partial_refund', 'no_action']);
export const resolveDisputeSchema = z
  .object({
    resolution: disputeResolutionSchema,
    refundKobo: positiveKoboSchema.optional(),
    note: text(3, 1000),
  })
  .refine((r) => r.resolution !== 'partial_refund' || r.refundKobo !== undefined, {
    message: 'Give the refund amount',
    path: ['refundKobo'],
  });
export const disputeSchema = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  estateId: z.uuid(),
  vendorId: z.uuid(),
  reason: z.string(),
  evidenceFileIds: z.array(z.uuid()),
  status: disputeStatusSchema,
  resolution: disputeResolutionSchema.nullable(),
  refundKobo: z.number().int().nullable(),
  note: z.string().nullable(),
  createdAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
});
export const disputeListQuerySchema = z.object({
  status: disputeStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});

export const vendorEarningsSchema = z.object({
  paidOrders: z.number().int(),
  grossKobo: koboSchema,
  commissionKobo: koboSchema,
  vendorKobo: koboSchema,
  refundedKobo: koboSchema,
});

// ---- Platform -----------------------------------------------------------------------------------

export const platformVendorListQuerySchema = z.object({
  status: vendorStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});
export const vendorDecisionSchema = z.object({ reason: z.string().trim().max(500).optional() });
export const vendorSuspendSchema = z.object({ reason: text(3, 500) });

export const commissionRuleSchema = z.object({
  id: z.uuid(),
  scope: z.enum(['default', 'category', 'vendor']),
  scopeId: z.uuid().nullable(),
  bps: z.number().int(),
  validFrom: z.iso.datetime(),
});
export const setCommissionRuleSchema = z
  .object({
    scope: z.enum(['default', 'category', 'vendor']),
    scopeId: z.uuid().optional(),
    /** Basis points: 1000 = 10%. At most 30%. */
    bps: z.number().int().min(0).max(3000),
  })
  .refine((r) => (r.scope === 'default') === (r.scopeId === undefined), {
    message: 'Category and vendor rules need a scopeId; the default rule has none',
    path: ['scopeId'],
  });

// ---- Estate classifieds (ADR-0023) ------------------------------------------------------------

export const classifiedKindSchema = z.enum(['item', 'service']);
export const classifiedStatusSchema = z.enum(['active', 'sold', 'withdrawn', 'hidden', 'expired']);
export const itemConditionSchema = z.enum(['new', 'like_new', 'good', 'fair']);

export const createClassifiedSchema = z.object({
  kind: classifiedKindSchema,
  title: text(3, 120),
  description: text(10, 4000),
  /** Omit for "price on request". */
  priceKobo: positiveKoboSchema.optional(),
  negotiable: z.boolean().default(false),
  condition: itemConditionSchema.optional(),
  photoFileIds: photosSchema.default([]),
});
export const updateClassifiedSchema = z.object({
  title: text(3, 120).optional(),
  description: text(10, 4000).optional(),
  priceKobo: positiveKoboSchema.nullable().optional(),
  negotiable: z.boolean().optional(),
  condition: itemConditionSchema.nullable().optional(),
  photoFileIds: photosSchema.optional(),
  /** The seller may mark it sold, withdraw it, or renew it (active) for another 30 days. */
  status: z.enum(['active', 'sold', 'withdrawn']).optional(),
});
export const classifiedSchema = z.object({
  id: z.uuid(),
  kind: classifiedKindSchema,
  title: z.string(),
  description: z.string(),
  priceKobo: z.number().int().nullable(),
  negotiable: z.boolean(),
  condition: itemConditionSchema.nullable(),
  photoFileIds: z.array(z.uuid()),
  status: classifiedStatusSchema,
  seller: z.object({ userId: z.uuid(), displayName: z.string().nullable() }),
  mine: z.boolean(),
  hiddenReason: z.string().nullable(),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});
export const classifiedListQuerySchema = z.object({
  kind: classifiedKindSchema.optional(),
  q: z.string().trim().min(2).max(80).optional(),
  mine: z.coerce.boolean().optional(),
  /** Staff with marketplace.moderate can list hidden listings too. */
  status: classifiedStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).optional(),
});
export const hideClassifiedSchema = z.object({ reason: text(3, 500) });
export const classifiedMessageSchema = z.object({
  id: z.uuid(),
  buyerUserId: z.uuid(),
  fromSeller: z.boolean(),
  body: z.string(),
  createdAt: z.iso.datetime(),
});
export const postClassifiedMessageSchema = z.object({
  body: text(1, 2000),
  /** The seller replying names the buyer thread; buyers omit it. */
  buyerUserId: z.uuid().optional(),
});
export const classifiedThreadSchema = z.object({
  buyerUserId: z.uuid(),
  buyerName: z.string().nullable(),
  lastMessageAt: z.iso.datetime(),
  messages: z.array(classifiedMessageSchema),
});

/** A vendor's page for residents: public profile, live listings and this estate's reviews. */
export const marketplaceVendorProfileSchema = z.object({
  vendor: vendorPublicSchema,
  listings: z.array(marketplaceListingSchema),
  reviews: z.array(vendorReviewSchema),
});
export const estateOrderItemParamsSchema = z.object({ estateId: z.uuid(), id: z.uuid() });
export const estateVendorParamsSchema = z.object({ estateId: z.uuid(), vendorId: z.uuid() });
