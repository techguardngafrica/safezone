import { type ApiRow, unwrap } from '@safezone/api-client';
import { colors, radii, spacing, typography } from '@safezone/design-tokens';
import { formatTime, t } from '@safezone/i18n';
import { ConfirmModal, EmptyState, ErrorState, Skeleton } from '@safezone/mobile-ui';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackRow, BigButton, BodyText, gateStyles, GateTitle } from '../src/components/gate-ui';
import { useParcelsAtGate } from '../src/features/parcels';
import { errorText, isNetworkError } from '../src/lib/errors';
import { useGate } from '../src/lib/gate';
import { api } from '../src/lib/session';
import { usePullRefresh } from '../src/lib/use-pull-refresh';

type Delivery = ApiRow<'/v1/estates/{estateId}/deliveries', 'get'>;
type Closing = { delivery: Delivery; outcome: 'collected' | 'returned' } | null;

/** Parcels waiting at the gate; each is closed once, as collected (by whom) or returned. */
export default function ParcelsScreen() {
  const { estateId } = useGate();
  const queryClient = useQueryClient();
  const parcels = useParcelsAtGate();
  const { refreshing, onRefresh } = usePullRefresh(parcels.refetch);
  const [closing, setClosing] = useState<Closing>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = async () => {
    if (!closing) return;
    setBusy(true);
    setError(null);
    try {
      await unwrap(
        api.POST('/v1/estates/{estateId}/deliveries/{id}/close', {
          params: { path: { estateId, id: closing.delivery.id } },
          body: { outcome: closing.outcome, note: note.trim() },
        }),
      );
      setClosing(null);
      await queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'deliveries'] });
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={gateStyles.screen}>
      <FlatList
        data={parcels.data?.items ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={gateStyles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListHeaderComponent={
          <View style={{ gap: spacing[3] }}>
            <BackRow onBack={() => router.back()} />
            <GateTitle>{t('sec.parcels.title')}</GateTitle>
          </View>
        }
        ListEmptyComponent={
          parcels.isPending ? (
            <Skeleton height={120} />
          ) : parcels.isError ? (
            isNetworkError(parcels.error) ? (
              <BodyText>{t('sec.delivery.offline')}</BodyText>
            ) : (
              <ErrorState
                message={errorText(parcels.error)}
                onRetry={() => void parcels.refetch()}
              />
            )
          ) : (
            <EmptyState title={t('sec.parcels.empty')} />
          )
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.unit}>{item.unitCode ?? ''}</Text>
            <Text style={styles.company}>{item.company}</Text>
            <Text style={styles.meta}>
              {[
                item.riderName,
                item.note,
                t('sec.parcels.since', { time: formatTime(item.createdAt) }),
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            <BigButton
              label={t('sec.parcels.collect')}
              icon="checkmark-done-outline"
              onPress={() => {
                setNote('');
                setError(null);
                setClosing({ delivery: item, outcome: 'collected' });
              }}
            />
            <BigButton
              label={t('sec.parcels.return')}
              tone="outline"
              icon="return-up-back-outline"
              onPress={() => {
                setNote('');
                setError(null);
                setClosing({ delivery: item, outcome: 'returned' });
              }}
            />
          </View>
        )}
      />
      <ConfirmModal
        visible={closing !== null}
        title={
          closing?.outcome === 'returned'
            ? t('sec.parcels.returnTitle')
            : t('sec.parcels.collectTitle')
        }
        body={
          closing?.outcome === 'returned'
            ? t('sec.parcels.returnBody')
            : t('sec.parcels.collectBody')
        }
        confirmLabel={
          closing?.outcome === 'returned' ? t('sec.parcels.return') : t('sec.parcels.collect')
        }
        busy={busy}
        error={error}
        reason={{
          label:
            closing?.outcome === 'returned'
              ? t('sec.parcels.returnLabel')
              : t('sec.parcels.collectLabel'),
          value: note,
          onChange: setNote,
          required: true,
        }}
        onConfirm={() => {
          if (note.trim().length >= 2) void close();
        }}
        onCancel={() => setClosing(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: colors.semantic.border,
    backgroundColor: colors.neutral[0],
  },
  unit: {
    fontSize: typography.size.xxl,
    fontWeight: typography.weight.bold,
    color: colors.semantic.text,
  },
  company: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.semibold,
    color: colors.semantic.text,
  },
  meta: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.medium,
    color: colors.semantic.textMuted,
  },
});
