import { colors } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import { ErrorState, SignInFlow, Skeleton, useSession } from '@safezone/mobile-ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { GatePicker, NotAGuard } from '../src/features/gate-setup';
import { SosWatcher } from '../src/features/sos-watcher';
import { errorText } from '../src/lib/errors';
import { GateProvider, useGate, useMemberships, usableMemberships } from '../src/lib/gate';
import { session } from '../src/lib/session';

function Splash() {
  return (
    <SafeAreaView style={{ flex: 1, padding: 16, gap: 12, backgroundColor: colors.neutral[0] }}>
      <Skeleton height={32} width="60%" />
      <Skeleton height={132} />
      <Skeleton height={104} />
      <Skeleton height={104} />
    </SafeAreaView>
  );
}

/** Routes for a guard at a chosen gate. SOS alarms open over any screen. */
function GateApp() {
  const { gate, can, permissionsLoaded } = useGate();
  if (!permissionsLoaded) return <Splash />;
  if (!can('gate.verify')) return <NotAGuard />;
  if (!gate) return <GatePicker />;
  return (
    <>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.neutral[0] },
        }}
      >
        <Stack.Screen name="result" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen
          name="sos/[id]"
          options={{ presentation: 'fullScreenModal', gestureEnabled: false }}
        />
      </Stack>
      <SosWatcher />
    </>
  );
}

function SignedInApp() {
  const memberships = useMemberships();
  if (memberships.isPending) return <Splash />;
  if (memberships.isError)
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', padding: 16 }}>
        <ErrorState
          message={errorText(memberships.error)}
          onRetry={() => void memberships.refetch()}
        />
      </SafeAreaView>
    );
  const usable = usableMemberships(memberships.data);
  if (usable.length === 0) return <NotAGuard noEstate />;
  return (
    <GateProvider memberships={usable}>
      <GateApp />
    </GateProvider>
  );
}

/**
 * Phase 1 start: supervisor or officer phone + OTP (+ MFA for staff). Gate-device registration and guard
 * PIN shift sign-in (identity.md §5.3) replace this once their API lands.
 */
function AuthGate() {
  const state = useSession(session);
  useEffect(() => {
    if (session.getState().status === 'restoring') void session.restore();
  }, []);
  if (state.status === 'restoring') return <Splash />;
  if (state.status !== 'signed_in')
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.semantic.background }}>
        <View style={{ flex: 1 }}>
          <SignInFlow controller={session} title={t('app.name')} intro={t('sec.signIn.intro')} />
        </View>
      </SafeAreaView>
    );
  return <SignedInApp />;
}

export default function RootLayout() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, staleTime: 15_000, networkMode: 'always' } },
      }),
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
