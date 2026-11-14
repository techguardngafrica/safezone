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
