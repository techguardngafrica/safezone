import { z } from 'zod';
import { phoneE164Schema } from './common';

/** Gates (security.md) and visitor passes (visitor.md). */
export const gateSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: z.enum(['pedestrian', 'vehicle', 'both']),
  status: z.enum(['active', 'inactive']),
});
export const createGateSchema = z.object({
  name: z.string().trim().min(2).max(60),
  type: gateSchema.shape.type,
});
export const updateGateSchema = z
  .object({
    name: z.string().trim().min(2).max(60).optional(),
    type: gateSchema.shape.type.optional(),
    status: gateSchema.shape.status.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });

export const passTypeSchema = z.enum([
  'one_time',
  'multi_entry',
  'recurring',
  'domestic_staff',
  'delivery',
]);
export const passStatusSchema = z.enum(['scheduled', 'active', 'used', 'expired', 'revoked']);
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
export const recurrenceSchema = z.object({
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  from: timeSchema,
  to: timeSchema,
});

export const createVisitorInvitationSchema = z
  .object({
    /** The host household (residents); management may omit it. */
    householdId: z.uuid().optional(),
    type: passTypeSchema,
    purpose: z.string().trim().max(200).optional(),
    validFrom: z.iso.datetime({ offset: true }),
    validTo: z.iso.datetime({ offset: true }),
    recurrence: recurrenceSchema.optional(),
    /** multi_entry only. */
    maxUses: z.number().int().min(2).max(100).optional(),
    gateIds: z.array(z.uuid()).max(10).default([]),
    /** domestic_staff only: the approved staff member. */
    domesticStaffId: z.uuid().optional(),
    visitors: z
      .array(
        z.object({
          name: z.string().trim().min(2).max(120),
          phone: phoneE164Schema.optional(),
          vehiclePlate: z.string().trim().min(3).max(15).optional(),
        }),
      )
      .min(1)
      .max(20),
  })
  .refine((value) => new Date(value.validTo) > new Date(value.validFrom), {
    message: 'The end must be after the start',
    path: ['validTo'],
  })
  .refine(
    (value) =>
      value.type === 'recurring'
        ? value.recurrence !== undefined
        : value.type === 'domestic_staff' || value.recurrence === undefined,
    { message: 'Recurring passes need a schedule, and only they have one', path: ['recurrence'] },
  )
  .refine((value) => value.type !== 'domestic_staff' || value.domesticStaffId !== undefined, {
    message: 'Choose the staff member',
    path: ['domesticStaffId'],
  });

export const visitorPassSchema = z.object({
  id: z.uuid(),
  invitationId: z.uuid(),
  type: passTypeSchema,
  status: passStatusSchema,
  visitorName: z.string(),
  visitorPhone: z.string().nullable(),
  vehiclePlate: z.string().nullable(),
  validFrom: z.iso.datetime(),
  validTo: z.iso.datetime(),
  recurrence: recurrenceSchema.nullable(),
  gateIds: z.array(z.uuid()),
  maxUses: z.number().int().nullable(),
  usesCount: z.number().int(),
  hostHouseholdId: z.uuid().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
/** The host's view also carries the credentials. */
export const visitorPassCredentialsSchema = visitorPassSchema.extend({
  pin: z.string(),
  qr: z.string(),
  passUrl: z.string(),
});
export const passListQuerySchema = z.object({
  /** Only my household's passes (default for residents). */
  mine: z.stringbool().default(true),
  status: passStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});
export const revokePassSchema = z.object({ reason: z.string().trim().min(3).max(300) });

/** Public pass page (visitor's phone). Minimum data: no host name, no phone numbers. */
export const publicPassTokenParamSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{40,80}$/),
});
export const publicPassSchema = z.object({
  estateName: z.string(),
  visitorName: z.string(),
  unitCode: z.string().nullable(),
  status: passStatusSchema,
  validFrom: z.iso.datetime(),
  validTo: z.iso.datetime(),
  recurrence: recurrenceSchema.nullable(),
  pin: z.string().nullable(),
  qr: z.string().nullable(),
});

export const gateDecisionSchema = z.enum(['allow', 'check', 'deny']);
export const verifyCredentialSchema = z
  .object({
    gateId: z.uuid(),
    qr: z.string().min(20).max(300).optional(),
    pin: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    direction: z.enum(['in', 'out']).default('in'),
  })
  .refine((value) => Boolean(value.qr) !== Boolean(value.pin), {
    message: 'Send either qr or pin',
  });
export const verifyResultSchema = z.object({
  decision: gateDecisionSchema,
  reasons: z.array(z.string()),
  pass: z
    .object({
      id: z.uuid(),
      type: passTypeSchema,
      visitorName: z.string(),
      vehiclePlate: z.string().nullable(),
      unitCode: z.string().nullable(),
      usesLeft: z.number().int().nullable(),
      validTo: z.iso.datetime(),
    })
    .nullable(),
});

