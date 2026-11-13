import { t } from '@safezone/i18n';
import { Button, Screen } from '@safezone/mobile-ui';
import { Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * Placeholder permission-aware dashboard. Phase 0 adds phone + OTP + MFA sign-in;
 * Phase 1 adds the approvals inbox, live gate feed and SOS response.
 */
export default function HomeScreen() {
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <Screen title={t('management.home.title')}>
        <Text>Active SOS, gate activity and pending approvals appear here.</Text>
        <Button label={t('auth.signIn')} onPress={() => undefined} />
      </Screen>
    </SafeAreaView>
  );
}
