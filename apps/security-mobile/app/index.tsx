import { t } from '@safezone/i18n';
import { Button, Screen } from '@safezone/mobile-ui';
import { useKeepAwake } from 'expo-keep-awake';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * Placeholder gate home (security-mobile.md §6). Phase 0 adds device registration + guard PIN sign-in;
 * Phase 1 adds QR/PIN verification online and offline, walk-ins, entry/exit logging and SOS alarms.
 * Rules: 56 px touch targets, ALLOW/CHECK/DENY always shown with words and icons, never ads.
 */
export default function GateHomeScreen() {
  useKeepAwake();
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <Screen title={t('security.home.title')}>
        <Button label={t('gate.scan')} large onPress={() => undefined} />
        <Button label={t('gate.enterPin')} variant="secondary" large onPress={() => undefined} />
        <Button label={t('gate.walkIn')} variant="secondary" large onPress={() => undefined} />
      </Screen>
    </SafeAreaView>
  );
}
