import { z } from 'zod';

export const notificationItemSchema = z.object({
  id: z.uuid(),
  estateId: z.uuid().nullable(),
  intent: z.string(),
  priority: z.enum(['critical', 'high', 'normal', 'bulk']),
  title: z.string(),
  body: z.string(),
  data: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
  readAt: z.iso.datetime().nullable(),
});
export type NotificationItem = z.infer<typeof notificationItemSchema>;

export const registerPushTokenSchema = z.object({
  /** ExponentPushToken[...] from expo-notifications getExpoPushTokenAsync(). */
  token: z.string().regex(/^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/, 'Not an Expo push token'),
  app: z.enum(['resident-mobile', 'management-mobile', 'security-mobile']),
});

export const pushTokenSchema = z.object({ id: z.uuid() });

export const notificationPreferenceSchema = z.object({
  category: z.string().min(1).max(40),
  channel: z.enum(['push', 'sms', 'email', 'whatsapp']),
  enabled: z.boolean(),
});
export const notificationPreferencesSchema = z.array(notificationPreferenceSchema).max(100);

/** Estate notification template overrides (notifications.md §7, management-web.md §6.13). */
export const estateNotificationIntentParamSchema = z.object({
  estateId: z.uuid(),
  intent: z.string().trim().min(3).max(80),
});

export const estateNotificationTemplateSchema = z.object({
  intent: z.string(),
  category: z.string(),
  priority: z.enum(['critical', 'high', 'normal', 'bulk']),
  mandatory: z.boolean(),
  customisable: z.boolean(),
  channels: z.array(z.enum(['push', 'sms', 'email', 'whatsapp'])),
  smsOnlyWithoutPush: z.boolean(),
  placeholders: z.array(z.string()),
  defaultTitle: z.string(),
  defaultBody: z.string(),
  defaultSms: z.string().nullable(),
  customTitle: z.string().nullable(),
  customBody: z.string().nullable(),
  customSms: z.string().nullable(),
  updatedAt: z.iso.datetime().nullable(),
});

export const updateEstateNotificationTemplateSchema = z.object({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(1000),
  sms: z.string().trim().min(1).max(320).nullable().optional(),
});
