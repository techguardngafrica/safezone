import { unwrapPage } from '@safezone/api-client';
import { colors, typography } from '@safezone/design-tokens';
import { formatKobo, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  Card,
  EmptyState,
  ErrorState,
  ScreenHeader,
  ScrollScreen,
  Segmented,
  Skeleton,
} from '@safezone/mobile-ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '../../src/components/icon';
import { SOS_CLEARANCE } from '../../src/components/sos-button';
import { BankTransferCard } from '../../src/features/bank-transfer';
import { type Invoice, isOpenInvoice } from '../../src/features/bills';
import { InvoiceCard } from '../../src/features/invoice-card';
import { usePayChoice } from '../../src/features/pay-choice';
import { useStartPayment } from '../../src/features/use-start-payment';
import { errorText } from '../../src/lib/errors';
import { useResident } from '../../src/lib/resident';
import { api } from '../../src/lib/session';
import { usePullRefresh } from '../../src/lib/use-pull-refresh';

/** Pay (UI_GUIDELINES §8.1): what is owed, the bills, pay online or by transfer. No wallet. */
export default function PayScreen() {
  const router = useRouter();
  const { estateId, can, hasFeature } = useResident();
  const [view, setView] = useState<'open' | 'paid'>('open');
  const start = useStartPayment();
  const payChoice = usePayChoice();
  const invoices = useInfiniteQuery({
    queryKey: ['estate', estateId, 'invoices', 'mine'],
    queryFn: ({ pageParam }) =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/invoices', {
          params: { path: { estateId }, query: { limit: 50, cursor: pageParam } },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const pull = usePullRefresh(invoices.refetch);
  const all: Invoice[] = invoices.data?.pages.flatMap((page) => page.items) ?? [];
  const open = all.filter(isOpenInvoice);
  const shown = view === 'open' ? open : all.filter((invoice) => !isOpenInvoice(invoice));
  const outstanding = open.reduce((total, invoice) => total + invoice.balance, 0);
  const canPay = can('payment.make') && hasFeature('payments');

  return (
    <ScrollScreen bottomInset={SOS_CLEARANCE} {...pull}>
      <ScreenHeader title={t('res.bills.title')} />
      <Card>
        <Text style={{ color: colors.semantic.textMuted, fontSize: typography.size.sm }}>
          {t('res.bills.outstanding')}
        </Text>
        {invoices.isPending ? (
          <Skeleton height={36} width="50%" />
        ) : (
          <Text
            accessibilityRole="header"
            style={{
              fontSize: 32,
              fontWeight: '700',
              color: colors.semantic.text,
              fontVariant: ['tabular-nums'],
            }}
          >
            {formatKobo(outstanding)}
          </Text>
        )}
        {canPay && outstanding > 0 ? (
          <>
            {payChoice.element}
            <ActionButton
              label={t('res.bills.payAll', { amount: formatKobo(outstanding) })}
              busy={start.isPending}
              onPress={() => start.mutate({ choice: payChoice.choice })}
            />
          </>
        ) : null}
        {invoices.data && outstanding === 0 ? (
          <Text style={{ color: colors.status.success }}>{t('res.bills.allPaid')}</Text>
        ) : null}
      </Card>
      {start.isError ? <Banner tone="danger">{errorText(start.error)}</Banner> : null}

      <View style={styles.quickRow}>
        {hasFeature('payments') ? (
          <QuickPill
            icon="receipt-outline"
            label={t('res.bills.receipts')}
            onPress={() => router.push('/bills/receipts')}
          />
        ) : null}
        {hasFeature('billing') ? (
          <QuickPill
            icon="document-text-outline"
            label={t('res.bills.statement')}
            onPress={() => router.push('/bills/statement')}
          />
        ) : null}
        {hasFeature('billing') ? (
          <QuickPill
            icon="flash-outline"
            label={t('res.bills.utilities')}
            onPress={() => router.push('/utilities')}
          />
        ) : null}
      </View>

      <Segmented
        label={t('res.bills.title')}
        value={view}
        onChange={setView}
        options={[
          { key: 'open', label: t('res.bills.toPay', { count: open.length }) },
          { key: 'paid', label: t('res.bills.history') },
        ]}
      />
      {invoices.isError ? (
        <ErrorState message={errorText(invoices.error)} onRetry={() => void invoices.refetch()} />
      ) : null}
      {invoices.data && shown.length === 0 ? (
        <EmptyState
          icon={<Icon name="receipt-outline" size={28} color={colors.brand.primary} />}
          title={view === 'open' ? t('res.bills.emptyOpen') : t('res.bills.emptyHistory')}
        />
      ) : null}
      {shown.map((invoice) => (
        <InvoiceCard
          key={invoice.id}
          invoice={invoice}
          onPress={() => router.push(`/bills/${invoice.id}`)}
        />
      ))}
      {invoices.hasNextPage ? (
        <ActionButton
          label={t('ui.loadMore')}
          variant="outline"
          busy={invoices.isFetchingNextPage}
          onPress={() => void invoices.fetchNextPage()}
        />
      ) : null}
      {canPay ? <BankTransferCard /> : null}
    </ScrollScreen>
  );
}

function QuickPill({
  icon,
  label,
  onPress,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.quickPill, pressed && { opacity: 0.75 }]}
    >
      <Icon name={icon} size={18} color={colors.brand.primary} />
      <Text style={styles.quickPillText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  quickRow: {
    flexDirection: 'row',
    gap: 8,
  },
  quickPill: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.semantic.borderSubtle,
    backgroundColor: colors.semantic.surface,
    paddingHorizontal: 10,
  },
  quickPillText: {
    fontSize: typography.size.sm,
    fontWeight: '600',
    color: colors.semantic.text,
  },
});
