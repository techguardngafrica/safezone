import { type ApiRow, unwrapPage } from '@safezone/api-client';
import { colors, radii, spacing, typography } from '@safezone/design-tokens';
import { formatDateTime, formatKobo, type MessageKey, t } from '@safezone/i18n';
import {
  ActionButton,
  Card,
  EmptyState,
  ErrorState,
  ListRow,
  ScreenHeader,
  ScrollScreen,
  Skeleton,
  StatusPill,
  type Tone,
  useSession,
} from '@safezone/mobile-ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../../../src/components/icon';
import { errorText } from '../../../src/lib/errors';
import { paymentMethodText } from '../../../src/lib/labels';
import { useResident } from '../../../src/lib/resident';
import { api, session } from '../../../src/lib/session';
import { usePullRefresh } from '../../../src/lib/use-pull-refresh';

type Transaction = ApiRow<'/v1/estates/{estateId}/transactions', 'get'>;

const STATUS_TONE: Record<Transaction['status'], Tone> = {
  succeeded: 'success',
  refunded: 'neutral',
  partially_refunded: 'info',
};

/** Payment receipts (resident-mobile.md §6.6): verified payments with shareable receipt details. */
export default function ReceiptsScreen() {
  const router = useRouter();
  const { estateId, estateName } = useResident();
  const me = useSession(session).user?.id;
  const [selected, setSelected] = useState<Transaction | null>(null);

  const transactions = useInfiniteQuery({
    // Always the signed-in payer: staff who reconcile would otherwise get the whole estate's payments.
    queryKey: ['estate', estateId, 'transactions', 'mine', me],
    queryFn: ({ pageParam }) =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/transactions', {
          params: {
            path: { estateId },
            query: { limit: 50, cursor: pageParam, payerUserId: me ?? '' },
          },
        }),
      ),
    enabled: Boolean(me),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const pull = usePullRefresh(transactions.refetch);
  const items = transactions.data?.pages.flatMap((page) => page.items) ?? [];

  const shareReceipt = (item: Transaction) => {
    void Share.share({
      message: t('res.receipts.shareText', {
        estate: estateName,
        amount: formatKobo(item.amount),
        status: t(`res.receipts.status.${item.status}` as MessageKey),
        date: formatDateTime(item.paidAt),
        channel: paymentMethodText(item.channel),
        reference: item.reference,
      }),
    });
  };

  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']} {...pull}>
      <ScreenHeader
        title={t('res.receipts.title')}
        subtitle={estateName}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/pay'))}
        backIcon={<Icon name="arrow-back" />}
      />

      {transactions.isPending ? <Skeleton height={140} /> : null}
      {transactions.isError ? (
        <ErrorState
          message={errorText(transactions.error)}
          onRetry={() => void transactions.refetch()}
        />
      ) : null}
      {transactions.data && items.length === 0 ? (
        <EmptyState
          icon={<Icon name="receipt-outline" size={28} color={colors.brand.primary} />}
          title={t('res.receipts.empty')}
          body={t('res.receipts.emptyBody')}
        />
      ) : null}

      {items.length > 0 ? (
        <Card>
          {items.map((item) => (
            <ListRow
              key={item.id}
              title={formatKobo(item.amount)}
              subtitle={`${formatDateTime(item.paidAt)} · ${paymentMethodText(item.channel)}`}
              leading={
                <Icon name="checkmark-circle-outline" color={colors.status.success} size={22} />
              }
              trailing={
                <StatusPill
                  tone={STATUS_TONE[item.status]}
                  label={t(`res.receipts.status.${item.status}` as MessageKey)}
                />
              }
              onPress={() => setSelected(item)}
            />
          ))}
        </Card>
      ) : null}

      {transactions.hasNextPage ? (
        <ActionButton
          label={t('ui.loadMore')}
          variant="outline"
          busy={transactions.isFetchingNextPage}
          onPress={() => void transactions.fetchNextPage()}
        />
      ) : null}

      <Modal
        visible={Boolean(selected)}
        transparent
        animationType="fade"
        onRequestClose={() => setSelected(null)}
      >
        <Pressable
          style={styles.scrim}
          onPress={() => setSelected(null)}
          accessibilityLabel={t('ui.close')}
        >
          <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
            {selected ? (
              <>
                <View style={styles.sheetHeader}>
                  <Text accessibilityRole="header" style={styles.sheetTitle}>
                    {t('res.receipts.detailTitle')}
                  </Text>
                  <StatusPill
                    tone={STATUS_TONE[selected.status]}
                    label={t(`res.receipts.status.${selected.status}` as MessageKey)}
                  />
                </View>
                <Text style={styles.receiptAmount}>{formatKobo(selected.amount)}</Text>
                <View style={styles.detailCard}>
                  <DetailRow label={t('res.receipts.estate')} value={estateName} />
                  <DetailRow
                    label={t('res.receipts.paidAt')}
                    value={formatDateTime(selected.paidAt)}
                  />
                  <DetailRow
                    label={t('res.receipts.channel')}
                    value={paymentMethodText(selected.channel)}
                  />
                  <DetailRow label={t('res.receipts.provider')} value={selected.provider} />
                  <DetailRow label={t('res.receipts.reference')} value={selected.reference} />
                </View>
                <ActionButton
                  label={t('res.receipts.share')}
                  icon={<Icon name="share-outline" color="#FFFFFF" size={18} />}
                  onPress={() => shareReceipt(selected)}
                />
                <ActionButton
                  label={t('ui.close')}
                  variant="text"
                  onPress={() => setSelected(null)}
                />
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollScreen>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text selectable style={styles.detailValue}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: colors.overlay.scrim,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.semantic.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    padding: spacing[5],
    gap: spacing[3],
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sheetTitle: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.bold,
    color: colors.semantic.text,
  },
  receiptAmount: {
    fontSize: 30,
    fontWeight: typography.weight.bold,
    color: colors.semantic.text,
    fontVariant: ['tabular-nums'],
  },
  detailCard: {
    backgroundColor: colors.semantic.surfaceMuted,
    borderRadius: radii.md,
    padding: spacing[3],
    gap: spacing[2],
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing[3],
  },
  detailLabel: {
    fontSize: typography.size.sm,
    color: colors.semantic.textMuted,
  },
  detailValue: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
    color: colors.semantic.text,
    flexShrink: 1,
    textAlign: 'right',
  },
});
