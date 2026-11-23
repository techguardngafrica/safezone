import { z } from 'zod';
import { appVersionParamsSchema } from './platform';
import { featureKeySchema } from './tenancy';

/** Platform overview KPIs (super-admin.md §5). */
export const platformOverviewSchema = z.object({
  estates: z.object({
    total: z.number().int(),
    active: z.number().int(),
    approved: z.number().int(),
    suspended: z.number().int(),
    deactivated: z.number().int(),
  }),
  applications: z.object({
    submitted: z.number().int(),
    underReview: z.number().int(),
    infoRequested: z.number().int(),
  }),
  leads: z.object({
    newCount: z.number().int(),
    contactedCount: z.number().int(),
  }),
  users: z.object({
    total: z.number().int(),
    locked: z.number().int(),
  }),
  support: z.object({
    openTickets: z.number().int(),
    activeSessions: z.number().int(),
    pendingSessions: z.number().int(),
  }),
  compliance: z.object({
    openDsrs: z.number().int(),
    openBreaches: z.number().int(),
  }),
});

/** App version row for GET /v1/platform/app-versions. */
export const appVersionRowSchema = appVersionParamsSchema.extend({
  minVersion: z.string(),
  recommendedVersion: z.string(),
  message: z.string().nullable(),
  updatedAt: z.iso.datetime(),
});

/** Provider runtime status (read-only; secrets live in vault). */
export const platformProviderStatusSchema = z.object({
  category: z.enum(['sms', 'email', 'push', 'payments', 'storage', 'utilities']),
  provider: z.string(),
  configured: z.boolean(),
  mode: z.enum(['live', 'sandbox', 'fake']),
  notes: z.string(),
});

/** Plans and per-estate entitlements (super-admin.md §6.2, §6.9). */
export const platformPlanSchema = z.object({
  key: z.string(),
  name: z.string(),
  features: z.array(z.string()),
  isDefault: z.boolean(),
});

export const estateEntitlementSchema = z.object({
  module: z.string(),
  enabled: z.boolean(),
  source: z.enum(['plan', 'override']),
});

export const upsertEstateEntitlementSchema = z.object({
  enabled: z.boolean(),
  reason: z.string().trim().min(5).max(500),
});

export const estateEntitlementParamsSchema = z.object({
  id: z.uuid(),
  /** Only catalogued feature keys; a typo must never become a stored override. */
  module: featureKeySchema,
});

/** Platform user lookup and account actions (super-admin.md §6.3). */
export const platformUserListQuerySchema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  status: z.enum(['active', 'locked', 'deactivated']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).optional(),
});

export const platformUserSummarySchema = z.object({
  id: z.uuid(),
  fullName: z.string().nullable(),
  phone: z.string(),
  email: z.string().nullable(),
  status: z.string(),
  mfaEnabled: z.boolean(),
  estateCount: z.number().int(),
  platformRoles: z.array(z.string()),
  createdAt: z.iso.datetime(),
});

export const platformUserDetailSchema = platformUserSummarySchema.extend({
  activeSessionCount: z.number().int(),
  memberships: z.array(
    z.object({
      estateId: z.uuid(),
      estateName: z.string(),
      status: z.string(),
      roles: z.array(z.string()),
    }),
  ),
});

export const platformUserActionSchema = z.object({
  reason: z.string().trim().min(5).max(1000),
});

/** Platform staff management (super-admin.md §6.3). */
export const platformStaffRoleAssignmentSchema = z.object({
  assignmentId: z.uuid(),
  roleKey: z.string(),
  roleName: z.string(),
  grantedAt: z.iso.datetime(),
});

export const platformStaffMemberSchema = z.object({
  userId: z.uuid(),
  fullName: z.string().nullable(),
  phone: z.string(),
  email: z.string().nullable(),
  status: z.string(),
  mfaEnabled: z.boolean(),
  roles: z.array(platformStaffRoleAssignmentSchema),
});

export const assignPlatformRoleSchema = z.object({
  userId: z.uuid(),
  roleKey: z.string().min(2).max(60),
  reason: z.string().trim().min(5).max(1000),
});

export const assignmentIdParamSchema = z.object({
  assignmentId: z.uuid(),
});

/** Platform support sessions list query. */
export const platformSupportSessionListQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'denied', 'revoked', 'expired']).optional(),
  estateId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).optional(),
});

export const platformSupportSessionSchema = z.object({
  id: z.uuid(),
  estateId: z.uuid(),
  estateName: z.string().nullable(),
  platformUserId: z.uuid(),
  platformUserName: z.string().nullable(),
  reason: z.string(),
  status: z.enum(['pending', 'approved', 'denied', 'revoked', 'expired']),
  durationMinutes: z.number().int(),
  requestedAt: z.iso.datetime(),
  decidedBy: z.uuid().nullable(),
  decidedAt: z.iso.datetime().nullable(),
  decisionReason: z.string().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
});

