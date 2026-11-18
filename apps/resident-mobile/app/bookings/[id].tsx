import { unwrap } from '@safezone/api-client';
import { colors, typography } from '@safezone/design-tokens';
import { formatDateTime, formatKobo, formatTime, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  Card,
  ConfirmModal,
  ErrorState,
  ScreenHeader,
  ScrollScreen,
  Skeleton,
  StatusPill,
} from '@safezone/mobile-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Icon } from '../../src/components/icon';
import { BOOKING_TONE, bookingStatusLabel } from '../../src/features/facilities';
import { useStartPayment } from '../../src/features/use-start-payment';
import { errorText } from '../../src/lib/errors';
import { useResident } from '../../src/lib/resident';
import { api } from '../../src/lib/session';
import { usePullRefresh } from '../../src/lib/use-pull-refresh';

/** A booking: when, status, pay to confirm a paid booking before the hold ends, or cancel. */
export default function BookingScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { estateId } = useResident();
  const start = useStartPayment();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const booking = useQuery({
    queryKey: ['estate', estateId, 'booking', id],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/bookings/{id}', { params: { path: { estateId, id } } }),
      ),
  });
  const pull = usePullRefresh(booking.refetch);
  const cancel = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/bookings/{id}/cancel', {
          params: { path: { estateId, id } },
          body: { reason: reason.trim() },
        }),
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(['estate', estateId, 'booking', id], data);
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'bookings'] });
      setCancelling(false);
    },
  });

  const data = booking.data;
  const holding = data?.status === 'pending_payment' && data.holdExpiresAt;
  useEffect(() => {
    if (!holding) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [holding]);
  const secondsLeft = data?.holdExpiresAt
    ? Math.max(0, Math.floor((new Date(data.holdExpiresAt).getTime() - now) / 1000))
    : 0;
  const cancellable = data
    ? ['pending_approval', 'pending_payment', 'confirmed'].includes(data.status)
    : false;

  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']} {...pull}>
      <ScreenHeader
        title={data?.facilityName ?? t('res.booking.mine')}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/bookings'))}
        backIcon={<Icon name="arrow-back" />}
      />
      {booking.isPending ? <Skeleton height={160} /> : null}
      {booking.isError ? (
        <ErrorState message={errorText(booking.error)} onRetry={() => void booking.refetch()} />
      ) : null}
      {data ? (
        <>
          <StatusPill tone={BOOKING_TONE[data.status]} label={bookingStatusLabel(data.status)} />
          {data.status === 'pending_approval' ? (
            <Banner tone="info">{t('res.booking.awaitingApproval')}</Banner>
          ) : null}
          {data.status === 'rejected' && data.rejectionReason ? (
            <Banner tone="danger">
              {t('res.issue.rejectedBecause', { reason: data.rejectionReason })}
            </Banner>
          ) : null}
          <Card>
            <Row label={t('res.booking.starts')} value={formatDateTime(data.startsAt)} />
            <Row label={t('res.booking.ends')} value={formatTime(data.endsAt).slice(0, 5)} />
            {data.guests > 0 ? (
              <Row label={t('res.booking.guests')} value={String(data.guests)} />
            ) : null}
            {data.purpose ? <Row label={t('res.booking.purpose')} value={data.purpose} /> : null}
            <Row
              label={t('res.booking.price')}
              value={data.price > 0 ? formatKobo(data.price) : t('res.facility.free')}
            />
            {data.refundAmount > 0 ? (
              <Row label={t('res.booking.refund')} value={formatKobo(data.refundAmount)} />
            ) : null}
          </Card>
          {data.status === 'pending_payment' && data.invoiceId ? (
            <Card>
              <Text
                accessibilityLiveRegion="polite"
                style={{
                  color: colors.status.warning,
                  fontWeight: '700',
                  fontSize: typography.size.md,
                }}
              >
                {secondsLeft > 0
                  ? t('res.booking.holdLeft', {
                      minutes: Math.floor(secondsLeft / 60),
                      seconds: String(secondsLeft % 60).padStart(2, '0'),
                    })
                  : t('res.booking.holdOver')}
              </Text>
              <Text style={{ color: colors.semantic.textMuted, fontSize: typography.size.sm }}>
                {t('res.booking.payToConfirm')}
              </Text>
              <ActionButton
                label={t('res.bills.payThis', { amount: formatKobo(data.price) })}
                busy={start.isPending}
                disabled={secondsLeft === 0}
                onPress={() => start.mutate([data.invoiceId ?? ''])}
              />
              {start.isError ? (
                <Text style={{ color: colors.status.danger }}>{errorText(start.error)}</Text>
              ) : null}
            </Card>
          ) : null}
          {cancellable ? (
            <ActionButton
              label={t('res.booking.cancel')}
              variant="text"
              onPress={() => setCancelling(true)}
            />
          ) : null}
          <ConfirmModal
            visible={cancelling}
            title={t('res.booking.cancelTitle')}
            body={
              data.price > 0 && data.status === 'confirmed'
                ? t('res.booking.cancelPaidBody')
                : t('res.booking.cancelBody')
            }
            confirmLabel={t('res.booking.cancel')}
            cancelLabel={t('res.booking.keep')}
            destructive
            busy={cancel.isPending}
            error={cancel.isError ? errorText(cancel.error) : null}
            reason={{
              label: t('res.booking.cancelReason'),
              value: reason,
              onChange: setReason,
              required: true,
            }}
            onConfirm={() => cancel.mutate()}
            onCancel={() => setCancelling(false)}
          />
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
