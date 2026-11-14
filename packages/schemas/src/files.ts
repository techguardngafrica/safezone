import { z } from 'zod';

export const ESTATE_FILE_PURPOSES = [
  'pass_photo',
  'maintenance',
  'incident_evidence',
  'document',
  'import',
] as const;
export const PERSONAL_FILE_PURPOSES = ['avatar', 'estate_application'] as const;

const MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
] as const;

const uploadBase = {
  mimeType: z.enum(MIME_TYPES),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(50 * 1024 * 1024),
};

export const estateUploadRequestSchema = z.object({
  purpose: z.enum(ESTATE_FILE_PURPOSES),
  ...uploadBase,
});
export const personalUploadRequestSchema = z.object({
  purpose: z.enum(PERSONAL_FILE_PURPOSES),
  ...uploadBase,
});

export const uploadTicketSchema = z.object({
  fileId: z.uuid(),
  /** PUT the bytes here with the same Content-Type and Content-Length, then call complete. */
  uploadUrl: z.string(),
  method: z.literal('PUT'),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.iso.datetime(),
});

export const fileStatusSchema = z.object({
  id: z.uuid(),
  purpose: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  status: z.enum(['awaiting_upload', 'pending_scan', 'clean', 'infected', 'rejected', 'error']),
  sha256: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export const downloadUrlSchema = z.object({ url: z.string(), expiresAt: z.iso.datetime() });

export const estateFileParamsSchema = z.object({ estateId: z.uuid(), id: z.uuid() });
