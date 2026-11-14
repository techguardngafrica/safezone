import { z } from 'zod';
import { koboSchema, positiveKoboSchema } from './billing';

/** Facilities and bookings (facilities.md, Phase 3). Times are WAT on the wire as ISO with offset. */
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

export const facilityTypeSchema = z.enum([
  'event_hall',
  'pool',
  'gym',
  'court',
  'guest_house',
  'parking',
  'other',
]);

export const facilityPolicySchema = z.object({
  whoCanBook: z
    .enum(['residents', 'owners', 'residents_and_owners'])
    .default('residents_and_owners'),
  advanceDays: z.number().int().min(0).max(365).default(30),
  minMinutes: z.number().int().min(15).max(10_080).default(60),
  maxMinutes: z.number().int().min(15).max(10_080).default(240),
  perHouseholdPerWeek: z.number().int().min(0).max(50).default(0),
  perHouseholdPerMonth: z.number().int().min(0).max(200).default(0),
  bufferMinutes: z.number().int().min(0).max(240).default(0),
  maxGuests: z.number().int().min(0).max(5000).default(0),
  requiresApproval: z.boolean().default(false),
  cancellation: z
    .object({
      /** Full refund when cancelled at least this many hours before the start. */
      freeHours: z.number().int().min(0).max(720).default(24),
      /** Partial refund between freeHours and partialHours before the start. */
      partialHours: z.number().int().min(0).max(720).default(2),
      partialPercent: z.number().int().min(0).max(100).default(50),
    })
    .default({ freeHours: 24, partialHours: 2, partialPercent: 50 }),
});
export type FacilityPolicy = z.infer<typeof facilityPolicySchema>;

export const facilityPricingSchema = z.discriminatedUnion('basis', [
  z.object({ basis: z.literal('free') }),
  z.object({ basis: z.literal('flat'), amount: positiveKoboSchema }),
  z.object({ basis: z.literal('hourly'), amount: positiveKoboSchema }),
  z.object({ basis: z.literal('daily'), amount: positiveKoboSchema }),
]);
export type FacilityPricing = z.infer<typeof facilityPricingSchema>;

export const openingHoursSchema = z
  .array(z.object({ day: z.number().int().min(0).max(6), open: timeSchema, close: timeSchema }))
  .max(14)
  .refine((hours) => hours.every((slot) => slot.close > slot.open), {
    message: 'Closing must be after opening',
  });

export const createFacilitySchema = z.object({
  name: z.string().trim().min(2).max(120),
  type: facilityTypeSchema,
  spaceId: z.uuid().optional(),
  capacity: z.number().int().min(1).max(10_000).optional(),
  description: z.string().trim().max(2000).optional(),
  rules: z.string().trim().max(4000).optional(),
  photoFileIds: z.array(z.uuid()).max(10).default([]),
  openingHours: openingHoursSchema.default(
    [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: '06:00', close: '22:00' })),
  ),
  policy: facilityPolicySchema.default(facilityPolicySchema.parse({})),
  pricing: facilityPricingSchema.default({ basis: 'free' }),
});
export const updateFacilitySchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    capacity: z.number().int().min(1).max(10_000).nullable().optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    rules: z.string().trim().max(4000).nullable().optional(),
    status: z.enum(['active', 'closed']).optional(),
    openingHours: openingHoursSchema.optional(),
    policy: facilityPolicySchema.optional(),
    pricing: facilityPricingSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });

export const facilitySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: facilityTypeSchema,
  spaceId: z.uuid().nullable(),
  capacity: z.number().int().nullable(),
  description: z.string().nullable(),
  rules: z.string().nullable(),
  photoFileIds: z.array(z.uuid()),
  status: z.enum(['active', 'closed']),
  openingHours: openingHoursSchema,
  policy: facilityPolicySchema,
  pricing: facilityPricingSchema,
  version: z.number().int(),
});

export const createBlackoutSchema = z
  .object({
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    reason: z.string().trim().min(3).max(300),
  })
  .refine((value) => new Date(value.endsAt) > new Date(value.startsAt), {
    message: 'End must be after start',
    path: ['endsAt'],
  });
export const blackoutSchema = z.object({
  id: z.uuid(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  reason: z.string(),
  affectedBookings: z.number().int(),
});

export const availabilityQuerySchema = z.object({ date: z.iso.date() });
export const availabilitySchema = z.object({
  date: z.iso.date(),
  open: z.array(z.object({ from: z.iso.datetime(), to: z.iso.datetime() })),
  busy: z.array(
    z.object({
      from: z.iso.datetime(),
      to: z.iso.datetime(),
      kind: z.enum(['booking', 'blackout']),
    }),
  ),
});

export const bookingStatusSchema = z.enum([
  'pending_approval',
  'pending_payment',
  'confirmed',
  'cancelled',
  'completed',
  'no_show',
  'rejected',
]);
export const createBookingSchema = z
  .object({
    facilityId: z.uuid(),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    guests: z.number().int().min(0).max(5000).default(0),
    purpose: z.string().trim().max(300).optional(),
    /** Managers only: book outside the rules, with a reason (audited). */
    overrideReason: z.string().trim().min(3).max(300).optional(),
  })
  .refine((value) => new Date(value.endsAt) > new Date(value.startsAt), {
    message: 'End must be after start',
    path: ['endsAt'],
  });
export const bookingSchema = z.object({
  id: z.uuid(),
  facilityId: z.uuid(),
  facilityName: z.string(),
  bookedBy: z.uuid(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  guests: z.number().int(),
  purpose: z.string().nullable(),
  status: bookingStatusSchema,
  price: koboSchema,
  invoiceId: z.uuid().nullable(),
  holdExpiresAt: z.iso.datetime().nullable(),
  refundAmount: koboSchema,
  rejectionReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export const bookingListQuerySchema = z.object({
  mine: z.stringbool().default(false),
  facilityId: z.uuid().optional(),
  date: z.iso.date().optional(),
  status: bookingStatusSchema.optional(),
});
export const bookingReasonSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export const createDamageReportSchema = z.object({
  description: z.string().trim().min(3).max(2000),
  photoFileIds: z.array(z.uuid()).max(10).default([]),
  /** Charge the booker for the damage (invoice). */
  chargeAmount: positiveKoboSchema.optional(),
});
export const damageReportSchema = z.object({
  id: z.uuid(),
  bookingId: z.uuid(),
  description: z.string(),
  chargeAmount: koboSchema,
  invoiceId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});
export const facilitiesReportQuerySchema = z.object({ from: z.iso.date(), to: z.iso.date() });
export const facilitiesReportSchema = z.object({
  facilities: z.array(
    z.object({
      facilityId: z.uuid(),
      name: z.string(),
      bookings: z.number().int(),
      bookedHours: z.number(),
      cancelled: z.number().int(),
      noShows: z.number().int(),
      revenue: koboSchema,
    }),
  ),
});
