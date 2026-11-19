import { colors } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import { ErrorState, SignInFlow, Skeleton, useSession } from '@safezone/mobile-ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { BigButton } from '../src/components/gate-ui';
import { GatePicker, NotAGuard } from '../src/features/gate-setup';
import { forgetGateSessionUser, isGateSessionUser } from '../src/features/guard-auth';
import { GuardSignIn } from '../src/features/guard-sign-in';
import { IdleLock } from '../src/features/idle-lock';
import { SosWatcher } from '../src/features/sos-watcher';
import { errorText } from '../src/lib/errors';
import { gateDevice, useGateDevice } from '../src/lib/device';
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
  const { device } = useGateDevice();
  const state = useSession(session);
  const pinSession = state.offline === true || isGateSessionUser(state.user?.id);
  if (!permissionsLoaded) return <Splash />;
  if (!can('gate.verify')) return <NotAGuard />;
  if (!gate) return <GatePicker />;
  const routes = (
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
  // On a shared gate phone, guard sessions lock after 10 minutes idle (personal phones do not).
  return device ? (
    <IdleLock device={device} pinUnlock={pinSession}>
      {routes}
    </IdleLock>
  ) : (
    routes
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
 * Sign-in: on a registered gate phone, guards pick their name and enter their PIN (ADR-0017); phone,
 * SMS code and MFA stay available for supervisors and for guards setting their first PIN.
 */
function AuthGate() {
  const state = useSession(session);
  const { loaded, device } = useGateDevice();
  const [phoneSignIn, setPhoneSignIn] = useState(false);
  useEffect(() => {
    void gateDevice.load();
    if (session.getState().status === 'restoring') void session.restore();
  }, []);
  useEffect(() => {
    if (state.status === 'signed_in') setPhoneSignIn(false);
  }, [state.status]);
  if (state.status === 'restoring' || !loaded) return <Splash />;
  if (state.status !== 'signed_in') {
    if (device && !phoneSignIn)
      return (
        <GuardSignIn
          device={device}
          onPhoneSignIn={() => {
            forgetGateSessionUser();
            setPhoneSignIn(true);
          }}
        />
      );
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.semantic.background }}>
        <View style={{ flex: 1, gap: 8 }}>
          <SignInFlow controller={session} title={t('app.name')} intro={t('sec.signIn.intro')} />
          {device && state.status === 'signed_out' ? (
            <View style={{ padding: 16 }}>
              <BigButton
                label={t('sec.guard.backToGuards')}
                tone="outline"
                onPress={() => setPhoneSignIn(false)}
              />
            </View>
          ) : null}
        </View>
      </SafeAreaView>
    );
  }
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
