import { AD_CATEGORIES, AD_PLACEMENT_KEYS } from '@safezone/schemas';
import { humanizeStatus } from '../../lib/format';

/** Pure helpers for the advertising desk. */

export const categoryOptions = AD_CATEGORIES.map((value) => ({
  value,
  label: humanizeStatus(value),
}));
export const placementOptions = AD_PLACEMENT_KEYS.map((value) => ({ value, label: value }));

/** Naira as typed → positive integer kobo, else null. */
export function nairaToKobo(input: string): number | null {
  const cleaned = input.replace(/[,\s₦]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const kobo = Math.round(Number(cleaned) * 100);
  return Number.isSafeInteger(kobo) && kobo > 0 ? kobo : null;
}

/** A datetime-local value ("YYYY-MM-DDTHH:MM") read as WAT, as an ISO instant with +01:00. */
export function watFromLocal(value: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value.trim());
  if (!match) return null;
  const iso = `${match[1]}T${match[2]}:00+01:00`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

export function splitList(input: string): string[] {
  return [
    ...new Set(
      input
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length >= 2),
    ),
  ];
}
