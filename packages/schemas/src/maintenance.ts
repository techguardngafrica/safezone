import { z } from 'zod';
import { koboSchema, positiveKoboSchema } from './billing';
import { phoneE164Schema } from './common';

/** Maintenance and complaints (maintenance.md, Phase 2). */
export const maintenancePrioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);
export const maintenanceKindSchema = z.enum(['maintenance', 'complaint']);
export const requestStatusSchema = z.enum([
  'submitted',
  'under_review',
  'info_requested',
  'approved',
  'assigned',
  'in_progress',
  'awaiting_materials',
  'resolved',
  'closed',
  'rejected',
  'cancelled',
]);
export const workOrderStatusSchema = z.enum([
  'open',
  'scheduled',
  'in_progress',
  'on_hold',
  'completed',
  'verified',
  'closed',
  'cancelled',
]);

export const DEFAULT_MAINTENANCE_CATEGORIES = [
  'Plumbing',
  'Electrical',
  'Structural',
  'Cleaning',
  'Landscaping',
  'Security equipment',
  'Generator',
  'Water',
  'Pest control',
  'Noise',
  'Neighbour',
  'Service quality',
  'Other',
] as const;

export const maintenanceCategorySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: maintenanceKindSchema,
  defaultPriority: maintenancePrioritySchema,
  active: z.boolean(),
});
export const createMaintenanceCategorySchema = z.object({
  name: z.string().trim().min(2).max(60),
  kind: maintenanceKindSchema.default('maintenance'),
  defaultPriority: maintenancePrioritySchema.default('normal'),
});
export const updateMaintenanceCategorySchema = z
  .object({
    name: z.string().trim().min(2).max(60).optional(),
    defaultPriority: maintenancePrioritySchema.optional(),
    active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });

export const createMaintenanceRequestSchema = z.object({
  kind: maintenanceKindSchema.default('maintenance'),
  categoryId: z.uuid(),
  priority: maintenancePrioritySchema.optional(),
  /** A unit (in-unit work) or a common area; leave out for estate-wide complaints. */
  spaceId: z.uuid().optional(),
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(3).max(4000),
  preferredTimes: z.string().trim().max(300).optional(),
  /** Complaints about a named neighbour are visible to management only (maintenance.md rule 2). */
  aboutNeighbour: z.boolean().default(false),
  attachmentFileIds: z.array(z.uuid()).max(10).default([]),
});

export const maintenanceRequestSchema = z.object({
  id: z.uuid(),
  number: z.string(),
  kind: maintenanceKindSchema,
  categoryId: z.uuid(),
  categoryName: z.string(),
  priority: maintenancePrioritySchema,
  spaceId: z.uuid().nullable(),
  unitCode: z.string().nullable(),
  title: z.string(),
  description: z.string(),
  preferredTimes: z.string().nullable(),
  aboutNeighbour: z.boolean(),
  requestedBy: z.uuid(),
  status: requestStatusSchema,
  slaDueAt: z.iso.datetime().nullable(),
  slaBreached: z.boolean(),
  rejectionReason: z.string().nullable(),
  rating: z.number().int().nullable(),
  feedback: z.string().nullable(),
  attachmentFileIds: z.array(z.uuid()),
  createdAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
  closedAt: z.iso.datetime().nullable(),
});

export const maintenanceCommentSchema = z.object({
  id: z.uuid(),
  authorId: z.uuid(),
  body: z.string(),
  internal: z.boolean(),
  createdAt: z.iso.datetime(),
});

export const maintenanceRequestDetailSchema = maintenanceRequestSchema.extend({
  comments: z.array(maintenanceCommentSchema),
  workOrderIds: z.array(z.uuid()),
});

export const maintenanceRequestListQuerySchema = z.object({
  status: requestStatusSchema.optional(),
  kind: maintenanceKindSchema.optional(),
  /** Staff: only requests I submitted. */
  mine: z.stringbool().default(false),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
});

export const requestTransitionSchema = z.object({ note: z.string().trim().max(1000).optional() });
export const requestReasonSchema = z.object({ reason: z.string().trim().min(3).max(1000) });
export const rateRequestSchema = z.object({
  rating: z.number().int().min(1).max(5),
  feedback: z.string().trim().max(1000).optional(),
});
export const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(2000),
  /** Staff-only note, never shown to the requester. */
  internal: z.boolean().default(false),
});

// ---- Work orders -------------------------------------------------------------------------------

export const workOrderAssigneeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('staff'), userId: z.uuid() }),
  z.object({
    type: z.literal('vendor'),
    name: z.string().trim().min(2).max(120),
    phone: phoneE164Schema,
    company: z.string().trim().max(120).optional(),
  }),
]);

