import { t } from '@safezone/i18n';
import * as Notifications from 'expo-notifications';
import { router, usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform, Vibration } from 'react-native';
import { SOS_CHANNEL, setUpNotifications } from '../lib/push';
import { categoryText, useActiveSos } from './sos';

/** Long, repeating pattern so the alarm is noticed. */
const ALARM_PATTERN = [0, 800, 400, 800, 400, 800];

Notifications.setNotificationHandler({
  handleNotification: () =>
    Promise.resolve({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
});

/**
 * Watches for SOS alerts while the app is open (management-mobile.md §7.1): a new alert opens the
 * full-screen response over whatever the manager is doing, plays the notification sound and vibrates
 * until someone acknowledges it. Never blocked on other work (AGENTS.md §6).
 */
export function SosWatcher() {
  const active = useActiveSos();
  const seen = useRef<Set<string> | null>(null);
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  useEffect(() => {
    void setUpNotifications().catch(() => undefined);
  }, []);

  // A tapped push notification opens its alert.
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown>;
      if (typeof data.alertId === 'string') router.push(`/sos/${data.alertId}`);
    });
    return () => subscription.remove();
  }, []);

  const alerts = active.data;
  const ringing = (alerts ?? []).some((alert) => alert.status === 'triggered');

  useEffect(() => {
    if (!alerts) return;
    const firstLoad = seen.current === null;
    const known = seen.current ?? new Set<string>();
    const fresh = alerts.filter((alert) => !known.has(alert.id));
    seen.current = new Set(alerts.map((alert) => alert.id));
    // Alerts already open when the app starts still raise the alarm if nobody has acknowledged them.
    const toRaise = firstLoad ? fresh.filter((alert) => alert.status === 'triggered') : fresh;
    const newest = toRaise[0];
    if (!newest) return;
    void Notifications.scheduleNotificationAsync({
      content: {
        title: newest.isDrill
          ? `${t('sos.drill')} ${t('mm.sos.notification.title')}`
          : t('mm.sos.notification.title'),
        body: t('mm.sos.notification.body', {
          category: categoryText(newest.category),
          unit: newest.unitCode ?? t('sos.unknownUnit'),
        }),
        data: { alertId: newest.id },
        sound: 'default',
        priority: Notifications.AndroidNotificationPriority.MAX,
      },
      trigger: Platform.OS === 'android' ? { channelId: SOS_CHANNEL } : null,
    }).catch(() => undefined);
    if (!pathnameRef.current.startsWith(`/sos/${newest.id}`)) router.push(`/sos/${newest.id}`);
  }, [alerts]);

  useEffect(() => {
    if (!ringing) return;
    Vibration.vibrate(ALARM_PATTERN, true);
    return () => Vibration.cancel();
  }, [ringing]);

  return null;
}
