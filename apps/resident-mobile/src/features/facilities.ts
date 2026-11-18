import type { ApiData, ApiRow } from '@safezone/api-client';
import { formatKobo, type MessageKey, t } from '@safezone/i18n';
import type { Tone } from '@safezone/mobile-ui';

export type Facility = ApiRow<'/v1/estates/{estateId}/facilities', 'get'>;
export type Availability = ApiData<'/v1/estates/{estateId}/facilities/{id}/availability', 'get'>;
export type Booking = ApiRow<'/v1/estates/{estateId}/bookings', 'get'>;
export type BookingStatus = Booking['status'];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Same as the backend's bookingPrice: started hours and days are charged in full. */
export function bookingPrice(pricing: Facility['pricing'], minutes: number): number {
  if (pricing.basis === 'free' || !('amount' in pricing)) return 0;
  if (pricing.basis === 'flat') return pricing.amount;
  if (pricing.basis === 'hourly') return Math.ceil(minutes / 60) * pricing.amount;
  return Math.ceil(minutes / 1440) * pricing.amount;
}

export function priceLabel(pricing: Facility['pricing']): string {
  if (pricing.basis === 'free' || !('amount' in pricing)) return t('res.facility.free');
  return t(`res.facility.price.${pricing.basis}` as MessageKey, {
    amount: formatKobo(pricing.amount),
  });
}

/** Length options between the facility's minimum and maximum, at most 8 of them. */
export function durationOptions(policy: Facility['policy']): number[] {
  const step = policy.maxMinutes - policy.minMinutes <= 240 ? 30 : 60;
  const options: number[] = [];
  for (
    let minutes = policy.minMinutes;
    minutes <= policy.maxMinutes && options.length < 8;
    minutes += step
  ) {
    options.push(minutes);
  }
  if (options[options.length - 1] !== policy.maxMinutes && options.length < 8)
    options.push(policy.maxMinutes);
  return options;
}

export function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return t('res.facility.minutes', { count: rest });
  return rest === 0
    ? t('res.facility.hours', { count: hours })
    : t('res.facility.hoursMinutes', { hours, minutes: rest });
}

/**
 * Start times (ISO) that fit `minutes` inside an open window, in the future, and clear of other
 * bookings and blackouts including the facility's buffer. Every 30 minutes from the window start.
 */
export function freeStartTimes(
  availability: Availability,
  minutes: number,
  bufferMinutes: number,
  now = Date.now(),
): string[] {
  const length = minutes * MINUTE;
  const buffer = bufferMinutes * MINUTE;
  const busy = availability.busy.map((slot) => ({
    from: new Date(slot.from).getTime() - buffer,
    to: new Date(slot.to).getTime() + buffer,
  }));
  const starts: string[] = [];
  for (const window of availability.open) {
    const from = new Date(window.from).getTime();
    const to = new Date(window.to).getTime();
    for (let start = from; start + length <= to; start += 30 * MINUTE) {
      if (start < now) continue;
      const end = start + length;
      if (busy.some((slot) => start < slot.to && end > slot.from)) continue;
      starts.push(new Date(start).toISOString());
    }
  }
  return starts;
}

/** The next `count` dates (YYYY-MM-DD, WAT) a resident may book, limited by the facility's advance days. */
export function bookableDates(advanceDays: number, count = 14, now = Date.now()): string[] {
  const days = Math.min(count, Math.max(1, advanceDays + 1));
  return Array.from({ length: days }, (_, offset) =>
    new Date(now + HOUR + offset * DAY).toISOString().slice(0, 10),
  );
}

/** UI_GUIDELINES §6.8: waiting states are warnings, confirmed is success, refusals danger. */
export const BOOKING_TONE: Record<BookingStatus, Tone> = {
  pending_approval: 'info',
  pending_payment: 'warning',
  confirmed: 'success',
  completed: 'neutral',
  cancelled: 'neutral',
  no_show: 'neutral',
  rejected: 'danger',
};
export const bookingStatusLabel = (status: BookingStatus) =>
  t(`res.booking.status.${status}` as MessageKey);
export const isUpcomingBooking = (booking: Booking, now = Date.now()) =>
  ['pending_approval', 'pending_payment', 'confirmed'].includes(booking.status) &&
  new Date(booking.endsAt).getTime() > now;
