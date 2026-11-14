import { unwrap } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import { Button, Screen, SessionGate, useSession } from '@safezone/mobile-ui';
import { useQuery } from '@tanstack/react-query';
import { useKeepAwake } from 'expo-keep-awake';
import { Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, session } from '../src/lib/session';

function Memberships() {
  const memberships = useQuery({
    queryKey: ['me', 'memberships'],
    queryFn: () => unwrap(api.GET('/v1/me/memberships')),
  });
  if (memberships.isPending) return <Text>{t('common.loading')}</Text>;
  if (memberships.isError)
    return <Text accessibilityLiveRegion="polite">{t('home.memberships.error')}</Text>;
  if (memberships.data.length === 0) return <Text>{t('home.memberships.empty')}</Text>;
  return (
    <>
      {memberships.data.map((membership) => (
        <Text key={membership.estate.id} style={{ fontSize: 18 }}>
          {membership.estate.name}:{' '}
          {t('home.memberships.roles', { roles: membership.roles.join(', ') || '-' })}
        </Text>
      ))}
    </>
  );
}

function SignedInHome() {
  const state = useSession(session);
  return (
    <Screen title={t('security.home.title')}>
      <Text>{t('home.signedInAs', { name: state.user?.fullName ?? state.user?.phone ?? '' })}</Text>
      <Text accessibilityRole="header">{t('home.memberships.title')}</Text>
      <Memberships />
      <Button
        label={t('auth.signOut')}
        variant="secondary"
        large
        onPress={() => void session.signOut()}
      />
    </Screen>
  );
}

/**
 * Gate home shell (security-mobile.md §6): 56 px targets, never ads. Phase 1 adds pass verification
 * (online and offline), walk-ins, entry and exit logging and SOS alarms.
 */
export default function HomeScreen() {
  useKeepAwake();
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <SessionGate controller={session} title={t('app.name')} large>
        <SignedInHome />
      </SessionGate>
    </SafeAreaView>
  );
}
