/**
 * @safezone/types — shared types with no runtime dependencies.
 * Conventions (AGENTS.md §5.4): UUIDv7 ids, integer kobo money, ISO-8601 UTC timestamps.
 */

/** Branded string type so different id kinds cannot be mixed up. */
export type Brand<T, B extends string> = T & { readonly __brand: B };

export type Uuid = Brand<string, 'Uuid'>;
export type UserId = Brand<string, 'UserId'>;
export type EstateId = Brand<string, 'EstateId'>;
export type SpaceId = Brand<string, 'SpaceId'>;
export type HouseholdId = Brand<string, 'HouseholdId'>;

/** ISO-8601 UTC timestamp, e.g. "2026-11-13T10:00:00Z". Display in Africa/Lagos. */
export type IsoDateTime = Brand<string, 'IsoDateTime'>;

/** E.164 phone number, e.g. "+2348012345678". */
export type PhoneE164 = Brand<string, 'PhoneE164'>;

export const SUPPORTED_CURRENCIES = ['NGN'] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

/** Money as integer minor units (kobo for NGN). Never use floats for money. */
export interface Money {
  readonly amount: number;
  readonly currency: Currency;
}

export const DEFAULT_TIMEZONE = 'Africa/Lagos';
export const DEFAULT_CURRENCY: Currency = 'NGN';

export const ESTATE_STATUSES = [
  'applied',
  'under_review',
  'info_requested',
  'approved',
  'active',
  'suspended',
  'deactivated',
  'rejected',
] as const;
export type EstateStatus = (typeof ESTATE_STATUSES)[number];

export const ONBOARDING_MODES = ['self_service', 'assisted'] as const;
export type OnboardingMode = (typeof ONBOARDING_MODES)[number];

export const APPS = [
  'backend-api',
  'resident-mobile',
  'management-web',
  'management-mobile',
  'security-mobile',
  'super-admin',
  'public-web',
] as const;
export type AppName = (typeof APPS)[number];

/** RFC 9457 problem details, as returned by every API error. */
export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: string;
  readonly detail?: string;
  readonly requestId?: string;
  readonly errors?: ReadonlyArray<{ readonly path: string; readonly message: string }>;
}

/** Cursor-paginated list envelope. */
export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}
