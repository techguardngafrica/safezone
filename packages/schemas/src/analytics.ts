import { z } from 'zod';

const analyticsDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const productEventInputSchema = z.object({
  estateId: z.uuid().nullable().optional(),
  app: z.enum([
    'resident-mobile',
    'management-web',
    'management-mobile',
    'security-mobile',
    'super-admin',
    'public-web',
  ]),
  version: z.string().trim().min(1).max(40),
  event: z.string().trim().min(2).max(100),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
  properties: z.record(z.string(), z.unknown()).default({}),
});

export const ingestProductEventsSchema = z.object({
  events: z.array(productEventInputSchema).min(1).max(50),
});

export const reportScheduleFrequencySchema = z.enum(['weekly', 'monthly']);
export const estateReportKeySchema = z.enum([
  'operations_summary',
  'collections',
  'security_patrols',
  'maintenance_sla',
  'procurement_spend',
  'workforce_attendance',
]);

export const createReportScheduleSchema = z.object({
  reportKey: estateReportKeySchema,
  frequency: reportScheduleFrequencySchema,
  recipients: z.array(z.email()).min(1).max(10),
  format: z.enum(['csv']).default('csv'),
});

export const reportScheduleSchema = z.object({
  id: z.uuid(),
  reportKey: estateReportKeySchema,
  frequency: reportScheduleFrequencySchema,
  recipients: z.array(z.string()),
  format: z.literal('csv'),
  active: z.boolean(),
  lastSentAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export const estateDashboardSchema = z.object({
  estateId: z.uuid(),
  from: analyticsDateSchema,
  to: analyticsDateSchema,
  gate: z.object({
    entries: z.number().int(),
    exits: z.number().int(),
    digitalEntriesPercent: z.number(),
    denies: z.number().int(),
    overrides: z.number().int(),
  }),
  sos: z.object({
    realAlerts: z.number().int(),
    drillAlerts: z.number().int(),
    avgAckSeconds: z.number().nullable(),
    avgResolveSeconds: z.number().nullable(),
  }),
  collections: z.object({
    billedKobo: z.number().int(),
    collectedKobo: z.number().int(),
    digitalPercent: z.number(),
  }),
  maintenance: z.object({
    opened: z.number().int(),
    resolved: z.number().int(),
    breached: z.number().int(),
    avgResolveMinutes: z.number().nullable(),
  }),
  community: z.object({
    posts: z.number().int(),
    reactions: z.number().int(),
    activeUsers: z.number().int(),
  }),
});

export const platformKpisSchema = z.object({
  asOf: analyticsDateSchema,
  suppressionThreshold: z.number().int(),
  activeEstates: z.number().int(),
  totalUsers: z.number().int(),
  monthlyActiveUsers: z.number().int().nullable(),
  suppressed: z.boolean(),
  txVolumeKobo: z.number().int(),
  adRevenueKobo: z.number().int(),
  marketplaceCommissionKobo: z.number().int(),
  adImpressions: z.number().int(),
  adClicks: z.number().int(),
  adCtrPercent: z.number(),
});
