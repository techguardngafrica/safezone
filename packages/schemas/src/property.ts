import { z } from 'zod';

/** Spaces tree (property.md). Ownership and transfers are Phase 2. */
export const SPACE_TYPE_KEYS = [
  'phase',
  'zone',
  'street',
  'block',
  'building',
  'floor',
  'unit',
  'common_area',
] as const;
export const spaceTypeSchema = z.enum(SPACE_TYPE_KEYS);
export const unitTypeSchema = z.enum(['house', 'flat', 'shop', 'office', 'other']);
export const unitStatusSchema = z.enum(['vacant', 'occupied', 'under_construction', 'reserved']);

const codeSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/, 'Use letters, numbers, spaces, dots, slashes or dashes');

export const spaceSchema = z.object({
  id: z.uuid(),
  parentId: z.uuid().nullable(),
  type: spaceTypeSchema,
  code: z.string(),
  name: z.string(),
  depth: z.number().int(),
  /** Units only: "<estate code>-<unit code>". */
  propertyId: z.string().nullable(),
  unitType: unitTypeSchema.nullable(),
  bedrooms: z.number().int().nullable(),
  sizeSqm: z.number().nullable(),
  status: unitStatusSchema.nullable(),
  externalRef: z.string().nullable(),
  archivedAt: z.iso.datetime().nullable(),
  version: z.number().int(),
});
export type SpaceView = z.infer<typeof spaceSchema>;

export const spaceListQuerySchema = z.object({
  /** Children of this space; top-level spaces when omitted. */
  parentId: z.uuid().optional(),
  type: spaceTypeSchema.optional(),
  includeArchived: z.stringbool().default(false),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  cursor: z.string().min(1).optional(),
});

export const unitSearchQuerySchema = z.object({
  /** Only units inside this space (e.g. all units in Block C). */
  withinId: z.uuid().optional(),
  status: unitStatusSchema.optional(),
  /** Code or name contains. */
  q: z.string().trim().min(1).max(60).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
});

const unitFieldsSchema = {
  unitType: unitTypeSchema.optional(),
  bedrooms: z.number().int().min(0).max(50).optional(),
  sizeSqm: z.number().positive().max(1_000_000).optional(),
  status: unitStatusSchema.optional(),
};

export const createSpaceSchema = z.object({
  parentId: z.uuid().nullable().default(null),
  type: spaceTypeSchema,
  code: codeSchema,
  name: z.string().trim().min(1).max(120).optional(),
  externalRef: z.string().trim().min(1).max(100).optional(),
  ...unitFieldsSchema,
});

export const updateSpaceSchema = z
  .object({
    code: codeSchema.optional(),
    name: z.string().trim().min(1).max(120).optional(),
    /** Re-parent (null = top level). The whole subtree moves with it. */
    parentId: z.uuid().nullable().optional(),
    ...unitFieldsSchema,
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });

const labelSpecSchema = z.union([
  z.object({
    from: z.number().int().min(0).max(9999),
    to: z.number().int().min(0).max(9999),
    pad: z.number().int().min(0).max(4).optional(),
  }),
  z.object({
    letters: z.object({
      from: z.string().regex(/^[A-Za-z]$/),
      to: z.string().regex(/^[A-Za-z]$/),
    }),
  }),
  z.object({ list: z.array(z.string().trim().min(1).max(40)).min(1).max(500) }),
]);

export const bulkCreateSpacesSchema = z.object({
  /** Where the new spaces go (null = top level). */
  parentId: z.uuid().nullable().default(null),
  levels: z
    .array(
      z.object({
        type: spaceTypeSchema,
        labels: labelSpecSchema,
        codeTemplate: z.string().trim().min(1).max(60).optional(),
        nameTemplate: z.string().trim().min(1).max(120).optional(),
        unitType: unitTypeSchema.optional(),
      }),
    )
    .min(1)
    .max(5),
  /** Validate and count without creating anything. */
  dryRun: z.boolean().default(false),
});

export const bulkCreateResultSchema = z.object({
  dryRun: z.boolean(),
  total: z.number().int(),
  byType: z.record(z.string(), z.number().int()),
  /** First few codes, for the confirmation screen. */
  sample: z.array(z.object({ type: spaceTypeSchema, code: z.string(), name: z.string() })),
});

export const spaceParamsSchema = z.object({ estateId: z.uuid(), id: z.uuid() });
