import { z } from 'zod';

/** Estate document management (documents.md §2.8–2.14, Phase 3). */
export const documentCategorySchema = z.enum([
  'estate_rules',
  'constitution',
  'agm_minutes',
  'notice',
  'contract',
  'insurance',
  'property',
  'resident',
  'vendor',
  'other',
]);

export const documentVisibilitySchema = z.discriminatedUnion('audience', [
  z.object({ audience: z.literal('managers') }),
  z.object({ audience: z.literal('residents') }),
  z.object({
    audience: z.literal('roles'),
    roleKeys: z.array(z.string().min(2).max(60)).min(1).max(20),
  }),
  z.object({ audience: z.literal('spaces'), spaceIds: z.array(z.uuid()).min(1).max(100) }),
  z.object({ audience: z.literal('households'), householdIds: z.array(z.uuid()).min(1).max(100) }),
  z.object({ audience: z.literal('user'), userId: z.uuid() }),
]);
export type DocumentVisibility = z.infer<typeof documentVisibilitySchema>;

export const createFolderSchema = z.object({
  name: z.string().trim().min(1).max(120),
  parentId: z.uuid().optional(),
});
export const folderSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  parentId: z.uuid().nullable(),
});

export const createDocumentSchema = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).optional(),
  category: documentCategorySchema,
  folderId: z.uuid().optional(),
  visibility: documentVisibilitySchema,
  expiresOn: z.iso.date().optional(),
  /** An uploaded file with purpose `document`. */
  fileId: z.uuid(),
  notes: z.string().trim().max(500).optional(),
});
export const updateDocumentSchema = z
  .object({
    title: z.string().trim().min(2).max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    category: documentCategorySchema.optional(),
    folderId: z.uuid().nullable().optional(),
    visibility: documentVisibilitySchema.optional(),
    expiresOn: z.iso.date().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });
export const addVersionSchema = z.object({
  fileId: z.uuid(),
  notes: z.string().trim().max(500).optional(),
});

export const documentSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  category: documentCategorySchema,
  folderId: z.uuid().nullable(),
  visibility: documentVisibilitySchema,
  expiresOn: z.iso.date().nullable(),
  status: z.enum(['active', 'archived']),
  currentVersion: z.number().int(),
  versions: z.array(
    z.object({
      version: z.number().int(),
      fileId: z.uuid(),
      notes: z.string().nullable(),
      createdAt: z.iso.datetime(),
    }),
  ),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const documentListQuerySchema = z.object({
  category: documentCategorySchema.optional(),
  folderId: z.uuid().optional(),
  q: z.string().trim().min(1).max(100).optional(),
  expiringWithinDays: z.coerce.number().int().min(1).max(365).optional(),
});
export const documentAccessSchema = z.object({
  userId: z.uuid(),
  action: z.enum(['view', 'download']),
  version: z.number().int(),
  at: z.iso.datetime(),
});
