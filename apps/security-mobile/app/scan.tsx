import { colors, radii, spacing, typography } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import { Segmented } from '@safezone/mobile-ui';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackRow, BigButton, BodyText, gateStyles, GateTitle } from '../src/components/gate-ui';
import { useCheck } from '../src/features/use-check';

/** Camera QR scan (security-mobile.md §7.2). Target: scan to decision in under 3 seconds. */
export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const { check, busy, error } = useCheck(direction);
  const [focused, setFocused] = useState(true);
  const lastCode = useRef<{ code: string; at: number } | null>(null);

  // The camera only runs while this screen is in front (battery, and no double scans behind the result).
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      lastCode.current = null;
      return () => setFocused(false);
    }, []),
  );

  const onScanned = useCallback(
    ({ data }: { data: string }) => {
      const now = Date.now();
      // The same code is reported many times a second; act on it once.
      if (lastCode.current?.code === data && now - lastCode.current.at < 4000) return;
      lastCode.current = { code: data, at: now };
      void check({ qr: data.trim() });
    },
    [check],
  );

  const header = (
    <View style={{ gap: spacing[3] }}>
      <BackRow onBack={() => router.back()} />
      <GateTitle>{t('sec.scan.title')}</GateTitle>
      <Segmented
        label={t('sec.direction.label')}
        value={direction}
        onChange={setDirection}
        options={[
          { key: 'in', label: t('sec.direction.in') },
          { key: 'out', label: t('sec.direction.out') },
        ]}
      />
    </View>
  );

  if (!permission) return <SafeAreaView style={gateStyles.screen} />;

  if (!permission.granted)
    return (
      <SafeAreaView style={gateStyles.screen}>
        <View style={gateStyles.content}>
          {header}
          <GateTitle>{t('sec.scan.permissionTitle')}</GateTitle>
          <BodyText>
            {permission.canAskAgain ? t('sec.scan.permissionBody') : t('sec.scan.permissionDenied')}
          </BodyText>
          {permission.canAskAgain ? (
            <BigButton
              label={t('sec.scan.permissionAllow')}
              icon="camera-outline"
              onPress={() => void requestPermission()}
            />
          ) : null}
          <BigButton
            label={t('sec.scan.usePin')}
            tone="outline"
            icon="keypad-outline"
            onPress={() => router.replace('/pin')}
          />
        </View>
      </SafeAreaView>
    );

  return (
    <SafeAreaView style={gateStyles.screen}>
      <View style={[gateStyles.content, { flex: 1 }]}>
        {header}
        <View style={styles.frame}>
          {focused ? (
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={busy ? undefined : onScanned}
            />
          ) : null}
          {busy ? (
            <View style={styles.busy} accessibilityLiveRegion="polite">
              <ActivityIndicator size="large" color={colors.neutral[0]} />
              <Text style={styles.busyText}>{t('sec.scan.checking')}</Text>
            </View>
          ) : null}
        </View>
        <BodyText muted>{t('sec.scan.hint')}</BodyText>
        {error ? (
          <Text accessibilityLiveRegion="polite" style={styles.error}>
            {error}
          </Text>
        ) : null}
        <BigButton
          label={t('sec.scan.usePin')}
          tone="outline"
          icon="keypad-outline"
          onPress={() => router.replace('/pin')}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  frame: {
    flex: 1,
    minHeight: 280,
    borderRadius: radii.lg,
    overflow: 'hidden',
    backgroundColor: colors.semantic.text,
  },
  busy: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.overlay.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[3],
  },
  busyText: {
    color: colors.neutral[0],
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
  },
  error: {
    color: colors.status.danger,
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
  },
});
