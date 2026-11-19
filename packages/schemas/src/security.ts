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

/** Shift sessions and handover (security.md §2.5 to §2.7, security-mobile.md §7.8). */
export const startShiftSchema = z.object({ gateId: z.uuid() });
export const endShiftSchema = z.object({
  /** Required (rule 4); "Nothing to report" is fine. */
  handoverNote: z.string().trim().min(3).max(4000),
});
export const shiftSessionSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  gateId: z.uuid(),
  gateName: z.string().nullable(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  handoverNote: z.string().nullable(),
  endedBy: z.uuid().nullable(),
});
export const currentShiftQuerySchema = z.object({ gateId: z.uuid() });
export const currentShiftSchema = z.object({
  /** The caller's open shift in this estate, at any gate. */
  mine: shiftSessionSchema.nullable(),
  /** The last finished shift at this gate, with its handover note. */
  previous: shiftSessionSchema.nullable(),
  /** Incidents still open that the caller reported or was assigned (managers: all). */
  openIncidents: z.number().int(),
});
export const shiftListQuerySchema = z.object({
  gateId: z.uuid().optional(),
  userId: z.uuid().optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  /** Only shifts still open. */
  open: z.stringbool().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
});

/** Gate devices and guard PIN sign-in (ADR-0017). */
export const deviceCredentialSchema = z.string().min(40).max(200);
export const guardPinSchema = z.string().regex(/^\d{6}$/, 'Use 6 digits');

export const registerGateDeviceSchema = z.object({
  gateId: z.uuid(),
  name: z.string().trim().min(2).max(60),
});
export const gateDeviceSchema = z.object({
  id: z.uuid(),
  gateId: z.uuid(),
  gateName: z.string().nullable(),
  name: z.string(),
  status: z.enum(['active', 'revoked']),
  registeredBy: z.uuid(),
  lastSeenAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().nullable(),
});
export const gateDeviceRegisteredSchema = z.object({
  device: gateDeviceSchema,
  /** Shown once. Store it in the device keychain; the server keeps only its HMAC. */
  credential: z.string(),
});

export const setGuardPinSchema = z.object({ pin: guardPinSchema });
export const guardPinStatusSchema = z.object({ pinSet: z.boolean(), locked: z.boolean() });

export const gateDeviceRequestSchema = z.object({ deviceCredential: deviceCredentialSchema });
export const gateGuardsSchema = z.object({
  estate: z.object({ id: z.uuid(), name: z.string() }),
  gate: z.object({ id: z.uuid(), name: z.string() }),
  device: z.object({ id: z.uuid(), name: z.string() }),
  /** First name and last initial only (AGENTS.md §6.5). */
  guards: z.array(
    z.object({
      userId: z.uuid(),
      displayName: z.string(),
      pinSet: z.boolean(),
      locked: z.boolean(),
      /** When the PIN was last set, so the device can drop offline verifiers made before it. */
      pinSetAt: z.iso.datetime().nullable(),
    }),
  ),
});

export const gateSignInSchema = z.object({
  deviceCredential: deviceCredentialSchema,
  userId: z.uuid(),
  pin: guardPinSchema,
  platform: z.enum(['android', 'ios']),
  appVersion: z.string().min(1).max(40),
});
export const gateSignInResultSchema = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: z.iso.datetime(),
  refreshToken: z.string(),
  mfaRequired: z.literal(false),
  mfaEnrolled: z.boolean(),
  isNewUser: z.literal(false),
  user: z.object({
    id: z.uuid(),
    /** Masked: a shared device never shows a guard's full number. */
    phone: z.string(),
    fullName: z.string().nullable(),
    mfaEnabled: z.boolean(),
  }),
  /** The session ends here whatever happens (12 hours). */
  sessionExpiresAt: z.iso.datetime(),
  estateId: z.uuid(),
  gateId: z.uuid(),
  deviceId: z.uuid(),
  /** Null when the guard still has a shift open at another gate. */
  shiftId: z.uuid().nullable(),
  pinSetAt: z.iso.datetime(),
});
