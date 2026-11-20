import { z } from 'zod';
import { phoneE164Schema } from './common';

export const estateParamSchema = z.object({ estateId: z.uuid() });

export const permissionSnapshotQuerySchema = z.object({ estateId: z.uuid().optional() });

/** What the client UI may show. The API still enforces every permission. */
export const permissionSnapshotSchema = z.object({
  estateId: z.uuid().nullable(),
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
  features: z.array(z.string()),
});
export type PermissionSnapshot = z.infer<typeof permissionSnapshotSchema>;

export const permissionCatalogueSchema = z.array(
  z.object({ key: z.string(), description: z.string() }),
);

export const estateRoleSchema = z.object({
  id: z.uuid().nullable(),
  key: z.string(),
  name: z.string(),
  isBuiltin: z.boolean(),
  permissions: z.array(z.string()),
});

export const createEstateRoleSchema = z.object({
  name: z.string().trim().min(2).max(60),
  permissions: z.array(z.string().min(1)).min(1).max(60),
});

export const updateEstateRoleSchema = z
  .object({
    name: z.string().trim().min(2).max(60).optional(),
    permissions: z.array(z.string().min(1)).min(1).max(60).optional(),
  })
  .refine((value) => value.name !== undefined || value.permissions !== undefined, {
    message: 'Nothing to update',
  });

export const staffRoleAssignmentSchema = z.object({
  id: z.uuid(),
  roleKey: z.string(),
  roleName: z.string(),
  validFrom: z.iso.datetime(),
  validTo: z.iso.datetime().nullable(),
});

export const estateStaffItemSchema = z.object({
  userId: z.uuid(),
  fullName: z.string().nullable(),
  phone: z.string(),
  email: z.string().nullable(),
  status: z.enum(['active', 'suspended', 'pending', 'left']),
  joinedAt: z.iso.datetime(),
  assignments: z.array(staffRoleAssignmentSchema),
});

export const staffListQuerySchema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  roleKey: z.string().min(1).max(60).optional(),
  status: z.enum(['active', 'suspended']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});

export const inviteStaffSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: phoneE164Schema,
  email: z.email().optional(),
  roleKeys: z.array(z.string().min(1)).min(1).max(5),
  validTo: z.iso.datetime({ offset: true }).optional(),
});

export const assignStaffRoleSchema = z.object({
  roleKey: z.string().min(1).max(60),
  validTo: z.iso.datetime({ offset: true }).optional(),
  reason: z.string().trim().max(300).optional(),
});

export const updateStaffStatusSchema = z.object({
  status: z.enum(['active', 'suspended']),
  reason: z.string().trim().min(3).max(300),
});

export const staffUserParamsSchema = z.object({
  estateId: z.uuid(),
  userId: z.uuid(),
});

export const staffRoleParamsSchema = z.object({
  estateId: z.uuid(),
  userId: z.uuid(),
  assignmentId: z.uuid(),
});
