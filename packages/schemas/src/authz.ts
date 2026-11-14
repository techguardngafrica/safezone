import { z } from 'zod';

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
