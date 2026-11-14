import { z } from 'zod';

/** Utilities (utilities.md, Phase 2): meters, readings, metered billing and outages. */
export const utilityTypeSchema = z.enum(['electricity', 'water', 'gas']);
export const meterSupplySchema = z.enum(['public', 'estate']);

export const utilityProviderSchema = z.object({
  code: z.string(),
  name: z.string(),
  type: utilityTypeSchema,
  supply: meterSupplySchema,
});

export const meterLookupSchema = z.object({
  providerCode: z.string().trim().min(2).max(40),
  meterNumber: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z-]{6,20}$/, 'Enter the meter number on the meter'),
});
export const meterLookupResultSchema = z.object({
  providerCode: z.string(),
  meterNumber: z.string(),
  accountName: z.string(),
  prepaid: z.boolean(),
});

export const createMeterSchema = meterLookupSchema.extend({
  spaceId: z.uuid(),
  type: utilityTypeSchema,
  /** Estate sub-meters skip the provider lookup. */
  supply: meterSupplySchema.default('public'),
});

export const meterSchema = z.object({
  id: z.uuid(),
  spaceId: z.uuid(),
  unitCode: z.string(),
  type: utilityTypeSchema,
  supply: meterSupplySchema,
  providerCode: z.string(),
  meterNumber: z.string(),
  accountName: z.string().nullable(),
  prepaid: z.boolean(),
  status: z.enum(['active', 'removed']),
  verifiedAt: z.iso.datetime().nullable(),
  lastReading: z.number().nullable(),
  lastReadAt: z.iso.datetime().nullable(),
});

export const meterListQuerySchema = z.object({
  spaceId: z.uuid().optional(),
  type: utilityTypeSchema.optional(),
});

export const meterReadingsSchema = z.object({
  readings: z
    .array(
      z.object({
        meterId: z.uuid(),
        reading: z.number().nonnegative().max(1e9),
        readAt: z.iso.datetime({ offset: true }),
      }),
    )
    .min(1)
    .max(2000),
});
export const meterReadingsResultSchema = z.object({
  recorded: z.number().int(),
  rejected: z.array(z.object({ meterId: z.uuid(), reason: z.string() })),
});

export const createOutageSchema = z
  .object({
    type: utilityTypeSchema.or(z.enum(['internet', 'waste'])),
    title: z.string().trim().min(3).max(120),
    details: z.string().trim().max(2000).optional(),
    startsAt: z.iso.datetime({ offset: true }),
    expectedEndAt: z.iso.datetime({ offset: true }).optional(),
    /** Blocks, buildings or units affected; empty means the whole estate. */
    spaceIds: z.array(z.uuid()).max(100).default([]),
  })
  .refine((value) => !value.expectedEndAt || value.expectedEndAt > value.startsAt, {
    message: 'The expected end must be after the start',
    path: ['expectedEndAt'],
  });
export const updateOutageSchema = z
  .object({
    status: z.enum(['resolved', 'cancelled']).optional(),
    expectedEndAt: z.iso.datetime({ offset: true }).optional(),
    details: z.string().trim().max(2000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });

export const outageSchema = z.object({
  id: z.uuid(),
  type: z.string(),
  title: z.string(),
  details: z.string().nullable(),
  startsAt: z.iso.datetime(),
  expectedEndAt: z.iso.datetime().nullable(),
  spaceIds: z.array(z.uuid()),
  status: z.enum(['announced', 'resolved', 'cancelled']),
  notified: z.number().int(),
  createdAt: z.iso.datetime(),
});
export const outageListQuerySchema = z.object({
  status: z.enum(['announced', 'resolved', 'cancelled']).optional(),
});
