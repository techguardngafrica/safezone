import type { ApiRow } from '@safezone/api-client';
import { formatDateTime, type MessageKey, t } from '@safezone/i18n';
import type { Tone } from '@safezone/mobile-ui';

export type Pass = ApiRow<'/v1/estates/{estateId}/visitor-passes', 'get'>;
export type PassStatus = Pass['status'];

/** UI_GUIDELINES §6.8 visitor pass tones. */
export const PASS_TONE: Record<PassStatus, Tone> = {
  scheduled: 'info',
  active: 'success',
  used: 'neutral',
  expired: 'neutral',
  revoked: 'danger',
};

export const passStatusLabel = (status: PassStatus) => t(`passes.status.${status}` as MessageKey);
export const passTypeLabel = (type: Pass['type']) => t(`passes.type.${type}` as MessageKey);
export const isUpcoming = (pass: Pass) => pass.status === 'active' || pass.status === 'scheduled';
export const passWindow = (pass: Pass) =>
  t('res.pass.window', { from: formatDateTime(pass.validFrom), to: formatDateTime(pass.validTo) });

export type ArrivalWindow = 'next2' | 'next4' | 'morning' | 'afternoon' | 'evening' | 'allDay';
export const ARRIVAL_WINDOWS: ArrivalWindow[] = [
  'next2',
  'next4',
  'morning',
  'afternoon',
  'evening',
  'allDay',
];

const HOUR = 3_600_000;
/** WAT is a fixed UTC+1 with no daylight saving. */
const WAT_OFFSET = HOUR;

/** Midnight WAT of the day `dayOffset` days from `now`, as epoch ms. */
function watMidnight(now: number, dayOffset: number): number {
  const wat = new Date(now + WAT_OFFSET);
  return (
    Date.UTC(wat.getUTCFullYear(), wat.getUTCMonth(), wat.getUTCDate() + dayOffset) - WAT_OFFSET
  );
}

/**
 * Pass validity for a day and arrival window, in WAT. "Next N hours" only applies to today.
 * Windows already over today are moved to start now, so a pass is never created in the past.
 */
export function passValidity(
  dayOffset: number,
  window: ArrivalWindow,
  now = Date.now(),
): { validFrom: string; validTo: string } {
  const midnight = watMidnight(now, dayOffset);
  let from: number;
  let to: number;
  switch (window) {
    case 'next2':
      from = now;
      to = now + 2 * HOUR;
      break;
    case 'next4':
      from = now;
      to = now + 4 * HOUR;
      break;
    case 'morning':
      from = midnight + 8 * HOUR;
      to = midnight + 12 * HOUR;
      break;
    case 'afternoon':
      from = midnight + 12 * HOUR;
      to = midnight + 17 * HOUR;
      break;
    case 'evening':
      from = midnight + 17 * HOUR;
      to = midnight + 22 * HOUR;
      break;
    default:
      from = midnight;
      to = midnight + 24 * HOUR - 60_000;
  }
  from = Math.max(from, now);
  return { validFrom: new Date(from).toISOString(), validTo: new Date(to).toISOString() };
}

/** Windows that still make sense for the chosen day. */
export function availableWindows(dayOffset: number, now = Date.now()): ArrivalWindow[] {
  return ARRIVAL_WINDOWS.filter((window) => {
    if (dayOffset > 0) return window !== 'next2' && window !== 'next4';
    const { validTo } = passValidity(0, window, now);
    return new Date(validTo).getTime() - now > 30 * 60_000;
  });
}

export type VisitorInput = 'name' | 'phone' | 'plate';

/** API field paths for the first visitor, mapped to the invite form's inputs. */
export const VISITOR_FIELD_PATHS: Record<string, VisitorInput> = {
  'visitors.0.name': 'name',
  'visitors.0.phone': 'phone',
  'visitors.0.vehiclePlate': 'plate',
};

export interface VisitorDraft {
  name: string;
  phone: string;
  plate: string;
}

/**
 * Checks the visitor fields before anything is sent, and normalises them to what the API accepts:
 * a phone typed as 0803 123 4567 becomes +2348031234567, plates are upper case without spaces.
 * Returns translated messages per input, or the cleaned values.
 */
export function checkVisitor(
  draft: VisitorDraft,
  normalisePhone: (input: string) => string | null,
):
  | { ok: true; visitor: { name: string; phone?: string; vehiclePlate?: string } }
  | { ok: false; errors: Partial<Record<VisitorInput, string>> } {
  const errors: Partial<Record<VisitorInput, string>> = {};
  const name = draft.name.trim();
  if (name.length < 2) errors.name = t('res.newPass.nameRequired');

  const phoneInput = draft.phone.trim();
  const phone = phoneInput ? normalisePhone(phoneInput) : null;
  if (phoneInput && !phone) errors.phone = t('res.newPass.phoneInvalid');

  const plate = draft.plate.replace(/\s+/g, '').toUpperCase();
  if (plate && !/^[A-Z0-9-]{3,15}$/.test(plate)) errors.plate = t('res.newPass.plateInvalid');

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    visitor: { name, ...(phone ? { phone } : {}), ...(plate ? { vehiclePlate: plate } : {}) },
  };
}
