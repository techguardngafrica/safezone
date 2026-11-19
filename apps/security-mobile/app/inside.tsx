import { unwrap } from '@safezone/api-client';
import { colors, radii, spacing, typography } from '@safezone/design-tokens';
import { formatTime, t } from '@safezone/i18n';
import { EmptyState, ErrorState, Skeleton } from '@safezone/mobile-ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackRow, BigButton, BodyText, gateStyles, GateTitle } from '../src/components/gate-ui';
import { errorText, isNetworkError } from '../src/lib/errors';
import { useGate } from '../src/lib/gate';
import { api } from '../src/lib/session';
import { usePullRefresh } from '../src/lib/use-pull-refresh';

/** Visitors currently inside the estate, with a one-tap exit (security-mobile.md §7.2 step 6). */
export default function InsideScreen() {
  const { estateId, gates, sync } = useGate();
  const queryClient = useQueryClient();
  const inside = useQuery({
    queryKey: ['estate', estateId, 'gate', 'inside'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/gate/inside', { params: { path: { estateId } } })),
    refetchInterval: 30_000,
  });
  const { refreshing, onRefresh } = usePullRefresh(inside.refetch);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const gateName = (id: string) => gates.find((gate) => gate.id === id)?.name ?? '';

  const exit = async (item: NonNullable<typeof inside.data>[number]) => {
    const key = item.passId ?? item.walkinId ?? item.enteredAt;
    setBusyKey(key);
    setMessage(null);
    try {
      const outcome = await sync.record({
        direction: 'out',
        passId: item.passId ?? undefined,
        walkinId: item.walkinId ?? undefined,
        visitorName: item.visitorName ?? undefined,
        vehiclePlate: item.vehiclePlate ?? undefined,
        decision: 'allow',
      });
      setMessage(
        outcome.queued
          ? `${t('sec.result.exitRecorded')} ${t('sec.result.queued')}`
          : t('sec.result.exitRecorded'),
      );
      await queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'gate', 'inside'] });
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <SafeAreaView style={gateStyles.screen}>
      <FlatList
        data={inside.data ?? []}
        keyExtractor={(item) => item.passId ?? item.walkinId ?? item.enteredAt}
        contentContainerStyle={gateStyles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListHeaderComponent={
          <View style={{ gap: spacing[3] }}>
            <BackRow onBack={() => router.back()} />
            <GateTitle>{t('sec.inside.title')}</GateTitle>
            {message ? (
              <View accessibilityLiveRegion="polite">
                <BodyText>{message}</BodyText>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          inside.isPending ? (
            <View style={{ gap: spacing[3] }}>
              <Skeleton height={96} />
              <Skeleton height={96} />
            </View>
          ) : inside.isError ? (
            isNetworkError(inside.error) ? (
              <EmptyState title={t('sec.inside.offline')} />
            ) : (
              <ErrorState message={errorText(inside.error)} onRetry={() => void inside.refetch()} />
            )
          ) : (
            <EmptyState title={t('sec.inside.empty')} />
          )
        }
        renderItem={({ item }) => {
          const key = item.passId ?? item.walkinId ?? item.enteredAt;
          const details = [
            item.vehiclePlate,
            item.walkinId ? t('sec.inside.walkin') : null,
            gateName(item.gateId),
            t('sec.inside.since', { time: formatTime(item.enteredAt) }),
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <View style={styles.row}>
              <Text style={styles.name}>{item.visitorName ?? t('sec.result.unknownVisitor')}</Text>
              <Text style={styles.details}>{details}</Text>
              <BigButton
                label={t('sec.inside.recordExit')}
                tone="outline"
                icon="exit-outline"
                busy={busyKey === key}
                disabled={busyKey !== null && busyKey !== key}
                onPress={() => void exit(item)}
              />
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: colors.semantic.border,
    backgroundColor: colors.neutral[0],
  },
  name: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    color: colors.semantic.text,
  },
  details: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.medium,
    color: colors.semantic.textMuted,
  },
});
