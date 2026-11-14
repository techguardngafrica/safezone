import type { MessageKey } from '@safezone/i18n';

export type Channel = 'push' | 'sms' | 'email' | 'whatsapp';
export type Priority = 'critical' | 'high' | 'normal' | 'bulk';

export interface IntentDefinition {
  category: string;
  priority: Priority;
  /** Mandatory intents ignore preferences and quiet hours (notifications.md §6.1). */
  mandatory: boolean;
  /** Channels besides in-app (always on). */
  channels: readonly Channel[];
  /** SMS only when the user has no working push token. */
  smsOnlyWithoutPush: boolean;
  title: MessageKey;
  body: MessageKey;
  sms?: MessageKey;
}

/**
 * Intent catalogue (notifications.md §3.1). Modules ask for an intent; this module decides channels and
 * renders text from @safezone/i18n. Phase 1 modules add their intents here.
 */
export const INTENTS = {
  'account.security_alert': {
    category: 'security',
    priority: 'critical',
    mandatory: true,
    channels: ['push', 'sms'],
    smsOnlyWithoutPush: true,
    title: 'notifications.account.security_alert.title',
    body: 'notifications.account.security_alert.body',
    sms: 'notifications.account.security_alert.sms',
  },
  'onboarding.application_received': {
    category: 'account',
    priority: 'normal',
    mandatory: true,
    channels: ['push', 'sms'],
    smsOnlyWithoutPush: true,
    title: 'notifications.onboarding.application_received.title',
    body: 'notifications.onboarding.application_received.body',
  },
  'onboarding.application_info_requested': {
    category: 'account',
    priority: 'high',
    mandatory: true,
    channels: ['push', 'sms'],
    smsOnlyWithoutPush: true,
    title: 'notifications.onboarding.application_info_requested.title',
    body: 'notifications.onboarding.application_info_requested.body',
  },
  'onboarding.application_approved': {
    category: 'account',
    priority: 'high',
    mandatory: true,
    channels: ['push', 'sms'],
    smsOnlyWithoutPush: true,
    title: 'notifications.onboarding.application_approved.title',
    body: 'notifications.onboarding.application_approved.body',
  },
  'onboarding.application_rejected': {
    category: 'account',
    priority: 'high',
    mandatory: true,
    channels: ['push', 'sms'],
    smsOnlyWithoutPush: true,
    title: 'notifications.onboarding.application_rejected.title',
    body: 'notifications.onboarding.application_rejected.body',
  },
} as const satisfies Record<string, IntentDefinition>;

/**
 * Messages to a phone number or email address that may not belong to a user yet (invitations).
 * No in-app record; each channel is sent at most once per dedupe key.
 */
export interface ContactIntentDefinition {
  sms: MessageKey;
  emailSubject: MessageKey;
  emailBody: MessageKey;
}

export const CONTACT_INTENTS = {
  'onboarding.invitation': {
    sms: 'notifications.onboarding.invitation.sms',
    emailSubject: 'notifications.onboarding.invitation.email_subject',
    emailBody: 'notifications.onboarding.invitation.email_body',
  },
} as const satisfies Record<string, ContactIntentDefinition>;

export type ContactIntentKey = keyof typeof CONTACT_INTENTS;

export function isContactIntentKey(value: string): value is ContactIntentKey {
  return Object.hasOwn(CONTACT_INTENTS, value);
}

export type IntentKey = keyof typeof INTENTS;

export function isIntentKey(value: string): value is IntentKey {
  return Object.hasOwn(INTENTS, value);
}

/** Channels to use for one user: defaults ∩ preferences, unless the intent is mandatory. */
export function resolveChannels(
  intent: IntentDefinition,
  preferences: ReadonlyMap<string, boolean>,
): Channel[] {
  return intent.channels.filter(
    (channel) => intent.mandatory || preferences.get(`${intent.category}:${channel}`) !== false,
  );
}
