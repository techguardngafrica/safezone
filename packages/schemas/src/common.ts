import { z } from 'zod';

/** UUID (v7 preferred). */
export const uuidSchema = z.uuid();

/** Nigerian numbers in E.164 (+234 followed by 10 digits). Extend when other markets launch. */
export const phoneE164Schema = z
  .string()
  .trim()
  .regex(/^\+234[789][01]\d{8}$/, 'Enter a valid Nigerian phone number in +234 format');

/** Converts local Nigerian formats (0803…, 234803…) to E.164. Returns null if it cannot. */
export function normalizeNigerianPhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, '');
  let candidate: string;
  if (digits.startsWith('+234')) candidate = digits;
  else if (digits.startsWith('234')) candidate = `+${digits}`;
  else if (digits.startsWith('0')) candidate = `+234${digits.slice(1)}`;
  else return null;
  return phoneE164Schema.safeParse(candidate).success ? candidate : null;
}

/** Money in integer kobo. */
export const moneySchema = z.object({
  amount: z.number().int().nonnegative(),
  currency: z.literal('NGN'),
});

export const isoDateTimeSchema = z.iso.datetime({ offset: true });

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const idempotencyKeySchema = z.string().min(8).max(128);