export const createWorkOrderSchema = z.object({
  requestId: z.uuid().optional(),
  title: z.string().trim().min(3).max(120),
  scope: z.string().trim().max(4000).optional(),
  spaceId: z.uuid().optional(),
  assignee: workOrderAssigneeSchema.optional(),
  scheduledStart: z.iso.datetime({ offset: true }).optional(),
  scheduledEnd: z.iso.datetime({ offset: true }).optional(),
});

export const updateWorkOrderSchema = z
  .object({
    assignee: workOrderAssigneeSchema.optional(),
    scheduledStart: z.iso.datetime({ offset: true }).optional(),
    scheduledEnd: z.iso.datetime({ offset: true }).optional(),
    status: z.enum(['scheduled', 'in_progress', 'on_hold', 'completed', 'cancelled']).optional(),
    labourCost: koboSchema.optional(),
    resolutionNotes: z.string().trim().max(4000).optional(),
    resolutionFileIds: z.array(z.uuid()).max(10).optional(),
    rechargeToResident: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });

export const addMaterialSchema = z.object({
  item: z.string().trim().min(2).max(120),
  quantity: z.number().positive().max(100_000),
  unitCost: positiveKoboSchema,
});

export const workOrderSchema = z.object({
  id: z.uuid(),
  number: z.string(),
  requestId: z.uuid().nullable(),
  title: z.string(),
  scope: z.string().nullable(),
  spaceId: z.uuid().nullable(),
  assigneeType: z.enum(['staff', 'vendor']).nullable(),
  assigneeUserId: z.uuid().nullable(),
  vendorName: z.string().nullable(),
  scheduledStart: z.iso.datetime().nullable(),
  scheduledEnd: z.iso.datetime().nullable(),
  status: workOrderStatusSchema,
  visitorPassId: z.uuid().nullable(),
  labourCost: koboSchema,
  materialsCost: koboSchema,
  rechargeToResident: z.boolean(),
  invoiceId: z.uuid().nullable(),
  resolutionNotes: z.string().nullable(),
  materials: z.array(
    z.object({
      id: z.uuid(),
      item: z.string(),
      quantity: z.number(),
      unitCost: koboSchema,
      amount: koboSchema,
    }),
  ),
  completedAt: z.iso.datetime().nullable(),
  verifiedBy: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});

export const workOrderListQuerySchema = z.object({
  /** `me`: work assigned to me. */
  assignee: z.literal('me').optional(),
  status: workOrderStatusSchema.optional(),
  requestId: z.uuid().optional(),
});

// ---- Planned work, SLAs, reports ---------------------------------------------------------------

export const recurringFrequencySchema = z.enum(['weekly', 'monthly', 'quarterly', 'annually']);
export const createRecurringMaintenanceSchema = z.object({
  title: z.string().trim().min(3).max(120),
  scope: z.string().trim().max(4000).optional(),
  spaceId: z.uuid().optional(),
  frequency: recurringFrequencySchema,
  /** First due date (YYYY-MM-DD, WAT). */
  startsOn: z.iso.date(),
  assignee: workOrderAssigneeSchema.optional(),
});
export const recurringMaintenanceSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  scope: z.string().nullable(),
  spaceId: z.uuid().nullable(),
  frequency: recurringFrequencySchema,
  nextRunOn: z.iso.date(),
  active: z.boolean(),
  lastWorkOrderId: z.uuid().nullable(),
});

export const slaPolicySchema = z.object({
  priority: maintenancePrioritySchema,
  responseMinutes: z.number().int().min(5).max(10_080),
  resolutionHours: z.number().int().min(1).max(2_160),
});
export const putSlaPoliciesSchema = z.object({ policies: z.array(slaPolicySchema).min(1).max(4) });

export const maintenanceReportQuerySchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
});
export const maintenanceReportSchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  submitted: z.number().int(),
  resolved: z.number().int(),
  open: z.number().int(),
  averageResolutionHours: z.number().nullable(),
  slaCompliancePercent: z.number().nullable(),
  averageRating: z.number().nullable(),
  byCategory: z.array(z.object({ category: z.string(), count: z.number().int() })),
  byStatus: z.array(z.object({ status: requestStatusSchema, count: z.number().int() })),
  costs: z.object({ labour: koboSchema, materials: koboSchema, recharged: koboSchema }),
});

export const maintenanceRequestItemParamsSchema = z.object({ estateId: z.uuid(), id: z.uuid() });
