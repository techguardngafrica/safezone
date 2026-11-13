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
