import { newIdempotencyKey } from '@safezone/api-client';
import { colors, radii, typography } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import { ConfirmModal } from '@safezone/mobile-ui';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  Vibration,
  View,
} from 'react-native';

const HOLD_MS = 3_000;
export const SOS_BUTTON_SIZE = 72;
export const TAB_BAR_HEIGHT = 64;
/** Bottom padding for tab screens so the last content clears the floating SOS control. */
export const SOS_CLEARANCE = SOS_BUTTON_SIZE + 24;

/**
 * Persistent SOS control (UI_GUIDELINES §9.1): press and hold for 3 seconds with a visible fill and
 * haptic ticks; with a screen reader on, tap then confirm. Opening the SOS screen sends the alert
 * immediately, with no network call or loading screen before it.
 */
export function SosButton({ activeAlertId }: { activeAlertId: string | null }) {
  const router = useRouter();
  const progress = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ticks = useRef<ReturnType<typeof setInterval> | null>(null);
  const [screenReader, setScreenReader] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isScreenReaderEnabled().then(setScreenReader);
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader);
    return () => sub.remove();
  }, []);

  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    if (ticks.current) clearInterval(ticks.current);
    timer.current = null;
    ticks.current = null;
    progress.stopAnimation();
    Animated.timing(progress, { toValue: 0, duration: 150, useNativeDriver: false }).start();
  };

  const send = () => {
    stop();
    Vibration.vibrate(400);
    router.push({ pathname: '/sos', params: { trigger: '1', key: newIdempotencyKey() } });
  };

  const openActive = () => {
    if (activeAlertId) router.push({ pathname: '/sos', params: { id: activeAlertId } });
  };

  const start = () => {
    if (activeAlertId) return;
    Vibration.vibrate(30);
    ticks.current = setInterval(() => Vibration.vibrate(30), 1_000);
    Animated.timing(progress, {
      toValue: 1,
      duration: HOLD_MS,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();
    timer.current = setTimeout(send, HOLD_MS);
  };

  const fill = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={activeAlertId ? t('res.sos.openActive') : t('sos.button')}
        accessibilityHint={
          activeAlertId ? undefined : screenReader ? t('res.sos.tapHint') : t('sos.hold')
        }
        onPressIn={screenReader ? undefined : start}
        onPressOut={screenReader ? undefined : () => timer.current && stop()}
        onPress={activeAlertId ? openActive : screenReader ? () => setConfirming(true) : undefined}
        style={styles.button}
      >
        <View style={styles.track}>
          <Animated.View style={[styles.fill, { height: fill }]} />
        </View>
        <Text style={styles.label}>{activeAlertId ? t('res.sos.live') : t('sos.button')}</Text>
      </Pressable>
      <ConfirmModal
        visible={confirming}
        title={t('res.sos.confirmTitle')}
        body={t('res.sos.confirmBody')}
        confirmLabel={t('res.sos.confirmSend')}
        destructive
        onConfirm={() => {
          setConfirming(false);
          send();
        }}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    width: SOS_BUTTON_SIZE,
    height: SOS_BUTTON_SIZE,
    borderRadius: radii.pill,
    backgroundColor: colors.status.danger,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    elevation: 6,
    shadowColor: '#000000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  track: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, justifyContent: 'flex-end' },
  fill: { width: '100%', backgroundColor: '#8F1414' },
  label: {
    color: '#FFFFFF',
    fontSize: typography.size.lg,
    fontWeight: typography.weight.bold,
    letterSpacing: 1,
  },
});
