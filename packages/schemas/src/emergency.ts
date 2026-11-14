import { z } from 'zod';

/** SOS and emergency broadcasts (emergency.md). No advertising on any of these screens. */
export const sosCategorySchema = z.enum([
  'security_threat',
  'medical',
  'fire',
  'accident',
  'suspicious_activity',
  'general',
]);
export const sosStatusSchema = z.enum([
  'triggered',
  'acknowledged',
  'assigned',
  'responding',
  'resolved',
  'closed',
  'cancelled',
]);
export const sosLocationInputSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).max(100_000).optional(),
  capturedAt: z.iso.datetime({ offset: true }).optional(),
});
export const triggerSosSchema = z.object({
  category: sosCategorySchema.default('general'),
  /** The household in trouble (residents); guards may omit it. */
  householdId: z.uuid().optional(),
  location: sosLocationInputSchema.optional(),
  isDrill: z.boolean().default(false),
});
export const sosEventSchema = z.object({
  id: z.uuid(),
  type: z.string(),
  actorId: z.uuid().nullable(),
  channel: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  occurredAt: z.iso.datetime(),
});
export const sosAlertSchema = z.object({
  id: z.uuid(),
  status: sosStatusSchema,
  category: sosCategorySchema,
  isDrill: z.boolean(),
  source: z.string(),
  triggeredBy: z.uuid(),
  triggerRole: z.string(),
  householdId: z.uuid().nullable(),
  unitCode: z.string().nullable(),
  triggeredAt: z.iso.datetime(),
  acknowledgedAt: z.iso.datetime().nullable(),
  acknowledgedBy: z.uuid().nullable(),
  assignedTo: z.uuid().nullable(),
  respondingAt: z.iso.datetime().nullable(),
  resolvedAt: z.iso.datetime().nullable(),
  resolution: z.string().nullable(),
  falseAlarm: z.boolean(),
  closedAt: z.iso.datetime().nullable(),
  lastLocation: z
    .object({
      lat: z.number(),
      lng: z.number(),
      accuracyM: z.number().nullable(),
      capturedAt: z.iso.datetime(),
    })
    .nullable(),
  /** Set when a repeated trigger attached to this already-active alert. */
  reused: z.boolean(),
});
export const sosDetailSchema = sosAlertSchema.extend({
  timeline: z.array(sosEventSchema),
  /** Responders only, while the alert is active. */
  emergencyContacts: z
    .array(z.object({ name: z.string(), phone: z.string(), relationship: z.string() }))
    .nullable(),
});
export const sosListQuerySchema = z.object({
  status: z.enum(['active', 'all']).default('active'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const assignSosSchema = z.object({ userId: z.uuid() });
export const sosNoteSchema = z.object({ note: z.string().trim().min(1).max(1000) });
export const resolveSosSchema = z.object({
  resolution: z.string().trim().min(3).max(1000),
  falseAlarm: z.boolean().default(false),
});
export const closeSosSchema = z.object({
  notes: z.string().trim().max(1000).optional(),
  category: sosCategorySchema.optional(),
});
export const emergencyBroadcastSchema = z.object({
  title: z.string().trim().min(3).max(80),
  body: z.string().trim().min(5).max(320),
  /** Explicit confirmation step (emergency.md §8.9). */
  confirm: z.literal(true),
});
export const emergencyBroadcastResultSchema = z.object({
  id: z.uuid(),
  recipients: z.number().int(),
  sentAt: z.iso.datetime(),
});
