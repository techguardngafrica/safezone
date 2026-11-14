import { z } from 'zod';

const semver = z.string().regex(/^\d+\.\d+\.\d+$/, 'Use a version like 1.4.0');

export const appConfigQuerySchema = z.object({
  app: z.enum([
    'resident-mobile',
    'management-web',
    'management-mobile',
    'security-mobile',
    'super-admin',
    'public-web',
  ]),
  platform: z.enum(['android', 'ios', 'web']),
  version: semver,
});

export const appConfigSchema = z.object({
  minVersion: semver,
  recommendedVersion: semver,
  /** hard: block until updated; soft: suggest an update. */
  update: z.enum(['hard', 'soft', 'none']),
  message: z.string().nullable(),
  /** Public flags evaluated for this app and version. */
  flags: z.record(z.string(), z.boolean()),
});
export type AppConfig = z.infer<typeof appConfigSchema>;

export const featureFlagKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_.]{2,63}$/, 'Use lower_snake_case keys');

export const featureFlagSchema = z.object({
  key: featureFlagKeySchema,
  description: z.string().min(3).max(300),
  defaultEnabled: z.boolean(),
  rules: z
    .object({
      estateIds: z.array(z.uuid()).max(500).optional(),
      apps: z.array(z.string().min(1).max(40)).max(10).optional(),
      minAppVersion: semver.optional(),
      percent: z.number().int().min(0).max(100).optional(),
    })
    .strict(),
  isPublic: z.boolean(),
  updatedAt: z.iso.datetime(),
});

export const upsertFeatureFlagSchema = featureFlagSchema.omit({ key: true, updatedAt: true });

export const appVersionParamsSchema = z.object({
  app: appConfigQuerySchema.shape.app,
  platform: appConfigQuerySchema.shape.platform,
});

export const upsertAppVersionSchema = z
  .object({
    minVersion: semver,
    recommendedVersion: semver,
    message: z.string().max(300).nullable().default(null),
  })
  .refine(
    (value) => {
      const [a, b] = [value.minVersion, value.recommendedVersion].map((v) =>
        v.split('.').map(Number),
      );
      for (let i = 0; i < 3; i += 1) {
        if ((a?.[i] ?? 0) !== (b?.[i] ?? 0)) return (a?.[i] ?? 0) < (b?.[i] ?? 0);
      }
      return true;
    },
    { message: 'recommendedVersion must be at least minVersion' },
  );

export const myFlagsQuerySchema = z.object({ estateId: z.uuid().optional() });

/** Estate data export (platform.md §6). */
export const estateExportSchema = z.object({
  id: z.uuid(),
  status: z.enum(['queued', 'building', 'ready', 'failed', 'expired']),
  sizeBytes: z.number().int().nullable(),
  datasets: z.record(z.string(), z.number().int()).nullable(),
  expiresAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  readyAt: z.iso.datetime().nullable(),
});
export const exportDownloadSchema = z.object({ url: z.string(), expiresAt: z.iso.datetime() });
