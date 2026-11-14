import { z } from 'zod';
import { phoneE164Schema } from './common';

/** Self-service estate application (public-web /register). Onboarding is free: no plan or payment step. */
export const estateApplicationSchema = z.object({
  representative: z.object({
    fullName: z.string().trim().min(2).max(120),
    email: z.email(),
    role: z.enum(['owner', 'developer', 'manager', 'residents_association_officer']),
  }),
  estate: z.object({
    name: z.string().trim().min(2).max(160),
    address: z.string().trim().min(5).max(300),
    state: z.string().trim().min(2).max(60),
    lga: z.string().trim().min(2).max(80),
    location: z
      .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
      .optional(),
    type: z.enum(['gated_houses', 'apartment_complex', 'mixed']),
    unitsEstimate: z.number().int().positive().max(100_000),
    gatesEstimate: z.number().int().positive().max(100),
  }),
  documentFileIds: z.array(z.uuid()).min(1, 'Upload at least one proof-of-authority document'),
  acceptedTerms: z.literal(true),
});
export type EstateApplication = z.infer<typeof estateApplicationSchema>;

/** Techguard-assisted onboarding request (public-web /contact). */
export const onboardingLeadSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: phoneE164Schema,
  email: z.email().optional(),
  estateName: z.string().trim().min(2).max(160),
  location: z.string().trim().min(2).max(200),
  unitsEstimate: z.number().int().positive().optional(),
  message: z.string().max(2000).optional(),
});
export type OnboardingLead = z.infer<typeof onboardingLeadSchema>;

/** Feature keys switched on per estate through entitlements (tenancy.md §7.7). */
export const FEATURE_KEYS = [
  'visitors',
  'security',
  'emergency',
  'announcements',
  'property',
  'occupancy',
  'billing',
  'payments',
  'maintenance',
  'community',
  'facilities',
  'documents',
] as const;
export const featureKeySchema = z.enum(FEATURE_KEYS);
export type FeatureKey = z.infer<typeof featureKeySchema>;

export const estateStatusSchema = z.enum([
  'applied',
  'under_review',
  'info_requested',
  'approved',
  'active',
  'suspended',
  'deactivated',
  'rejected',
]);

export const estateProfileSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  code: z.string(),
  type: z.enum(['gated_houses', 'apartment_complex', 'mixed']),
  address: z.string().nullable(),
  state: z.string().nullable(),
  lga: z.string().nullable(),
  timezone: z.string(),
  currency: z.literal('NGN'),
  status: estateStatusSchema,
  onboardingMode: z.enum(['self_service', 'assisted']),
  version: z.number().int(),
});
export type EstateProfile = z.infer<typeof estateProfileSchema>;

export const updateEstateProfileSchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    address: z.string().trim().min(5).max(300).optional(),
    state: z.string().trim().min(2).max(60).optional(),
    lga: z.string().trim().min(2).max(80).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });

export const membershipSummarySchema = z.object({
  estate: z.object({ id: z.uuid(), name: z.string(), status: estateStatusSchema }),
  status: z.enum(['pending', 'active', 'suspended', 'left']),
  roles: z.array(z.string()),
  joinedAt: z.iso.datetime(),
});
export type MembershipSummary = z.infer<typeof membershipSummarySchema>;

/**
 * Estate settings with their defaults (tenancy.md §6). Stored per key in estate_settings; missing keys
 * take the default. Add a key here before using it anywhere.
 */
export const estateSettingsSchema = z.object({
  tenant_approval: z
    .enum(['owner_then_manager_override', 'manager_only', 'owner_only'])
    .default('owner_then_manager_override'),
  'visitor.max_pass_days': z.number().int().min(1).max(365).default(30),
  'visitor.walkin_timeout_seconds': z.number().int().min(30).max(1800).default(180),
  'visitor.require_photo': z.boolean().default(false),
  'staff_pass.requires_manager_approval': z.boolean().default(true),
  'sos.cancel_countdown_seconds': z.number().int().min(0).max(30).default(5),
  'sos.escalation': z
    .array(
      z.object({
        afterSeconds: z.number().int().min(10).max(3600),
        target: z.enum(['next_guard', 'supervisor_and_managers', 'emergency_contacts_voice']),
      }),
    )
    .min(1)
    .default([
      { afterSeconds: 60, target: 'next_guard' },
      { afterSeconds: 120, target: 'supervisor_and_managers' },
      { afterSeconds: 180, target: 'emergency_contacts_voice' },
    ]),
  'community.private_messaging': z.boolean().default(false),
  'community.channel_approval': z.boolean().default(true),
  'ads.blocked_categories': z.array(z.string().max(60)).max(50).default([]),
  'guards.can_see_resident_phone': z.boolean().default(false),
});
export type EstateSettings = z.infer<typeof estateSettingsSchema>;
export type EstateSettingKey = keyof EstateSettings;

/**
 * PATCH body: any subset of settings, each validated by its own schema. Built without the defaults,
 * so keys the client did not send stay untouched.
 */
const settingsShapeWithoutDefaults = Object.fromEntries(
  Object.entries(estateSettingsSchema.shape).map(([key, schema]) => [
    key,
    schema.unwrap().optional(),
  ]),
) as {
  [K in keyof typeof estateSettingsSchema.shape]: z.ZodOptional<
    ReturnType<(typeof estateSettingsSchema.shape)[K]['unwrap']>
  >;
};

export const updateEstateSettingsSchema = z
  .strictObject(settingsShapeWithoutDefaults)
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });
