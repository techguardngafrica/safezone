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
} as const satisfies Record<string, IntentDefinition>;

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