export const gateEventInputSchema = z.object({
  clientUuid: z.uuid(),
  gateId: z.uuid(),
  direction: z.enum(['in', 'out']),
  passId: z.uuid().optional(),
  walkinId: z.uuid().optional(),
  visitorName: z.string().trim().max(120).optional(),
  vehiclePlate: z.string().trim().max(15).optional(),
  decision: z.enum(['allow', 'check', 'deny', 'override']),
  /** Required for override and deny. */
  reason: z.string().trim().max(300).optional(),
  deviceId: z.string().trim().max(100).optional(),
  occurredAt: z.iso.datetime({ offset: true }),
});
export const gateEventSchema = z.object({
  id: z.uuid(),
  gateId: z.uuid(),
  passId: z.uuid().nullable(),
  walkinId: z.uuid().nullable(),
  direction: z.enum(['in', 'out']),
  visitorName: z.string().nullable(),
  vehiclePlate: z.string().nullable(),
  decision: z.enum(['allow', 'check', 'deny', 'override']),
  decisionReason: z.string().nullable(),
  guardUserId: z.uuid(),
  occurredAt: z.iso.datetime(),
  clockSkewed: z.boolean(),
  offline: z.boolean(),
  /** False when this client_uuid was already recorded (idempotent replay). */
  created: z.boolean(),
});
export const gateSyncSchema = z.object({
  /** The device clock when it sent the batch; events are flagged when it is off by more than 5 minutes. */
  deviceNow: z.iso.datetime({ offset: true }),
  events: z.array(gateEventInputSchema).min(1).max(500),
});
export const gateSyncResultSchema = z.object({
  accepted: z.number().int(),
  duplicates: z.number().int(),
  rejected: z.array(z.object({ clientUuid: z.uuid(), code: z.string() })),
});
export const gateEventListQuerySchema = z.object({
  gateId: z.uuid().optional(),
  passId: z.uuid().optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
});

export const expectedQuerySchema = z.object({
  gateId: z.uuid(),
  hours: z.coerce.number().int().min(1).max(48).default(24),
});
/** Offline list for a gate device: enough to verify QR and PIN without the API. */
export const expectedPassSchema = z.object({
  id: z.uuid(),
  type: passTypeSchema,
  visitorName: z.string(),
  vehiclePlate: z.string().nullable(),
  unitCode: z.string().nullable(),
  validFrom: z.iso.datetime(),
  validTo: z.iso.datetime(),
  recurrence: recurrenceSchema.nullable(),
  gateIds: z.array(z.uuid()),
  maxUses: z.number().int().nullable(),
  usesCount: z.number().int(),
  /** sha256(passId ":" pin), so a device can match a typed PIN offline. */
  pinDigest: z.string(),
});
export const expectedListSchema = z.object({
  generatedAt: z.iso.datetime(),
  passes: z.array(expectedPassSchema),
  restricted: z.array(
    z.object({
      phone: z.string().nullable(),
      plate: z.string().nullable(),
      name: z.string().nullable(),
    }),
  ),
});
export const revocationsQuerySchema = z.object({ since: z.iso.datetime({ offset: true }) });
export const revocationsSchema = z.object({
  generatedAt: z.iso.datetime(),
  revoked: z.array(z.object({ passId: z.uuid(), revokedAt: z.iso.datetime() })),
});
export const signingKeysSchema = z.array(
  z.object({
    keyIndex: z.number().int(),
    publicKey: z.string(),
    activeFrom: z.iso.datetime(),
    activeTo: z.iso.datetime().nullable(),
  }),
);
export const insideItemSchema = z.object({
  passId: z.uuid().nullable(),
  walkinId: z.uuid().nullable(),
  visitorName: z.string().nullable(),
  vehiclePlate: z.string().nullable(),
  gateId: z.uuid(),
  enteredAt: z.iso.datetime(),
});

export const walkinStatusSchema = z.enum([
  'pending',
  'approved',
  'rejected',
  'timed_out',
  'cancelled',
]);
export const createWalkinSchema = z.object({
  gateId: z.uuid(),
  spaceId: z.uuid(),
  visitorName: z.string().trim().min(2).max(120),
  visitorPhone: phoneE164Schema.optional(),
  purpose: z.string().trim().max(200).optional(),
  vehiclePlate: z.string().trim().min(3).max(15).optional(),
});
export const walkinSchema = z.object({
  id: z.uuid(),
  gateId: z.uuid(),
  spaceId: z.uuid(),
  unitCode: z.string().nullable(),
  visitorName: z.string(),
  purpose: z.string().nullable(),
  vehiclePlate: z.string().nullable(),
  status: walkinStatusSchema,
  expiresAt: z.iso.datetime(),
  respondedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export const restrictedVisitorSchema = z.object({
  id: z.uuid(),
  name: z.string().nullable(),
  phone: z.string().nullable(),
  plate: z.string().nullable(),
  reason: z.string(),
  expiresAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export const createRestrictedVisitorSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    phone: phoneE164Schema.optional(),
    plate: z.string().trim().min(3).max(15).optional(),
    reason: z.string().trim().min(3).max(300),
    expiresAt: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((value) => value.name || value.phone || value.plate, {
    message: 'Give a name, phone or plate',
  });
