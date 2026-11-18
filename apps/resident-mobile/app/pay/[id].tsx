import { unwrap } from '@safezone/api-client';
import { colors, typography } from '@safezone/design-tokens';
import { formatDateTime, formatKobo, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  Card,
  EmptyState,
  ErrorState,
  ScrollScreen,
  Skeleton,
} from '@safezone/mobile-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { ActivityIndicator, AppState, Linking, Text, View } from 'react-native';
import { Icon } from '../../src/components/icon';
import type { PaymentIntent } from '../../src/features/bills';
import { errorText } from '../../src/lib/errors';
import { useResident } from '../../src/lib/resident';
import { api } from '../../src/lib/session';

const CHECK_EVERY_MS = 4_000;
const isPending = (intent?: PaymentIntent) =>
  intent?.status === 'pending' || intent?.status === 'created';

/**
 * Payment status (UI_GUIDELINES §9.3): "Confirming your payment" with the reference until the API has
 * verified the payment with the provider; only then a receipt. Never a success based on the redirect.
 * No ads on this screen.
 */
export default function PaymentScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { estateId } = useResident();

  const intent = useQuery({
    queryKey: ['estate', estateId, 'payment-intent', id],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/payment-intents/{id}', {
          params: { path: { estateId, id } },
        }),
      ),
  });
  const verify = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/payment-intents/{id}/verify', {
          params: { path: { estateId, id } },
        }),
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(['estate', estateId, 'payment-intent', id], data);
      if (!isPending(data)) {
        void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'invoices'] });
        void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'invoice'] });
      }
    },
  });

  const pending = isPending(intent.data);
  const check = useCallback(() => {
    if (!verify.isPending) verify.mutate();
  }, [verify]);

  // Check when the resident comes back from checkout, then every few seconds while still pending.
  useEffect(() => {
    if (!pending) return undefined;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    const timer = setInterval(check, CHECK_EVERY_MS);
    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, [pending, check]);

  const data = intent.data;
  const done = () => router.replace('/pay');

  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']}>
      {intent.isPending ? <Skeleton height={220} /> : null}
      {intent.isError ? (
        <ErrorState message={errorText(intent.error)} onRetry={() => void intent.refetch()} />
      ) : null}
      {data && pending ? (
        <>
          <View style={{ alignItems: 'center', gap: 12, paddingVertical: 24 }}>
            <ActivityIndicator size="large" color={colors.brand.primary} />
            <Text
              accessibilityRole="header"
              accessibilityLiveRegion="polite"
              style={{
                fontSize: typography.size.xl,
                fontWeight: '700',
                color: colors.semantic.text,
                textAlign: 'center',
              }}
            >
              {t('res.pay.confirming')}
            </Text>
            <Text style={{ color: colors.semantic.textMuted, textAlign: 'center' }}>
              {t('res.pay.confirmingBody')}
            </Text>
          </View>
          <Card>
            <Row label={t('res.pay.amount')} value={formatKobo(data.amount)} />
            <Row label={t('res.pay.reference')} value={data.reference} />
          </Card>
          {data.authorizationUrl ? (
            <ActionButton
              label={t('res.pay.openCheckout')}
              variant="outline"
              onPress={() => void Linking.openURL(data.authorizationUrl ?? '')}
            />
          ) : null}
          <ActionButton
            label={t('res.pay.checkNow')}
            variant="text"
            busy={verify.isPending}
            onPress={check}
          />
          {verify.isError ? <Banner tone="danger">{errorText(verify.error)}</Banner> : null}
        </>
      ) : null}
      {data && data.status === 'succeeded' ? (
        <>
          <EmptyState
            icon={<Icon name="checkmark-circle" size={36} color={colors.status.success} />}
            title={t('res.pay.success')}
            body={t('res.pay.successBody')}
          />
          <Card>
            <Row label={t('res.pay.amount')} value={formatKobo(data.amount)} />
            <Row label={t('res.pay.reference')} value={data.reference} />
            {data.paidAt ? (
              <Row label={t('res.pay.paidAt')} value={formatDateTime(data.paidAt)} />
            ) : null}
            <Row label={t('res.pay.bills')} value={String(data.invoiceIds.length)} />
          </Card>
          <ActionButton label={t('res.sos.done')} onPress={done} />
        </>
      ) : null}
      {data && !pending && data.status !== 'succeeded' ? (
        <>
          <EmptyState
            icon={<Icon name="alert-circle" size={36} color={colors.status.danger} />}
            title={t('res.pay.notPaid')}
            body={data.status === 'expired' ? t('res.pay.expiredBody') : t('res.pay.failedBody')}
          />
          <Card>
            <Row label={t('res.pay.reference')} value={data.reference} />
          </Card>
          <ActionButton label={t('res.pay.backToBills')} onPress={done} />
        </>
      ) : null}
    </ScrollScreen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
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
      <Text style={{ color: colors.semantic.textMuted, fontSize: typography.size.sm }}>
        {label}
      </Text>
      <Text
        selectable
        style={{
          color: colors.semantic.text,
          fontSize: typography.size.sm,
          fontWeight: '500',
          flexShrink: 1,
          textAlign: 'right',
        }}
      >
        {value}
      </Text>
    </View>
  );
}
