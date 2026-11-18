import type { ApiData, ApiRow } from '@safezone/api-client';
import { type MessageKey, t } from '@safezone/i18n';

export type Household = ApiData<'/v1/estates/{estateId}/households/{id}', 'get'>;
export type Member = Household['members'][number];
export type MemberPermissions = Member['permissions'];
export type Relationship = Exclude<Member['relationship'], 'head'>;
export type Vehicle = ApiRow<'/v1/estates/{estateId}/vehicles', 'get'>;
export type Staff = ApiRow<'/v1/estates/{estateId}/domestic-staff', 'get'>;
export type StaffRole = Staff['role'];

export const RELATIONSHIPS: Relationship[] = [
  'spouse',
  'child',
  'relative',
  'tenant_co_occupant',
  'other',
];
export const PERMISSION_KEYS: (keyof MemberPermissions)[] = [
  'inviteVisitors',
  'triggerSos',
  'viewBills',
  'payBills',
  'receiveGateAlerts',
];
export const STAFF_ROLES: StaffRole[] = [
  'cleaner',
  'driver',
  'nanny',
  'cook',
  'gardener',
  'security',
  'other',
];

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Turns "8", "8:5", "0830" or "8.30" into "08:30" style; null when it is not a time. */
export function normaliseTime(input: string): string | null {
  const digits = input.trim().replace(/[.\s]/g, ':');
  const match = /^(\d{1,2})(?::?(\d{2}))?$/.exec(digits);
  if (!match) return null;
  const value = `${(match[1] ?? '').padStart(2, '0')}:${match[2] ?? '00'}`;
  return HHMM.test(value) ? value : null;
}

export type MemberInput = 'fullName' | 'phone';
export const MEMBER_FIELD_PATHS: Record<string, MemberInput> = {
  fullName: 'fullName',
  phone: 'phone',
};

/** Add-member checks (addHouseholdMemberSchema): a name, and a phone for adults. */
export function checkMember(
  draft: { fullName: string; phone: string; isMinor: boolean },
  normalisePhone: (input: string) => string | null,
):
  | { ok: true; fullName: string; phone?: string }
  | { ok: false; errors: Partial<Record<MemberInput, string>> } {
  const errors: Partial<Record<MemberInput, string>> = {};
  const fullName = draft.fullName.trim();
  if (fullName.length < 2) errors.fullName = t('res.household.nameRequired');
  const phoneInput = draft.phone.trim();
  const phone = phoneInput ? normalisePhone(phoneInput) : null;
  if (phoneInput && !phone) errors.phone = t('res.newPass.phoneInvalid');
  else if (!draft.isMinor && !phone) errors.phone = t('res.household.adultPhone');
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, fullName, ...(phone ? { phone } : {}) };
}

export type VehicleInput = 'plate' | 'make' | 'model' | 'colour' | 'tagNumber';
export const VEHICLE_FIELD_PATHS: Record<string, VehicleInput> = {
  plate: 'plate',
  make: 'make',
  model: 'model',
  colour: 'colour',
  tagNumber: 'tagNumber',
};

/** Register-vehicle checks (createVehicleSchema): plates are 3 to 15 letters and numbers. */
export function checkPlate(
  input: string,
): { ok: true; plate: string } | { ok: false; error: string } {
  const plate = input.replace(/\s+/g, '').toUpperCase();
  return /^[A-Z0-9-]{3,15}$/.test(plate)
    ? { ok: true, plate }
    : { ok: false, error: t('res.newPass.plateInvalid') };
}

export type StaffInput = 'name' | 'phone' | 'days' | 'from' | 'to';
export const STAFF_FIELD_PATHS: Record<string, StaffInput> = {
  name: 'name',
  phone: 'phone',
  'schedule.days': 'days',
  'schedule.from': 'from',
  'schedule.to': 'to',
};

/** Domestic staff checks (createDomesticStaffSchema): name, optional phone, at least one day, a time window. */
export function checkStaff(
  draft: { name: string; phone: string; days: number[]; from: string; to: string },
  normalisePhone: (input: string) => string | null,
):
  | {
      ok: true;
      name: string;
      phone?: string;
      schedule: { days: number[]; from: string; to: string };
    }
  | { ok: false; errors: Partial<Record<StaffInput, string>> } {
  const errors: Partial<Record<StaffInput, string>> = {};
  const name = draft.name.trim();
  if (name.length < 2) errors.name = t('res.household.nameRequired');
  const phoneInput = draft.phone.trim();
  const phone = phoneInput ? normalisePhone(phoneInput) : null;
  if (phoneInput && !phone) errors.phone = t('res.newPass.phoneInvalid');
  if (draft.days.length === 0) errors.days = t('res.staff.daysRequired');
  const from = normaliseTime(draft.from);
  const to = normaliseTime(draft.to);
  if (!from) errors.from = t('res.staff.timeInvalid');
  if (!to) errors.to = t('res.staff.timeInvalid');
  else if (from && to <= from) errors.to = t('res.staff.toAfterFrom');
  if (Object.keys(errors).length > 0 || !from || !to) return { ok: false, errors };
  return {
    ok: true,
    name,
    ...(phone ? { phone } : {}),
    schedule: { days: [...draft.days].sort(), from, to },
  };
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** "Mon, Wed, Fri, 08:00 to 17:00" for a staff schedule (0 is Sunday). */
export function scheduleText(schedule: Staff['schedule']): string {
  const days = schedule.days
    .map((day) => t(`res.staff.day.${DAY_KEYS[day] ?? 'sun'}` as MessageKey))
    .join(', ');
  return t('res.staff.schedule', { days, from: schedule.from, to: schedule.to });
}
