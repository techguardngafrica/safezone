import { z } from 'zod';

/** Security incidents (security.md §2.8, §4; security-mobile.md §7.7). */
export const incidentCategorySchema = z.enum([
  'suspicious_activity',
  'unauthorised_access',
  'theft',
  'fight',
  'fire',
  'accident',
  'damage',
  'other',
]);
export const incidentSeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export const incidentStatusSchema = z.enum([
  'reported',
  'under_review',
  'assigned',
  'resolved',
  'closed',
]);
export const incidentLocationKindSchema = z.enum(['gate', 'unit', 'common_area', 'other']);
export const incidentReporterTypeSchema = z.enum(['guard', 'resident', 'manager']);

export const createIncidentSchema = z
  .object({
    category: incidentCategorySchema,
    severity: incidentSeveritySchema,
    title: z.string().trim().min(3).max(120),
    description: z.string().trim().min(5).max(4000),
    locationKind: incidentLocationKindSchema,
    gateId: z.uuid().optional(),
    spaceId: z.uuid().optional(),
    /** Free text for common areas and anywhere else ("car park behind block C"). */
    locationText: z.string().trim().max(200).optional(),
    occurredAt: z.iso.datetime({ offset: true }),
    peopleInvolved: z.string().trim().max(1000).optional(),
    evidenceFileIds: z.array(z.uuid()).max(10).default([]),
  })
  .refine((value) => value.locationKind !== 'gate' || Boolean(value.gateId), {
    message: 'Choose the gate',
    path: ['gateId'],
  })
  .refine((value) => value.locationKind !== 'unit' || Boolean(value.spaceId), {
    message: 'Choose the unit',
    path: ['spaceId'],
  })
  .refine(
    (value) =>
      (value.locationKind !== 'common_area' && value.locationKind !== 'other') ||
      Boolean(value.locationText),
    { message: 'Describe where it happened', path: ['locationText'] },
  );

export const incidentEvidenceSchema = z.object({
  id: z.uuid(),
  fileId: z.uuid(),
  /** SHA-256 of the stored file when it was attached (chain of custody). */
  sha256: z.string().nullable(),
  uploadedBy: z.uuid(),
  uploadedAt: z.iso.datetime().nullable(),
  addedBy: z.uuid(),
  createdAt: z.iso.datetime(),
});

export const incidentNoteSchema = z.object({
  id: z.uuid(),
  authorId: z.uuid(),
  kind: z.enum(['note', 'status']),
  body: z.string().nullable(),
  fromStatus: incidentStatusSchema.nullable(),
  toStatus: incidentStatusSchema.nullable(),
  createdAt: z.iso.datetime(),
});

export const incidentSchema = z.object({
  id: z.uuid(),
  category: incidentCategorySchema,
  severity: incidentSeveritySchema,
  title: z.string(),
  description: z.string(),
  locationKind: incidentLocationKindSchema,
  gateId: z.uuid().nullable(),
  gateName: z.string().nullable(),
  spaceId: z.uuid().nullable(),
  unitCode: z.string().nullable(),
  locationText: z.string().nullable(),
  occurredAt: z.iso.datetime(),
  peopleInvolved: z.string().nullable(),
  reportedBy: z.uuid(),
  reporterType: incidentReporterTypeSchema,
  status: incidentStatusSchema,
  assignedTo: z.uuid().nullable(),
  resolution: z.string().nullable(),
  linkedSosId: z.uuid().nullable(),
  policeReportRef: z.string().nullable(),
  evidenceCount: z.number().int(),
  version: z.number().int(),
  createdAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
  closedAt: z.iso.datetime().nullable(),
});

export const incidentDetailSchema = incidentSchema.extend({
  evidence: z.array(incidentEvidenceSchema),
  notes: z.array(incidentNoteSchema),
});

export const incidentListQuerySchema = z.object({
  status: incidentStatusSchema.optional(),
  /** Only open incidents (reported, under review, assigned). */
  open: z.stringbool().optional(),
  severity: incidentSeveritySchema.optional(),
  /** Managers: only incidents I reported. Reporters always see only their own (security.md §4.7). */
  mine: z.stringbool().default(false),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});

export const incidentNoteInputSchema = z.object({ body: z.string().trim().min(1).max(2000) });
export const incidentEvidenceInputSchema = z.object({
  fileIds: z.array(z.uuid()).min(1).max(10),
});

export const incidentActionSchema = z.enum(['review', 'assign', 'resolve', 'reopen', 'close']);
export const incidentTransitionSchema = z
  .object({
    action: incidentActionSchema,
    /** Optimistic concurrency: the version the manager was looking at. */
    version: z.number().int().min(1),
    assigneeId: z.uuid().optional(),
    resolution: z.string().trim().min(3).max(2000).optional(),
    policeReportRef: z.string().trim().max(60).optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .refine((value) => value.action !== 'assign' || Boolean(value.assigneeId), {
    message: 'Choose who to assign',
    path: ['assigneeId'],
  })
  .refine((value) => value.action !== 'resolve' || Boolean(value.resolution), {
    message: 'Say how it was resolved',
    path: ['resolution'],
  });
