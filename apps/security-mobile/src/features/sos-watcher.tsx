import { t } from '@safezone/i18n';
import * as Notifications from 'expo-notifications';
import { router, usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform, Vibration } from 'react-native';
import { SOS_CHANNEL, setUpNotifications } from '../lib/push';
import { categoryText, useActiveSos } from './sos';

/** Long, repeating pattern: the alarm must be noticed at a noisy gate. */
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
 * Watches for new SOS alerts while the app is open (security-mobile.md §7.6): a new alert opens the
 * full-screen alarm over whatever the guard is doing, vibrates until someone acknowledges it, and plays
 * the notification sound. Never blocked on anything else (AGENTS.md §6.1).
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

  const alerts = active.data;
  const unacknowledged = (alerts ?? []).filter((alert) => alert.status === 'triggered');

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
          ? `${t('sec.sos.drill')} ${t('sec.sos.notification.title')}`
          : t('sec.sos.notification.title'),
        body: t('sec.sos.notification.body', {
          category: categoryText(newest.category),
          unit: newest.unitCode ?? t('sec.sos.noUnit'),
        }),
        sound: 'default',
        priority: Notifications.AndroidNotificationPriority.MAX,
      },
      trigger: Platform.OS === 'android' ? { channelId: SOS_CHANNEL } : null,
    }).catch(() => undefined);
    if (!pathnameRef.current.startsWith(`/sos/${newest.id}`)) router.push(`/sos/${newest.id}`);
  }, [alerts]);

  const ringing = unacknowledged.length > 0;
  useEffect(() => {
    if (!ringing) return;
    Vibration.vibrate(ALARM_PATTERN, true);
    return () => Vibration.cancel();
  }, [ringing]);

  return null;
}
