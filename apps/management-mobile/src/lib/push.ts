import { unwrap } from '@safezone/api-client';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './session';

export const SOS_CHANNEL = 'sos';

/**
 * Notification setup: an Android channel for SOS at maximum importance (sound, heads-up, through Do
 * Not Disturb where the OS allows it), permission, and the Expo push token sent to the API (Expo Push
 * only, AGENTS.md §6.1). Push needs an EAS project id; without one only in-app alarms work.
 */
export async function setUpNotifications(): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(SOS_CHANNEL, {
      name: 'SOS alerts',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
      vibrationPattern: [0, 800, 400, 800],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: true,
    });
  }
  const current = await Notifications.getPermissionsAsync();
  const granted = current.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return;

  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  const projectId = extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return;
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  await unwrap(api.POST('/v1/me/push-tokens', { body: { token, app: 'management-mobile' } }));
}
