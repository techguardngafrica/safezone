import { z } from 'zod';
import { phoneE164Schema } from './common';
import { estateProfileSchema } from './tenancy';

/** Self-service and assisted onboarding (tenancy.md §4). Onboarding is free: no plan or payment step. */
export const applicationStatusSchema = z.enum([
  'submitted',
  'under_review',
  'info_requested',
  'approved',
  'rejected',
  'withdrawn',
]);
export type ApplicationStatus = z.infer<typeof applicationStatusSchema>;

export const estateTypeSchema = z.enum(['gated_houses', 'apartment_complex', 'mixed']);

export const applicationSchema = z.object({
  id: z.uuid(),
  status: applicationStatusSchema,
  representative: z.object({
    fullName: z.string(),
    email: z.string(),
    role: z.string(),
  }),
  estate: z.object({
    name: z.string(),
    type: estateTypeSchema,
    address: z.string(),
    state: z.string(),
    lga: z.string(),
    location: z.object({ lat: z.number(), lng: z.number() }).nullable(),
    unitsEstimate: z.number().int(),
    gatesEstimate: z.number().int(),
  }),
  documents: z.array(z.object({ fileId: z.uuid(), docType: z.string() })),
  /** Techguard's request for information, or the rejection reason. */
  decisionReason: z.string().nullable(),
  estateId: z.uuid().nullable(),
  submittedAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
  version: z.number().int(),
});
export type ApplicationView = z.infer<typeof applicationSchema>;

export const duplicateMatchSchema = z.object({
  kind: z.enum(['estate', 'application']),
  id: z.uuid(),
  name: z.string(),
  reason: z.enum(['same_name', 'similar_name_nearby']),
  distanceMetres: z.number().nullable(),
});

/** Reviewer view: adds the applicant and the duplicate check. */
export const applicationReviewSchema = applicationSchema.extend({
  applicantUserId: z.uuid(),
  applicantPhone: z.string(),
  reviewerId: z.uuid().nullable(),
  duplicates: z.array(duplicateMatchSchema),
});

export const applicationListQuerySchema = z.object({
  status: applicationStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).optional(),
});

export const applicationDecisionSchema = z.object({
  reason: z.string().trim().min(5).max(2000),
});

/** Applicant answers an information request: new documents and an optional note. */
export const resubmitApplicationSchema = z.object({
  documentFileIds: z.array(z.uuid()).max(10).default([]),
  note: z.string().trim().max(2000).optional(),
});

export const onboardingLeadStatusSchema = z.enum(['new', 'contacted', 'converted', 'closed']);
export const onboardingLeadViewSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  estateName: z.string(),
  location: z.string(),
  unitsEstimate: z.number().int().nullable(),
  message: z.string().nullable(),
  status: onboardingLeadStatusSchema,
  estateId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});
export const leadListQuerySchema = z.object({
  status: onboardingLeadStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).optional(),
});
export const updateLeadSchema = z.object({ status: onboardingLeadStatusSchema });

/** Techguard creates an estate for an assisted onboarding. */
export const createEstateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  type: estateTypeSchema,
  address: z.string().trim().min(5).max(300),
  state: z.string().trim().min(2).max(60),
  lga: z.string().trim().min(2).max(80),
  leadId: z.uuid().optional(),
});

export const estateLifecycleSchema = z.object({ reason: z.string().trim().min(5).max(1000) });

export const platformEstateSchema = estateProfileSchema.extend({
  approvedAt: z.iso.datetime().nullable(),
  activatedAt: z.iso.datetime().nullable(),
  suspendedAt: z.iso.datetime().nullable(),
  suspensionReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export const platformEstateListQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  status: z.string().max(30).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).optional(),
});

/** Roles an invitation may grant. Platform roles are never granted by invitation. */
export const INVITABLE_ROLE_KEYS = ['estate_administrator', 'estate_manager'] as const;

export const createInvitationSchema = z.object({
  phone: phoneE164Schema,
  email: z.email().optional(),
  roleKey: z.enum(INVITABLE_ROLE_KEYS).default('estate_administrator'),
});
export const invitationSchema = z.object({
  id: z.uuid(),
  estateId: z.uuid(),
  phone: z.string(),
  email: z.string().nullable(),
  roleKey: z.string(),
  status: z.enum(['pending', 'accepted', 'expired', 'revoked']),
  expiresAt: z.iso.datetime(),
  acceptedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

/** Opaque invitation token from the link (base64url, 32 bytes). */
export const invitationTokenParamSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{40,64}$/),
});
/** What the invitee sees before signing in. The phone is masked. */
export const invitationPreviewSchema = z.object({
  estateName: z.string(),
  roleKey: z.string(),
  phoneMasked: z.string(),
  expiresAt: z.iso.datetime(),
  status: z.enum(['pending', 'accepted', 'expired', 'revoked']),
});
export const acceptedInvitationSchema = z.object({
  estateId: z.uuid(),
  roleKey: z.string(),
});

export const SETUP_STEP_KEYS = [
  'profile',
  'spaces',
  'gates',
  'security_supervisor',
  'sos_policy',
  'residents',
] as const;
export const setupStepSchema = z.enum(SETUP_STEP_KEYS);
export const setupProgressSchema = z.object({
  estateStatus: z.string(),
  steps: z.array(
    z.object({
      step: setupStepSchema,
      required: z.boolean(),
      completedAt: z.iso.datetime().nullable(),
    }),
  ),
  missing: z.array(setupStepSchema),
  canActivate: z.boolean(),
});
export const setupStepParamSchema = z.object({ estateId: z.uuid(), step: setupStepSchema });
