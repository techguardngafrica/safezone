import type { ApiRow } from '@safezone/api-client';
import type { Tone } from '@safezone/mobile-ui';

export type Move = ApiRow<'/v1/estates/{estateId}/moves', 'get'>;
export type MoveType = Move['type'];

export const MOVE_TONE: Record<Move['status'], Tone> = {
  scheduled: 'info',
  completed: 'success',
  cancelled: 'neutral',
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Validates a YYYY-MM-DD calendar date. */
export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Splits comma-separated vehicle plates, trims and uppercases them; empty entries are ignored. */
export function parseVehiclePlates(raw: string): string[] {
  return raw
    .split(',')
    .map((plate) => plate.trim().toUpperCase())
    .filter((plate) => plate.length > 0);
}

/** True when every plate is 3 to 15 characters and there are at most 5 (nothing is dropped silently). */
export function vehiclePlatesValid(plates: readonly string[]): boolean {
  return plates.length <= 5 && plates.every((plate) => plate.length >= 3 && plate.length <= 15);
}

/** Summarizes checklist progress for a move. */
export function checklistSummary(checklist: Move['checklist']): { done: number; total: number } {
  const done = checklist.filter((item) => item.done).length;
  return { done, total: checklist.length };
}