/** Support tickets (platform.md §3, ADR-0022). */
export const supportTicketStatusSchema = z.enum([
  'new',
  'open',
  'pending_customer',
  'resolved',
  'closed',
]);
export const supportTicketPrioritySchema = z.enum(['critical', 'high', 'normal', 'low']);
export const supportTicketCategorySchema = z.enum([
  'gate_sos',
  'onboarding',
  'billing',
  'technical',
  'account',
  'other',
]);
export const supportTicketChannelSchema = z.enum([
  'in_app',
  'email',
  'whatsapp',
  'phone',
  'internal',
]);

export const supportTicketSchema = z.object({
  id: z.uuid(),
  estateId: z.uuid().nullable(),
  requesterUserId: z.uuid().nullable(),
  requesterName: z.string().nullable(),
  requesterContact: z.string().nullable(),
  channel: supportTicketChannelSchema,
  category: supportTicketCategorySchema,
  priority: supportTicketPrioritySchema,
  subject: z.string(),
  description: z.string(),
  status: supportTicketStatusSchema,
  assigneeId: z.uuid().nullable(),
  slaDueAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const supportTicketMessageSchema = z.object({
  id: z.uuid(),
  ticketId: z.uuid(),
  authorId: z.uuid(),
  body: z.string(),
  internal: z.boolean(),
  createdAt: z.iso.datetime(),
});

export const supportTicketDetailSchema = supportTicketSchema.extend({
  messages: z.array(supportTicketMessageSchema),
});

export const supportTicketListQuerySchema = z.object({
  status: supportTicketStatusSchema.optional(),
  priority: supportTicketPrioritySchema.optional(),
  estateId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).optional(),
});

export const createSupportTicketSchema = z.object({
  estateId: z.uuid().optional(),
  requesterUserId: z.uuid().optional(),
  requesterName: z.string().trim().min(2).max(120).optional(),
  requesterContact: z.string().trim().min(3).max(120).optional(),
  channel: supportTicketChannelSchema.default('internal'),
  category: supportTicketCategorySchema.default('technical'),
  priority: supportTicketPrioritySchema.default('normal'),
  subject: z.string().trim().min(3).max(200),
  description: z.string().trim().min(5).max(4000),
});

export const updateSupportTicketSchema = z.object({
  status: supportTicketStatusSchema.optional(),
  priority: supportTicketPrioritySchema.optional(),
  assigneeId: z.uuid().nullable().optional(),
});

export const createSupportTicketMessageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  internal: z.boolean().default(false),
});

/** Cross-estate transactions (super-admin.md §6.7). */
/** Derived from amount_refunded vs amount; payment_transactions only holds settled payments. */
export const platformTransactionStatusSchema = z.enum([
  'succeeded',
  'partially_refunded',
  'refunded',
]);
export type PlatformTransactionStatus = z.infer<typeof platformTransactionStatusSchema>;

export const platformTransactionListQuerySchema = z.object({
  estateId: z.uuid().optional(),
  status: platformTransactionStatusSchema.optional(),
  provider: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).optional(),
});

