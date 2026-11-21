import { colors, spacing } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  EmptyState,
  ErrorState,
  SignInFlow,
  Skeleton,
  useSession,
} from '@safezone/mobile-ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '../src/components/icon';
import { AppLock } from '../src/features/app-lock';
import { SosWatcher } from '../src/features/sos-watcher';
import { errorText } from '../src/lib/errors';
import { ManagerProvider, manageableMemberships, useMemberships } from '../src/lib/manager';
import { session } from '../src/lib/session';

function Splash() {
  return (
    <SafeAreaView style={{ flex: 1, padding: spacing[4], gap: spacing[3] }}>
      <Skeleton height={28} width="60%" />
      <Skeleton height={120} />
      <Skeleton height={120} />
    </SafeAreaView>
  );
}

/** Signed-in app: loads memberships once, then every route can read the manager context. */
function SignedInApp() {
  const memberships = useMemberships();
  if (memberships.isPending) return <Splash />;
  if (memberships.isError)
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', padding: spacing[4] }}>
        <ErrorState
          message={errorText(memberships.error)}
          onRetry={() => void memberships.refetch()}
        />
      </SafeAreaView>
    );
  const usable = manageableMemberships(memberships.data);
  if (usable.length === 0)
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', padding: spacing[4] }}>
        <EmptyState
          icon={<Icon name="business-outline" size={28} color={colors.brand.primary} />}
          title={t('management.picker.emptyTitle')}
          body={t('management.picker.emptyBody')}
          action={
            <ActionButton
              label={t('auth.signOut')}
              variant="outline"
              onPress={() => void session.signOut()}
            />
          }
        />
      </SafeAreaView>
    );
  return (
    <ManagerProvider memberships={usable}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.semantic.background },
        }}
      >
        <Stack.Screen
          name="sos/[id]"
          options={{ presentation: 'fullScreenModal', gestureEnabled: false }}
        />
      </Stack>
      <SosWatcher />
    </ManagerProvider>
  );
}

/** Restores the session on start; phone + OTP, then authenticator MFA for staff, until signed in. */
function AuthGate() {
  const state = useSession(session);
  // Only a session restored from the phone opens locked; a fresh sign-in has just proved who this is.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (session.getState().status !== 'restoring') return;
    void session.restore().then(() => setRestored(session.getState().status === 'signed_in'));
  }, []);
  useEffect(() => {
    if (state.status !== 'signed_in' && state.status !== 'restoring') setRestored(false);
  }, [state.status]);
  if (state.status === 'restoring') return <Splash />;
  if (state.status !== 'signed_in')
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.semantic.background }}>
        <View style={{ flex: 1 }}>
          <SignInFlow controller={session} title={t('app.name')} intro={t('mm.signIn.intro')} />
        </View>
      </SafeAreaView>
    );
  return (
    <View style={{ flex: 1 }}>
      <SignedInApp />
      <AppLock startLocked={restored} />
    </View>
  );
}

export default function RootLayout() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15_000 } } }),
  );
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="dark" />
        <AuthGate />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
