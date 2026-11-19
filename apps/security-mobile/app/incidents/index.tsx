import { unwrapPage } from '@safezone/api-client';
import { colors, radii, spacing, typography } from '@safezone/design-tokens';
import { formatDateTime, t } from '@safezone/i18n';
import { EmptyState, ErrorState, Skeleton } from '@safezone/mobile-ui';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackRow, BigButton, BodyText, gateStyles, GateTitle } from '../../src/components/gate-ui';
import { errorText, isNetworkError } from '../../src/lib/errors';
import { useGate } from '../../src/lib/gate';
import { api } from '../../src/lib/session';
import { usePullRefresh } from '../../src/lib/use-pull-refresh';

const SEVERITY_COLOR = {
  low: colors.semantic.textMuted,
  medium: colors.status.info,
  high: colors.status.warning,
  critical: colors.status.danger,
} as const;

/** Incidents this guard reported or was assigned (security.md §4.7), newest first. */
export default function IncidentList() {
  const { estateId } = useGate();
  const incidents = useQuery({
    queryKey: ['estate', estateId, 'incidents', 'list'],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/incidents', {
          params: { path: { estateId }, query: { limit: 30 } },
        }),
      ),
  });
  const { refreshing, onRefresh } = usePullRefresh(incidents.refetch);

  return (
    <SafeAreaView style={gateStyles.screen}>
      <FlatList
        data={incidents.data?.items ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={gateStyles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListHeaderComponent={
          <View style={{ gap: spacing[3] }}>
            <BackRow onBack={() => router.back()} />
            <GateTitle>{t('sec.incidents.title')}</GateTitle>
            <BigButton
              label={t('sec.incidents.report')}
              icon="document-text-outline"
              onPress={() => router.push('/incidents/new')}
            />
          </View>
        }
        ListEmptyComponent={
          incidents.isPending ? (
            <Skeleton height={88} />
          ) : incidents.isError ? (
            isNetworkError(incidents.error) ? (
              <BodyText>{t('sec.incidents.offline')}</BodyText>
            ) : (
              <ErrorState
                message={errorText(incidents.error)}
                onRetry={() => void incidents.refetch()}
              />
            )
          ) : (
            <EmptyState title={t('sec.incidents.empty')} />
          )
        }
        renderItem={({ item }) => {
          const details = [
            t(`incident.severity.${item.severity}`),
            t(`incident.status.${item.status}`),
            formatDateTime(item.occurredAt),
            item.evidenceCount > 0
              ? t('sec.incidents.evidence', { count: item.evidenceCount })
              : null,
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.title}, ${details}`}
              onPress={() => router.push(`/incidents/${item.id}`)}
              style={({ pressed }) => [
                styles.row,
                { borderLeftColor: SEVERITY_COLOR[item.severity] },
                pressed && { opacity: 0.8 },
              ]}
            >
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.category}>{t(`incident.category.${item.category}`)}</Text>
              <Text style={styles.details}>{details}</Text>
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 88,
    gap: 2,
    padding: spacing[3],
    borderRadius: radii.lg,
    borderWidth: 2,
    borderLeftWidth: 8,
    borderColor: colors.semantic.border,
    backgroundColor: colors.neutral[0],
  },
  title: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    color: colors.semantic.text,
  },
  category: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
    color: colors.semantic.text,
  },
  details: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.medium,
    color: colors.semantic.textMuted,
  },
});
