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
  'occupancy.join_request_approved': {
    category: 'account',
    priority: 'high',
    mandatory: true,
    channels: ['push', 'sms'],
    smsOnlyWithoutPush: true,
    title: 'notifications.occupancy.join_request_approved.title',
    body: 'notifications.occupancy.join_request_approved.body',
  },
  'occupancy.join_request_rejected': {
    category: 'account',
    priority: 'high',
    mandatory: true,
    channels: ['push', 'sms'],
    smsOnlyWithoutPush: true,
    title: 'notifications.occupancy.join_request_rejected.title',
    body: 'notifications.occupancy.join_request_rejected.body',
  },
  'occupancy.join_request_waiting': {
    category: 'account',
    priority: 'normal',
    mandatory: true,
    channels: ['push', 'sms'],
    smsOnlyWithoutPush: true,
    title: 'notifications.occupancy.join_request_waiting.title',
    body: 'notifications.occupancy.join_request_waiting.body',
  },
  'occupancy.added_to_household': {
    category: 'account',
    priority: 'normal',
    mandatory: true,
    channels: ['push', 'sms'],
    smsOnlyWithoutPush: true,
    title: 'notifications.occupancy.added_to_household.title',
    body: 'notifications.occupancy.added_to_household.body',
  },
  'visitor.walkin_request': {
    category: 'visitors',
    priority: 'high',
    mandatory: true,
    channels: ['push', 'sms'],
    smsOnlyWithoutPush: true,
    title: 'notifications.visitor.walkin_request.title',
    body: 'notifications.visitor.walkin_request.body',
  },
  'visitor.arrived': {
    category: 'visitors',
    priority: 'normal',
    mandatory: false,
    channels: ['push'],
    smsOnlyWithoutPush: false,
    title: 'notifications.visitor.arrived.title',
    body: 'notifications.visitor.arrived.body',
  },
  'emergency.sos': {
    category: 'emergency',
    priority: 'critical',
    mandatory: true,
    // SOS always goes by SMS too: never depend on one channel (AGENTS.md §6.1).
    channels: ['push', 'sms'],
    smsOnlyWithoutPush: false,
    title: 'notifications.emergency.sos.title',
    body: 'notifications.emergency.sos.body',
    sms: 'notifications.emergency.sos.sms',
  },
  'emergency.sos_escalated': {
    category: 'emergency',
    priority: 'critical',
    mandatory: true,
    channels: ['push', 'sms'],
    smsOnlyWithoutPush: false,
    title: 'notifications.emergency.sos_escalated.title',
    body: 'notifications.emergency.sos_escalated.body',
  },
  'emergency.broadcast': {
    category: 'emergency',
    priority: 'critical',
    mandatory: true,
    channels: ['push', 'sms'],
    smsOnlyWithoutPush: true,
    title: 'notifications.emergency.broadcast.title',
    body: 'notifications.emergency.broadcast.body',
  },
  'community.announcement': {
    category: 'announcements',
    priority: 'normal',
    mandatory: false,
    channels: ['push'],
    smsOnlyWithoutPush: false,
    title: 'notifications.community.announcement.title',
    body: 'notifications.community.announcement.body',
  },
  'community.announcement_important': {
    category: 'announcements',
    priority: 'high',
    mandatory: true,
    channels: ['push', 'sms'],
    smsOnlyWithoutPush: true,
    title: 'notifications.community.announcement.title',
    body: 'notifications.community.announcement.body',
  },
  'maintenance.request_urgent': {
    category: 'maintenance',
    priority: 'high',
    mandatory: true,
    channels: ['push', 'sms'],
    smsOnlyWithoutPush: true,
    title: 'notifications.maintenance.request_urgent.title',
    body: 'notifications.maintenance.request_urgent.body',
  },
  'maintenance.request_updated': {
    category: 'maintenance',
    priority: 'normal',
    mandatory: false,
    channels: ['push'],
    smsOnlyWithoutPush: false,
    title: 'notifications.maintenance.request_updated.title',
    body: 'notifications.maintenance.request_updated.body',
  },
  'maintenance.work_order_assigned': {
    category: 'maintenance',
    priority: 'normal',
    mandatory: true,
    channels: ['push', 'sms'],
    smsOnlyWithoutPush: true,
    title: 'notifications.maintenance.work_order_assigned.title',
    body: 'notifications.maintenance.work_order_assigned.body',
  },
  'maintenance.sla_breached': {
    category: 'maintenance',
    priority: 'high',
    mandatory: true,
    channels: ['push', 'sms'],
    smsOnlyWithoutPush: true,
    title: 'notifications.maintenance.sla_breached.title',
    body: 'notifications.maintenance.sla_breached.body',
  },
  'utilities.outage': {
    category: 'announcements',
    priority: 'high',
    mandatory: true,
    channels: ['push', 'sms'],
    smsOnlyWithoutPush: true,
    title: 'notifications.utilities.outage.title',
    body: 'notifications.utilities.outage.body',
  },
  'occupancy.move_scheduled': {
    category: 'account',
    priority: 'normal',
    mandatory: true,
    channels: ['push'],
    smsOnlyWithoutPush: false,
    title: 'notifications.occupancy.move_scheduled.title',
    body: 'notifications.occupancy.move_scheduled.body',
  },
  'occupancy.move_completed': {
    category: 'account',
    priority: 'normal',
    mandatory: true,
    channels: ['push', 'sms'],
    smsOnlyWithoutPush: true,
    title: 'notifications.occupancy.move_completed.title',
    body: 'notifications.occupancy.move_completed.body',
  },
  'occupancy.lease_expiring': {
    category: 'account',
    priority: 'normal',
    mandatory: true,
    channels: ['push', 'sms'],
    smsOnlyWithoutPush: true,
    title: 'notifications.occupancy.lease_expiring.title',
    body: 'notifications.occupancy.lease_expiring.body',
  },
  'occupancy.lease_expired': {
    category: 'account',
    priority: 'high',
    mandatory: true,
    channels: ['push'],
    smsOnlyWithoutPush: false,
    title: 'notifications.occupancy.lease_expired.title',
    body: 'notifications.occupancy.lease_expired.body',
  },
  'platform.export_ready': {
    category: 'account',
    priority: 'normal',
    mandatory: true,
    channels: ['push', 'email'],
    smsOnlyWithoutPush: false,
    title: 'notifications.platform.export_ready.title',
    body: 'notifications.platform.export_ready.body',
  },
  'facilities.booking_updated': {
    category: 'facilities',
    priority: 'normal',
    mandatory: true,
    channels: ['push'],
    smsOnlyWithoutPush: false,
    title: 'notifications.facilities.booking_updated.title',
    body: 'notifications.facilities.booking_updated.body',
  },
  'facilities.booking_reminder': {
    category: 'facilities',
    priority: 'normal',
    mandatory: false,
    channels: ['push'],
    smsOnlyWithoutPush: false,
    title: 'notifications.facilities.booking_reminder.title',
    body: 'notifications.facilities.booking_reminder.body',
  },
  'documents.expiring': {
    category: 'account',
    priority: 'normal',
    mandatory: true,
    channels: ['push', 'email'],
    smsOnlyWithoutPush: false,
    title: 'notifications.documents.expiring.title',
    body: 'notifications.documents.expiring.body',
  },
  'community.message': {
    category: 'community',
    priority: 'normal',
    mandatory: false,
    channels: ['push'],
    smsOnlyWithoutPush: false,
    title: 'notifications.community.message.title',
    body: 'notifications.community.message.body',
  },
  'community.moderation': {
    category: 'community',
    priority: 'normal',
    mandatory: true,
    channels: ['push'],
    smsOnlyWithoutPush: false,
    title: 'notifications.community.moderation.title',
    body: 'notifications.community.moderation.body',
  },
  'community.poll': {
    category: 'announcements',
    priority: 'normal',
    mandatory: false,
    channels: ['push'],
    smsOnlyWithoutPush: false,
    title: 'notifications.community.poll.title',
    body: 'notifications.community.poll.body',
  },
  'billing.payment_received': {
    category: 'billing',
    priority: 'high',
    mandatory: true,
    channels: ['push', 'sms'],
    smsOnlyWithoutPush: true,
    title: 'notifications.billing.payment_received.title',
    body: 'notifications.billing.payment_received.body',
  },
  'billing.invoice_reminder': {
    category: 'billing',
    priority: 'normal',
    mandatory: false,
    channels: ['push'],
    smsOnlyWithoutPush: false,
    title: 'notifications.billing.invoice_reminder.title',
    body: 'notifications.billing.invoice_reminder.body',
  },
  'billing.invoice_overdue': {
    category: 'billing',
    priority: 'normal',
    mandatory: false,
    channels: ['push', 'sms'],
    smsOnlyWithoutPush: true,
    title: 'notifications.billing.invoice_overdue.title',
    body: 'notifications.billing.invoice_overdue.body',
  },
  'billing.invoice_issued': {
    category: 'billing',
    priority: 'normal',
    mandatory: false,
    channels: ['push', 'sms'],
    smsOnlyWithoutPush: true,
    title: 'notifications.billing.invoice_issued.title',
    body: 'notifications.billing.invoice_issued.body',
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
  'emergency.contact': {
    sms: 'notifications.emergency.contact.sms',
    emailSubject: 'notifications.emergency.contact.email_subject',
    emailBody: 'notifications.emergency.contact.email_body',
  },
  'visitor.pass': {
    sms: 'notifications.visitor.pass.sms',
    emailSubject: 'notifications.visitor.pass.email_subject',
    emailBody: 'notifications.visitor.pass.email_body',
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