export const platformTransactionSchema = z.object({
  id: z.uuid(),
  estateId: z.uuid(),
  estateName: z.string().nullable(),
  reference: z.string(),
  provider: z.string(),
  channel: z.string().nullable(),
  status: platformTransactionStatusSchema,
  amountKobo: z.number().int(),
  currency: z.string(),
  paidAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

/** Compliance: DSRs, Breach Log, Retention Rules (super-admin.md §6.8, ADR-0022). */
export const dsrTypeSchema = z.enum(['access', 'correction', 'deletion', 'export', 'objection']);
export const dsrStatusSchema = z.enum([
  'received',
  'identity_verified',
  'in_progress',
  'completed',
  'rejected',
]);

export const dsrSchema = z.object({
  id: z.uuid(),
  userId: z.uuid().nullable(),
  subjectName: z.string(),
  subjectContact: z.string(),
  type: dsrTypeSchema,
  status: dsrStatusSchema,
  notes: z.string().nullable(),
  receivedAt: z.iso.datetime(),
  dueAt: z.iso.datetime(),
  identityCheckedBy: z.uuid().nullable(),
  identityCheckedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
});

export const dsrListQuerySchema = z.object({
  status: dsrStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).optional(),
});

export const createDsrSchema = z.object({
  userId: z.uuid().optional(),
  subjectName: z.string().trim().min(2).max(120),
  subjectContact: z.string().trim().min(3).max(160),
  type: dsrTypeSchema,
  notes: z.string().trim().max(2000).optional(),
});

export const updateDsrSchema = z.object({
  status: dsrStatusSchema.optional(),
  markIdentityChecked: z.boolean().optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const breachSeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export const breachStatusSchema = z.enum(['investigating', 'contained', 'notified', 'closed']);

export const breachSchema = z.object({
  id: z.uuid(),
  detectedAt: z.iso.datetime(),
  title: z.string(),
  description: z.string(),
  severity: breachSeveritySchema,
  affectedEstates: z.number().int(),
  affectedCount: z.number().int(),
  ndpcNotifiedAt: z.iso.datetime().nullable(),
  subjectsNotifiedAt: z.iso.datetime().nullable(),
  status: breachStatusSchema,
  createdAt: z.iso.datetime(),
});

export const createBreachSchema = z.object({
  detectedAt: z.iso.datetime().optional(),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(5).max(4000),
  severity: breachSeveritySchema,
  affectedEstates: z.coerce.number().int().min(0).default(0),
  affectedCount: z.coerce.number().int().min(0).default(0),
});

export const updateBreachSchema = z.object({
  status: breachStatusSchema.optional(),
  markNdpcNotified: z.boolean().optional(),
  markSubjectsNotified: z.boolean().optional(),
  affectedEstates: z.coerce.number().int().min(0).optional(),
  affectedCount: z.coerce.number().int().min(0).optional(),
});

export const retentionActionSchema = z.enum(['delete', 'anonymise', 'archive']);
export const retentionRuleSchema = z.object({
  dataType: z.string().min(2).max(80),
  retentionDays: z.number().int().min(1).max(36500),
  basis: z.string().min(3).max(300),
  action: retentionActionSchema,
  updatedAt: z.iso.datetime(),
});
export const upsertRetentionRuleSchema = retentionRuleSchema.omit({ updatedAt: true });

/** DPIA records register (super-admin.md §6.8). */
export const dpiaRiskLevelSchema = z.enum(['low', 'medium', 'high']);
export const dpiaStatusSchema = z.enum(['draft', 'in_review', 'approved', 'requires_update']);

export const dpiaRecordSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  estateId: z.uuid().nullable(),
  processingActivity: z.string(),
  riskLevel: dpiaRiskLevelSchema,
  status: dpiaStatusSchema,
  mitigations: z.string(),
  documentFileId: z.uuid().nullable(),
  reviewedBy: z.uuid().nullable(),
  reviewedAt: z.iso.datetime().nullable(),
  nextReviewAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const createDpiaRecordSchema = z.object({
  title: z.string().trim().min(3).max(200),
  estateId: z.uuid().optional(),
  processingActivity: z.string().trim().min(5).max(4000),
  riskLevel: dpiaRiskLevelSchema,
  mitigations: z.string().trim().min(5).max(4000),
  documentFileId: z.uuid().optional(),
  nextReviewAt: z.iso.datetime({ offset: true }).optional(),
});

export const updateDpiaRecordSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  processingActivity: z.string().trim().min(5).max(4000).optional(),
  riskLevel: dpiaRiskLevelSchema.optional(),
  status: dpiaStatusSchema.optional(),
  mitigations: z.string().trim().min(5).max(4000).optional(),
  documentFileId: z.uuid().nullable().optional(),
  nextReviewAt: z.iso.datetime({ offset: true }).nullable().optional(),
});

/** Platform notification template catalogue (super-admin.md §6.9). */
export const platformNotificationTemplateSchema = z.object({
  intent: z.string(),
  category: z.string(),
  priority: z.enum(['critical', 'high', 'normal', 'bulk']),
  mandatory: z.boolean(),
  channels: z.array(z.enum(['push', 'sms', 'email', 'whatsapp'])),
  smsOnlyWithoutPush: z.boolean(),
  titleKey: z.string(),
  bodyKey: z.string(),
  smsKey: z.string().nullable(),
  titleText: z.string(),
  bodyText: z.string(),
  smsText: z.string().nullable(),
});

/** Platform audit log query (super-admin.md §5). */
export const platformAuditQuerySchema = z.object({
  estateId: z.uuid().optional(),
  actorId: z.uuid().optional(),
  action: z.string().trim().min(1).max(120).optional(),
  resourceType: z.string().trim().min(1).max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).optional(),
});

export const platformAuditEventSchema = z.object({
  id: z.uuid(),
  estateId: z.uuid().nullable(),
  occurredAt: z.iso.datetime(),
  actorType: z.string(),
  actorId: z.string().nullable(),
  actingRole: z.string().nullable(),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string().nullable(),
  reason: z.string().nullable(),
  app: z.string().nullable(),
});

/** Platform health (super-admin.md §6.10). */
export const platformQueueHealthSchema = z.object({
  name: z.string(),
  waiting: z.number().int(),
  active: z.number().int(),
  delayed: z.number().int(),
  failed: z.number().int(),
});

export const platformHealthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  checkedAt: z.iso.datetime(),
  checks: z.object({
    database: z.enum(['ok', 'fail']),
    redis: z.enum(['ok', 'fail']),
  }),
  queues: z.array(platformQueueHealthSchema),
});
