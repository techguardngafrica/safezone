import { z } from 'zod';

/** Official estate announcements (community.md, Phase 1). Labelled "Official" in every client. */
export const announcementCategorySchema = z.enum([
  'general',
  'security',
  'maintenance',
  'event',
  'billing',
]);
export const createAnnouncementSchema = z.object({
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(3).max(4000),
  category: announcementCategorySchema.default('general'),
  /** Important announcements also go by SMS. */
  priority: z.enum(['normal', 'important']).default('normal'),
  audience: z.discriminatedUnion('type', [
    z.object({ type: z.literal('estate') }),
    z.object({ type: z.literal('spaces'), spaceIds: z.array(z.uuid()).min(1).max(100) }),
  ]),
});
export const announcementSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  body: z.string(),
  category: announcementCategorySchema,
  priority: z.enum(['normal', 'important']),
  audienceType: z.enum(['estate', 'spaces']),
  official: z.literal(true),
  publishedAt: z.iso.datetime(),
  /** For the reader; null in the management view. */
  read: z.boolean().nullable(),
  /** Management view only. */
  recipients: z.number().int().nullable(),
});
export const announcementListQuerySchema = z.object({
  /** Management: every announcement, with recipient counts. */
  all: z.stringbool().default(false),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().min(1).optional(),
});
