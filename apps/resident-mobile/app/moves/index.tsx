import { unwrap } from '@safezone/api-client';
import { colors, radii, spacing, typography } from '@safezone/design-tokens';
import { formatDate, formatKobo, type MessageKey, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  Card,
  EmptyState,
  ErrorState,
  ScreenHeader,
  ScrollScreen,
  Skeleton,
  StatusPill,
  TextField,
} from '@safezone/mobile-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../../src/components/icon';
import { checklistSummary, type Move, MOVE_TONE } from '../../src/features/moves';
import { errorText } from '../../src/lib/errors';
import { useResident } from '../../src/lib/resident';
import { api } from '../../src/lib/session';
import { usePullRefresh } from '../../src/lib/use-pull-refresh';

/** Move-in and move-out list (resident-mobile.md §4): scheduled moves, gate notices, checklist & cancel. */
export default function MovesScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { estateId, household } = useResident();
  const [cancelling, setCancelling] = useState<Move | null>(null);
  const [reason, setReason] = useState('');

  const moves = useQuery({
    queryKey: ['estate', estateId, 'moves'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/moves', { params: { path: { estateId } } })),
  });

  const cancel = useMutation({
    mutationFn: ({ move, text }: { move: Move; text: string }) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/moves/{id}/cancel', {
          params: { path: { estateId, id: move.id } },
          body: { reason: text.trim() },
        }),
      ),
    onSuccess: () => {
      setCancelling(null);
      setReason('');
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'moves'] });
    },
  });

  const pull = usePullRefresh(moves.refetch);

  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']} {...pull}>
      <ScreenHeader
        title={t('res.moves.title')}
        subtitle={household?.unit.code}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/more'))}
        backIcon={<Icon name="arrow-back" />}
      />

      {household?.occupancy ? (
        <ActionButton
          label={t('res.moves.schedule')}
          icon={<Icon name="calendar-outline" color="#FFFFFF" size={20} />}
          onPress={() => router.push('/moves/new')}
        />
      ) : null}

      {moves.isPending ? <Skeleton height={140} /> : null}
      {moves.isError ? (
        <ErrorState message={errorText(moves.error)} onRetry={() => void moves.refetch()} />
      ) : null}
      {moves.data && moves.data.length === 0 ? (
        <EmptyState
          icon={<Icon name="cube-outline" size={28} color={colors.brand.primary} />}
          title={t('res.moves.empty')}
          body={t('res.moves.emptyBody')}
        />
      ) : null}

      {(moves.data ?? []).map((move) => {
        const summary = checklistSummary(move.checklist);
        return (
          <Card key={move.id}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>
                {t(`res.moves.type.${move.type}` as MessageKey)} · {move.unitCode}
              </Text>
              <StatusPill
                tone={MOVE_TONE[move.status]}
                label={t(`res.moves.status.${move.status}` as MessageKey)}
              />
            </View>
            <Text style={styles.meta}>
              {t('res.moves.date', { date: formatDate(`${move.scheduledOn}T12:00:00Z`) })}
            </Text>
            {move.outstandingBalance > 0 && move.status === 'scheduled' ? (
              <Banner tone="warning">
                {t('res.moves.balanceWarning', { amount: formatKobo(move.outstandingBalance) })}
              </Banner>
            ) : null}
            {move.gateNotice.items ? (
              <Text style={styles.body}>
                {t('res.moves.items', { items: move.gateNotice.items })}
              </Text>
            ) : null}
            {move.gateNotice.vehicles.length > 0 ? (
              <Text style={styles.body}>
                {t('res.moves.vehicles', { vehicles: move.gateNotice.vehicles.join(', ') })}
              </Text>
            ) : null}
            {move.gateNotice.notes ? (
              <Text style={styles.meta}>
                {t('res.moves.notes', { notes: move.gateNotice.notes })}
              </Text>
            ) : null}
            {summary.total > 0 ? (
              <View style={styles.checklistBox}>
                <Text style={styles.checklistTitle}>
                  {t('res.moves.checklist', { done: summary.done, total: summary.total })}
                </Text>
                {move.checklist.map((entry, idx) => (
                  <View key={`${entry.item}-${idx}`} style={styles.checkItem}>
                    <Icon
                      name={entry.done ? 'checkmark-circle' : 'ellipse-outline'}
                      size={16}
                      color={entry.done ? colors.status.success : colors.semantic.textMuted}
                    />
                    <Text style={styles.body}>{entry.item}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            {move.status === 'scheduled' ? (
              <ActionButton
                label={t('res.moves.cancel')}
                variant="text"
                onPress={() => {
                  setCancelling(move);
                  setReason('');
                }}
              />
            ) : null}
          </Card>
        );
      })}

      <Modal
        visible={Boolean(cancelling)}
        transparent
        animationType="fade"
        onRequestClose={() => setCancelling(null)}
      >
        <Pressable
          style={styles.scrim}
          onPress={() => setCancelling(null)}
          accessibilityLabel={t('ui.close')}
        >
          <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
            <Text style={styles.sheetTitle}>{t('res.moves.cancelTitle')}</Text>
            <TextField
              label={t('res.moves.cancelReason')}
              placeholder={t('res.moves.cancelPlaceholder')}
              value={reason}
              onChangeText={setReason}
              multiline
              maxLength={500}
            />
            {cancel.isError ? <Banner tone="danger">{errorText(cancel.error)}</Banner> : null}
            <ActionButton
              label={t('res.moves.cancel')}
              disabled={reason.trim().length < 3}
              busy={cancel.isPending}
              onPress={() => cancelling && cancel.mutate({ move: cancelling, text: reason })}
            />
            <ActionButton
              label={t('common.cancel')}
              variant="text"
              onPress={() => setCancelling(null)}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollScreen>
  );
}

const styles = StyleSheet.create({
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing[2],
  },
  cardTitle: {
    flex: 1,
    fontSize: typography.size.md,
    fontWeight: typography.weight.bold,
    color: colors.semantic.text,
  },
  meta: {
    fontSize: typography.size.xs,
    color: colors.semantic.textMuted,
  },
  body: {
    fontSize: typography.size.sm,
    color: colors.semantic.text,
  },
  checklistBox: {
    backgroundColor: colors.semantic.surfaceMuted,
    borderRadius: radii.md,
    padding: spacing[3],
    gap: spacing[1],
  },
  checklistTitle: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.semibold,
    color: colors.semantic.textMuted,
    marginBottom: 2,
  },
  checkItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.semantic.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    padding: spacing[5],
    gap: spacing[3],
  },
  sheetTitle: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.bold,
    color: colors.semantic.text,
  },
});
