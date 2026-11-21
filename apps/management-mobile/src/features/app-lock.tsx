import { colors, spacing, typography } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import { ActionButton, Banner } from '@safezone/mobile-ui';
import * as LocalAuthentication from 'expo-local-authentication';
import { usePathname } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '../components/icon';
import { session } from '../lib/session';
import { lockCovers, shouldLockOnResume } from './lock-rules';

type Support = 'checking' | 'available' | 'none';

/** Whether the phone has a screen lock (biometrics, PIN, pattern or password) we can ask for. */
async function deviceSupport(): Promise<Support> {
  try {
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    return level === LocalAuthentication.SecurityLevel.NONE ? 'none' : 'available';
  } catch {
    return 'none';
  }
}

/**
 * App lock (management-mobile.md §10): asks for biometrics or the device PIN when the app opens from a
 * restored session and after 5 minutes in the background. The SOS screen is never covered, so an alert
 * can be acknowledged from a locked phone. A phone with no screen lock cannot be locked; the user is
 * told to set one instead of being shut out.
 */
export function AppLock({ startLocked }: { startLocked: boolean }) {
  const pathname = usePathname();
  const [support, setSupport] = useState<Support>('checking');
  const [locked, setLocked] = useState(startLocked);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    void deviceSupport().then(setSupport);
  }, []);

  // The restore can finish after the first signed-in render.
  useEffect(() => {
    if (startLocked) setLocked(true);
  }, [startLocked]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        // A device-PIN prompt can send the app to the background; keep the earliest time.
        backgroundedAt.current ??= Date.now();
        return;
      }
      if (state === 'active') {
        if (shouldLockOnResume(backgroundedAt.current, Date.now())) setLocked(true);
        backgroundedAt.current = null;
      }
    });
    return () => subscription.remove();
  }, []);

  const unlock = useCallback(async () => {
    setBusy(true);
    setFailed(false);
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: t('mm.lock.prompt'),
        cancelLabel: t('common.cancel'),
        disableDeviceFallback: false,
      });
      if (result.success) setLocked(false);
      else if (result.error !== 'user_cancel' && result.error !== 'app_cancel') setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, []);

  const show = locked && support === 'available' && lockCovers(pathname);

  // Ask straight away when the lock appears, so unlocking is one touch of the sensor.
  useEffect(() => {
    if (show && AppState.currentState === 'active') void unlock();
  }, [show, unlock]);

  if (!show) return null;
  return (
    <SafeAreaView style={styles.cover} accessibilityViewIsModal>
      <View style={styles.body}>
        <Icon name="lock-closed-outline" size={48} color={colors.brand.primary} />
        <Text accessibilityRole="header" style={styles.title}>
          {t('mm.lock.title')}
        </Text>
        <Text style={styles.text}>{t('mm.lock.body')}</Text>
        {failed ? <Banner tone="danger">{t('mm.lock.failed')}</Banner> : null}
      </View>
      <View style={styles.actions}>
        <ActionButton
          label={t('mm.lock.unlock')}
          icon={<Icon name="finger-print-outline" size={20} color={colors.brand.onPrimary} />}
          busy={busy}
          onPress={() => void unlock()}
        />
        <ActionButton
          label={t('auth.signOut')}
          variant="text"
          onPress={() => void session.signOut()}
        />
      </View>
    </SafeAreaView>
  );
}

/** Shown in More when the phone has no screen lock, so the app cannot lock itself. */
export function useDeviceLockMissing(): boolean {
  const [support, setSupport] = useState<Support>('checking');
  useEffect(() => {
    void deviceSupport().then(setSupport);
  }, []);
  return support === 'none';
}

const styles = StyleSheet.create({
  cover: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.semantic.background,
    padding: spacing[5],
    justifyContent: 'space-between',
  },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing[3] },
  title: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    color: colors.semantic.text,
    textAlign: 'center',
  },
  text: { fontSize: typography.size.md, color: colors.semantic.textMuted, textAlign: 'center' },
  actions: { gap: spacing[2] },
});
