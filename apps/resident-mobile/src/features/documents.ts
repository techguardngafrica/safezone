import type { ApiRow } from '@safezone/api-client';
import { todayWat } from './bills';

export type EstateDocument = ApiRow<'/v1/estates/{estateId}/documents', 'get'>;
export type DocumentFolder = ApiRow<'/v1/estates/{estateId}/document-folders', 'get'>;
export type DocumentCategory = EstateDocument['category'];

export const DOCUMENT_CATEGORIES: readonly DocumentCategory[] = [
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
];

const DAY_MS = 86_400_000;

/** Evaluates document expiry state relative to today in WAT. */
export function expiryState(
  expiresOn: string | null,
  now = Date.now(),
): 'expired' | 'expiring_soon' | 'valid' | null {
  if (!expiresOn) return null;
  const today = todayWat(now);
  if (expiresOn < today) return 'expired';
  const target = new Date(`${expiresOn}T00:00:00+01:00`).getTime();
  if (target - now <= 30 * DAY_MS) return 'expiring_soon';
  return 'valid';
}
