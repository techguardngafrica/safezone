import { t } from '@safezone/i18n';
import { Button, Screen } from '@safezone/mobile-ui';
import { Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * Placeholder home. Phase 0 adds phone + OTP sign-in; Phase 1 adds join estate, visitors and SOS.
 * Rule: the SOS button must be reachable from every screen and never covered by any element, including ads.
 */
export default function HomeScreen() {
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <Screen title={t('resident.home.title')}>
        <Text>{t('app.tagline')}</Text>
        <Button label={t('auth.signIn')} onPress={() => undefined} />
        <Button label={t('sos.button')} variant="danger" large onPress={() => undefined} />
      </Screen>
    </SafeAreaView>
  );
}
