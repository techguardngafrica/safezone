import { unwrap } from '@safezone/api-client';
import { colors, typography } from '@safezone/design-tokens';
import { formatDate, formatDateTime, formatKobo, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  Card,
  ErrorState,
  ScreenHeader,
  ScrollScreen,
  SectionHeader,
  Skeleton,
  StatusPill,
} from '@safezone/mobile-ui';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { Icon } from '../../src/components/icon';
import { invoiceState, isOpenInvoice } from '../../src/features/bills';
import { usePayChoice } from '../../src/features/pay-choice';
import { useStartPayment } from '../../src/features/use-start-payment';
import { errorText } from '../../src/lib/errors';
import { useResident } from '../../src/lib/resident';
import { api } from '../../src/lib/session';
import { usePullRefresh } from '../../src/lib/use-pull-refresh';

export default function BillScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { estateId, can, hasFeature } = useResident();
  const start = useStartPayment();
  const payChoice = usePayChoice();
  const invoice = useQuery({
    queryKey: ['estate', estateId, 'invoice', id],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/invoices/{id}', { params: { path: { estateId, id } } }),
      ),
  });
  const pull = usePullRefresh(invoice.refetch);
  const data = invoice.data;
  const state = data ? invoiceState(data) : null;

  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']} {...pull}>
      <ScreenHeader
        title={data?.description ?? t('res.bills.title')}
        subtitle={data ? `${data.number}${data.unitCode ? ` · ${data.unitCode}` : ''}` : undefined}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/pay'))}
        backIcon={<Icon name="arrow-back" />}
      />
      {invoice.isPending ? <Skeleton height={200} /> : null}
      {invoice.isError ? (
        <ErrorState message={errorText(invoice.error)} onRetry={() => void invoice.refetch()} />
      ) : null}
      {data && state ? (
        <>
          <StatusPill tone={state.tone} label={state.label} />
          <Card>
            {data.lines.map((line) => (
              <Row
                key={line.id}
                label={
                  line.quantity > 1 ? `${line.description} x${line.quantity}` : line.description
                }
                value={formatKobo(line.amount)}
              />
            ))}
            <View
              style={{
                height: 1,
                backgroundColor: colors.semantic.borderSubtle,
                marginVertical: 4,
              }}
            />
            <Row label={t('res.bills.total')} value={formatKobo(data.total)} strong />
            {data.amountPaid > 0 ? (
              <Row label={t('res.bills.paid')} value={`- ${formatKobo(data.amountPaid)}`} />
            ) : null}
            {data.amountCredited > 0 ? (
              <Row label={t('res.bills.credited')} value={`- ${formatKobo(data.amountCredited)}`} />
            ) : null}
            {data.amountWaived > 0 ? (
              <Row label={t('res.bills.waived')} value={`- ${formatKobo(data.amountWaived)}`} />
            ) : null}
            <Row label={t('res.bills.balance')} value={formatKobo(data.balance)} strong />
          </Card>
          <Text style={{ color: colors.semantic.textMuted, fontSize: typography.size.sm }}>
            {t('res.bills.issuedDue', {
              issued: formatDate(`${data.issueDate}T12:00:00Z`),
              due: formatDate(`${data.dueDate}T12:00:00Z`),
            })}
          </Text>
          {isOpenInvoice(data) &&
          data.balance > 0 &&
          can('payment.make') &&
          hasFeature('payments') ? (
            <>
              {payChoice.element}
              <ActionButton
                label={t('res.bills.payThis', { amount: formatKobo(data.balance) })}
                busy={start.isPending}
                onPress={() => start.mutate({ invoiceIds: [data.id], choice: payChoice.choice })}
              />
            </>
          ) : null}
          {start.isError ? <Banner tone="danger">{errorText(start.error)}</Banner> : null}
          {data.allocations.length > 0 ? (
            <>
              <SectionHeader title={t('res.bills.payments')} />
              <Card>
                {data.allocations.map((allocation) => (
                  <Row
                    key={allocation.id}
                    label={formatDateTime(allocation.createdAt)}
                    value={formatKobo(allocation.amount)}
                  />
                ))}
              </Card>
              {hasFeature('payments') ? (
                <ActionButton
                  label={t('res.bills.viewReceipts')}
                  variant="outline"
                  onPress={() => router.push('/bills/receipts')}
                />
              ) : null}
            </>
          ) : null}
          {data.creditNotes.length > 0 ? (
            <>
              <SectionHeader title={t('res.bills.credits')} />
              <Card>
                {data.creditNotes.map((note) => (
                  <Row key={note.id} label={note.reason} value={formatKobo(note.amount)} />
                ))}
              </Card>
            </>
          ) : null}
        </>
      ) : null}
    </ScrollScreen>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 12,
        minHeight: 32,
        alignItems: 'center',
      }}
    >
      <Text
        style={{
          color: strong ? colors.semantic.text : colors.semantic.textMuted,
          fontSize: typography.size.sm,
          fontWeight: strong ? '700' : '400',
          flexShrink: 1,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          color: colors.semantic.text,
          fontSize: strong ? typography.size.md : typography.size.sm,
          fontWeight: strong ? '700' : '500',
          fontVariant: ['tabular-nums'],
        }}
      >
        {value}
      </Text>
    </View>
  );
}
