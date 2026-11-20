import { z } from 'zod';

// ---- Bulk imports (management-web.md §6.4; ADR-0019) --------------------------------------------

export const bulkImportKindSchema = z.enum([
  'units',
  'owners',
  'residents',
  'households',
  'vehicles',
  'opening_balances',
]);
export type BulkImportKind = z.infer<typeof bulkImportKindSchema>;

export const bulkImportStatusSchema = z.enum([
  'dry_run',
  'queued',
  'running',
  'completed',
  'failed',
]);

export const bulkImportTemplateParamsSchema = z.object({
  estateId: z.uuid(),
  kind: bulkImportKindSchema,
});

export const bulkImportTemplateSchema = z.object({
  kind: bulkImportKindSchema,
  filename: z.string(),
  headers: z.array(z.string()),
  csv: z.string(),
});

export const bulkImportDryRunSchema = z.object({
  kind: bulkImportKindSchema,
  filename: z.string().trim().min(1).max(200),
  csv: z.string().min(1).max(5_000_000),
});

export const bulkImportRowErrorSchema = z.object({
  row: z.number().int().min(1),
  field: z.string().nullable(),
  message: z.string(),
});

export const bulkImportJobSchema = z.object({
  id: z.uuid(),
  kind: bulkImportKindSchema,
  status: bulkImportStatusSchema,
  filename: z.string(),
  totalRows: z.number().int(),
  validRows: z.number().int(),
  errorRows: z.number().int(),
  createdCount: z.number().int(),
  updatedCount: z.number().int(),
  errors: z.array(bulkImportRowErrorSchema),
  createdBy: z.uuid(),
  confirmedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

// ---- Support-access consent (management-web.md §6.13; ADR-0019) ---------------------------------

export const supportSessionStatusSchema = z.enum([
  'pending',
  'approved',
  'denied',
  'revoked',
  'expired',
]);

export const requestSupportSessionSchema = z.object({
  reason: z.string().trim().min(5).max(500),
  durationMinutes: z.number().int().min(15).max(480).default(60),
});

export const supportSessionDecisionSchema = z.object({
  reason: z.string().trim().min(3).max(500).optional(),
  durationMinutes: z.number().int().min(15).max(480).optional(),
});

export const supportSessionSchema = z.object({
  id: z.uuid(),
  estateId: z.uuid(),
  platformUserId: z.uuid(),
  platformUserName: z.string().nullable(),
  reason: z.string(),
  status: supportSessionStatusSchema,
  durationMinutes: z.number().int(),
  requestedAt: z.iso.datetime(),
  decidedBy: z.uuid().nullable(),
  decidedAt: z.iso.datetime().nullable(),
  decisionReason: z.string().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
});

// ---- Global search (management-web.md §5) -------------------------------------------------------

export const globalSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(120),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

export const globalSearchHitSchema = z.object({
  kind: z.enum(['space', 'resident', 'vehicle', 'pass', 'invoice']),
  id: z.string(),
  title: z.string(),
  subtitle: z.string().nullable(),
  href: z.string(),
});

export const globalSearchResultSchema = z.object({
  query: z.string(),
  hits: z.array(globalSearchHitSchema),
});

// ---- Estate reports summary (management-web.md §6.12) -------------------------------------------

export const estateReportQuerySchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
});

export const estateReportSummarySchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  generatedAt: z.iso.datetime(),
  occupancy: z.object({
    totalUnits: z.number().int(),
    occupiedUnits: z.number().int(),
    vacantUnits: z.number().int(),
    activeHouseholds: z.number().int(),
    activeResidents: z.number().int(),
  }),
  visitors: z.object({
    totalEvents: z.number().int(),
    entries: z.number().int(),
    exits: z.number().int(),
    denials: z.number().int(),
    overrides: z.number().int(),
    activePasses: z.number().int(),
  }),
  incidents: z.object({
    total: z.number().int(),
    open: z.number().int(),
    resolved: z.number().int(),
    bySeverity: z.array(z.object({ severity: z.string(), count: z.number().int() })),
    byCategory: z.array(z.object({ category: z.string(), count: z.number().int() })),
  }),
  sos: z.object({
    total: z.number().int(),
    realAlerts: z.number().int(),
    drills: z.number().int(),
    avgAckSeconds: z.number().int().nullable(),
    avgResolveSeconds: z.number().int().nullable(),
  }),
  finance: z.object({
    billedKobo: z.number().int(),
    collectedKobo: z.number().int(),
    outstandingKobo: z.number().int(),
    ageing: z.object({
      currentKobo: z.number().int(),
      days30Kobo: z.number().int(),
      days60Kobo: z.number().int(),
      days90PlusKobo: z.number().int(),
    }),
  }),
  attendance: z.object({
    totalShifts: z.number().int(),
    openShifts: z.number().int(),
    totalMinutes: z.number().int(),
  }),
});
