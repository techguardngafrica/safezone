import { z } from 'zod';

const secDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

// ---- Cross-Estate Security Companies (platform-level) -------------------------------------------

export const securityCompanyStatusSchema = z.enum(['active', 'suspended']);
export const securityContractStatusSchema = z.enum(['pending', 'active', 'terminated']);

export const createSecurityCompanySchema = z.object({
  name: z.string().trim().min(2).max(160),
  registrationNumber: z.string().trim().max(80).optional(),
  contactName: z.string().trim().min(2).max(120),
  contactPhone: z.string().trim().min(7).max(40),
  contactEmail: z.email().optional(),
});

export const updateSecurityCompanySchema = createSecurityCompanySchema.partial().extend({
  status: securityCompanyStatusSchema.optional(),
});

export const securityCompanySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  registrationNumber: z.string().nullable(),
  contactName: z.string(),
  contactPhone: z.string(),
  contactEmail: z.string().nullable(),
  status: securityCompanyStatusSchema,
  guardCount: z.number().int(),
  activeContractCount: z.number().int(),
  createdAt: z.iso.datetime(),
});

export const addCompanyGuardSchema = z.object({
  userId: z.uuid(),
  badgeNumber: z.string().trim().min(2).max(60),
});

export const companyGuardSchema = z.object({
  id: z.uuid(),
  companyId: z.uuid(),
  userId: z.uuid(),
  badgeNumber: z.string(),
  status: z.enum(['active', 'inactive']),
  createdAt: z.iso.datetime(),
});

export const createSecurityContractSchema = z.object({
  companyId: z.uuid(),
  estateId: z.uuid(),
  startsOn: secDateSchema,
  endsOn: secDateSchema.optional(),
});

export const securityContractSchema = z.object({
  id: z.uuid(),
  companyId: z.uuid(),
  companyName: z.string(),
  estateId: z.uuid(),
  startsOn: secDateSchema,
  endsOn: secDateSchema.nullable(),
  status: securityContractStatusSchema,
  approvedBy: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});

// ---- Patrol Routes, Checkpoints & Offline Sync (tenant-level) -----------------------------------

export const checkpointTagTypeSchema = z.enum(['qr', 'nfc']);
export const patrolRunStatusSchema = z.enum(['in_progress', 'completed', 'incomplete']);

export const createPatrolRouteSchema = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(500).optional(),
  intervalMinutes: z.number().int().min(10).max(1440).default(60),
  checkpoints: z
    .array(
      z.object({
        sequence: z.number().int().min(1),
        name: z.string().trim().min(2).max(120),
        spaceId: z.uuid().optional(),
        tagType: checkpointTagTypeSchema.default('qr'),
        tagCode: z.string().trim().min(4).max(120),
      }),
    )
    .min(1)
    .max(50),
});

export const patrolCheckpointSchema = z.object({
  id: z.uuid(),
  routeId: z.uuid(),
  sequence: z.number().int(),
  name: z.string(),
  spaceId: z.uuid().nullable(),
  tagType: checkpointTagTypeSchema,
  tagCode: z.string(),
  active: z.boolean(),
});

export const patrolRouteSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  intervalMinutes: z.number().int(),
  active: z.boolean(),
  checkpoints: z.array(patrolCheckpointSchema),
  createdAt: z.iso.datetime(),
});

export const startPatrolRunSchema = z.object({
  routeId: z.uuid(),
  deviceId: z.uuid().optional(),
});

export const scanCheckpointSchema = z.object({
  checkpointId: z.uuid().optional(),
  tagCode: z.string().trim().min(4).max(120).optional(),
  scannedAt: z.iso.datetime({ offset: true }).optional(),
  offlineRecorded: z.boolean().default(false),
  notes: z.string().trim().max(400).optional(),
  photoFileId: z.uuid().optional(),
});

export const syncPatrolScansSchema = z.object({
  scans: z
    .array(
      z.object({
        runId: z.uuid(),
        checkpointId: z.uuid().optional(),
        tagCode: z.string().trim().min(4).max(120).optional(),
        scannedAt: z.iso.datetime({ offset: true }),
        notes: z.string().trim().max(400).optional(),
      }),
    )
    .min(1)
    .max(200),
});

export const patrolLogSchema = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  checkpointId: z.uuid(),
  checkpointName: z.string(),
  guardUserId: z.uuid(),
  scannedAt: z.iso.datetime(),
  offlineRecorded: z.boolean(),
  notes: z.string().nullable(),
  photoFileId: z.uuid().nullable(),
});

export const patrolRunSchema = z.object({
  id: z.uuid(),
  routeId: z.uuid(),
  routeName: z.string(),
  guardUserId: z.uuid(),
  deviceId: z.uuid().nullable(),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  status: patrolRunStatusSchema,
  scannedCount: z.number().int(),
  totalCheckpoints: z.number().int(),
  logs: z.array(patrolLogSchema).optional(),
});
