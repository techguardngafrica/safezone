import { colors } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import { ErrorState, SignInFlow, Skeleton, useSession } from '@safezone/mobile-ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { errorText } from '../src/lib/errors';
import { ResidentProvider, useMemberships, usableMemberships } from '../src/lib/resident';
import { session } from '../src/lib/session';

function Splash() {
  return (
    <SafeAreaView style={{ flex: 1, padding: 16, gap: 12 }}>
      <Skeleton height={28} width="60%" />
      <Skeleton height={120} />
      <Skeleton height={120} />
    </SafeAreaView>
  );
}

/** Signed-in app: loads memberships once, then every route can read the resident context. */
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
  return (
    <ResidentProvider memberships={usableMemberships(memberships.data)}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.semantic.background },
        }}
      >
        <Stack.Screen
          name="sos"
          options={{ presentation: 'fullScreenModal', gestureEnabled: false }}
        />
      </Stack>
    </ResidentProvider>
  );
}

/** Restores the session on start and shows phone + OTP sign-in until signed in. */
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
          <SignInFlow controller={session} title={t('app.name')} intro={t('res.signIn.intro')} />
        </View>
      </SafeAreaView>
    );
  return <SignedInApp />;
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
