import { unwrap } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import { Button, Screen, SessionGate, useSession } from '@safezone/mobile-ui';
import { useQuery } from '@tanstack/react-query';
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
        <Text key={membership.estate.id}>
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
    <Screen title={t('resident.home.title')}>
      <Text>{t('home.signedInAs', { name: state.user?.fullName ?? state.user?.phone ?? '' })}</Text>
      <Text accessibilityRole="header">{t('home.memberships.title')}</Text>
      <Memberships />
      <Button
        label={t('auth.signOut')}
        variant="secondary"
        onPress={() => void session.signOut()}
      />
    </Screen>
  );
}

/**
 * Resident home. Phase 1 adds join estate, visitors and SOS; the SOS button will be reachable from every screen and never covered.
 */
export default function HomeScreen() {
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <SessionGate controller={session} title={t('app.name')}>
        <SignedInHome />
      </SessionGate>
    </SafeAreaView>
  );
}
