import type { FacilityPolicy, FacilityPricing } from '@safezone/schemas';

/** Facilities rules (facilities.md §4–5). Pure; WAT is UTC+1 all year (no daylight saving). */
const WAT_OFFSET_MS = 3_600_000;
const MINUTE = 60_000;

export interface OpeningSlot {
  day: number;
  open: string;
  close: string;
}

/** Minutes since WAT midnight and the WAT weekday of an instant. */
function watParts(at: Date): { day: number; minutes: number; date: string } {
  const shifted = new Date(at.getTime() + WAT_OFFSET_MS);
  return {
    day: shifted.getUTCDay(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    date: shifted.toISOString().slice(0, 10),
  };
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number) as [number, number];
  return hours * 60 + minutes;
}

/** WAT wall-clock time on a date as a UTC instant. */
export function watInstant(date: string, time: string): Date {
  return new Date(`${date}T${time}:00.000+01:00`);
}

/** True when the booking sits inside one opening slot of a single WAT day. */
export function withinOpeningHours(hours: readonly OpeningSlot[], start: Date, end: Date): boolean {
  const from = watParts(start);
  const to = watParts(new Date(end.getTime() - 1));
  if (from.date !== to.date) return false;
  const endMinutes = from.minutes + Math.round((end.getTime() - start.getTime()) / MINUTE);
  return hours.some(
    (slot) =>
      slot.day === from.day &&
      from.minutes >= toMinutes(slot.open) &&
      endMinutes <= toMinutes(slot.close),
  );
}

/** Opening windows for one WAT date. */
export function openWindows(
  hours: readonly OpeningSlot[],
  date: string,
): { from: Date; to: Date }[] {
  const day = new Date(`${date}T12:00:00.000+01:00`).getUTCDay();
  return hours
    .filter((slot) => slot.day === day)
    .map((slot) => ({ from: watInstant(date, slot.open), to: watInstant(date, slot.close) }))
    .sort((a, b) => a.from.getTime() - b.from.getTime());
}

/** Price in kobo (facilities.md §2.4): per started hour or per started day. */
export function bookingPrice(pricing: FacilityPricing, start: Date, end: Date): number {
  const minutes = Math.ceil((end.getTime() - start.getTime()) / MINUTE);
  switch (pricing.basis) {
    case 'free':
      return 0;
    case 'flat':
      return pricing.amount;
    case 'hourly':
      return Math.ceil(minutes / 60) * pricing.amount;
    case 'daily':
      return Math.ceil(minutes / 1440) * pricing.amount;
  }
}

export type PolicyViolation =
  | 'too_short'
  | 'too_long'
  | 'too_far_ahead'
  | 'in_past'
  | 'outside_hours'
  | 'too_many_guests'
  | 'weekly_limit'
  | 'monthly_limit';

/** Checks a request against the facility's rules; returns the first broken rule or null. */
export function checkPolicy(
  policy: FacilityPolicy,
  hours: readonly OpeningSlot[],
  request: { start: Date; end: Date; guests: number },
  usage: { thisWeek: number; thisMonth: number },
  now: Date,
): PolicyViolation | null {
  const minutes = (request.end.getTime() - request.start.getTime()) / MINUTE;
  if (request.start <= now) return 'in_past';
  if (minutes < policy.minMinutes) return 'too_short';
  if (minutes > policy.maxMinutes) return 'too_long';
  if (request.start.getTime() - now.getTime() > policy.advanceDays * 86_400_000)
    return 'too_far_ahead';
  if (!withinOpeningHours(hours, request.start, request.end)) return 'outside_hours';
  if (request.guests > policy.maxGuests) return 'too_many_guests';
  if (policy.perHouseholdPerWeek > 0 && usage.thisWeek >= policy.perHouseholdPerWeek)
    return 'weekly_limit';
  if (policy.perHouseholdPerMonth > 0 && usage.thisMonth >= policy.perHouseholdPerMonth)
    return 'monthly_limit';
  return null;
}

/** Refund on cancellation (rule 3): full, partial or none by how long before the start. */
export function cancellationRefund(
  policy: FacilityPolicy,
  paid: number,
  start: Date,
  now: Date,
): number {
  const hoursBefore = (start.getTime() - now.getTime()) / 3_600_000;
  if (hoursBefore >= policy.cancellation.freeHours) return paid;
  if (hoursBefore >= policy.cancellation.partialHours)
    return Math.round((paid * policy.cancellation.partialPercent) / 100);
  return 0;
}

/** WAT week (Monday start) and month boundaries containing an instant, for per-household limits. */
export function usageWindows(at: Date): {
  weekStart: Date;
  weekEnd: Date;
  monthStart: Date;
  monthEnd: Date;
} {
  const parts = watParts(at);
  const offset = (parts.day + 6) % 7;
  const weekStart = new Date(watInstant(parts.date, '00:00').getTime() - offset * 86_400_000);
  const [year, month] = parts.date.split('-').map(Number) as [number, number];
  const monthStart = watInstant(`${year}-${String(month).padStart(2, '0')}-01`, '00:00');
  const next =
    month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
  return {
    weekStart,
    weekEnd: new Date(weekStart.getTime() + 7 * 86_400_000),
    monthStart,
    monthEnd: watInstant(next, '00:00'),
  };
}

export const HOLD_MINUTES = 30;
