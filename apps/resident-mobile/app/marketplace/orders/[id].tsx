import { unwrap } from '@safezone/api-client';
import { formatDateTime, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  Card,
  ChipGroup,
  ConfirmModal,
  ErrorState,
  ScreenHeader,
  ScrollScreen,
  SectionHeader,
  Skeleton,
  StatusPill,
  TextField,
} from '@safezone/mobile-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { Icon } from '../../../src/components/icon';
import {
  nairaText,
  ORDER_TONE,
  orderStatusLabel,
  rememberOrder,
  residentActions,
} from '../../../src/features/marketplace';
import { Body, marketStyles, MessageLine, Muted, Row } from '../../../src/features/market-text';
import { payFields, usePayChoice } from '../../../src/features/pay-choice';
import { errorText } from '../../../src/lib/errors';
import { useResident } from '../../../src/lib/resident';
import { api } from '../../../src/lib/session';

const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

function Messages({ orderId }: { orderId: string }) {
  const { estateId } = useResident();
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const key = ['estate', estateId, 'marketplace', 'orders', orderId, 'messages'];
  const path = { estateId, id: orderId };
  const messages = useQuery({
    queryKey: key,
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/marketplace/orders/{id}/messages', { params: { path } }),
      ),
  });
  const send = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/marketplace/orders/{id}/messages', {
          params: { path },
          body: { body: body.trim() },
        }),
      ),
    onSuccess: (data) => {
      setBody('');
      queryClient.setQueryData(key, data);
    },
  });
  return (
    <>
      <SectionHeader title={t('res.market.orders.messages')} />
      {messages.data?.length === 0 ? <Muted>{t('res.market.orders.noMessages')}</Muted> : null}
      <View style={{ gap: 8 }}>
        {messages.data?.map((m) => (
          <MessageLine
            key={m.id}
            mine={m.authorKind === 'resident'}
            author={
              m.authorKind === 'resident'
                ? t('res.market.orders.you')
                : t('res.market.orders.vendor')
            }
            when={formatDateTime(m.createdAt)}
            body={m.body}
          />
        ))}
      </View>
      <TextField
        label={t('res.market.orders.message')}
        value={body}
        onChangeText={setBody}
        multiline
        maxLength={2000}
      />
      {send.isError ? <Banner tone="danger">{errorText(send.error)}</Banner> : null}
      <ActionButton
        label={t('res.market.orders.send')}
        variant="outline"
        busy={send.isPending}
        disabled={!body.trim()}
        onPress={() => send.mutate()}
      />
    </>
  );
}

/**
 * One marketplace order. "Paid" shows only after the API verified the payment with the provider.
 * No ads on this screen (payment and private messages, AGENTS.md §6.2).
 */
export default function OrderScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { estateId } = useResident();
  const { id } = useLocalSearchParams<{ id: string }>();
  const key = ['estate', estateId, 'marketplace', 'orders', id];
  const path = { estateId, id };
  const [modal, setModal] = useState<'cancel' | 'dispute' | null>(null);
  const payChoice = usePayChoice();
  const [reason, setReason] = useState('');
  const [rating, setRating] = useState<'1' | '2' | '3' | '4' | '5' | null>(null);
  const [comment, setComment] = useState('');

  const order = useQuery({
    queryKey: key,
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/marketplace/orders/{id}', { params: { path } })),
  });
  // Back from checkout: ask the provider through the API (the webhook may be slower).
  const verify = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/marketplace/orders/{id}/verify-payment', {
          params: { path },
        }),
      ),
    onSuccess: (data) => queryClient.setQueryData(key, data),
  });
  useFocusEffect(
    useCallback(() => {
      const current = queryClient.getQueryData<{ status: string; paid: boolean }>(key);
      if (current && current.status === 'accepted' && !current.paid) verify.mutate();
      else void order.refetch();
    }, [id]),
  );
  const done = (data: unknown) => {
    queryClient.setQueryData(key, data);
    void queryClient.invalidateQueries({
      queryKey: ['estate', estateId, 'marketplace', 'orders'],
      exact: true,
    });
  };
  const pay = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/marketplace/orders/{id}/pay', {
          params: { path },
          body: {
            ...(inExpoGo ? {} : { callbackUrl: 'safezone://marketplace/return' }),
            ...payFields(payChoice.choice),
          },
        }),
      ),
    onSuccess: (checkout) => {
      rememberOrder(id);
      // A saved card is charged and verified by the API at once; checkout opens the provider's page.
      if (checkout.authorizationUrl) void Linking.openURL(checkout.authorizationUrl);
      else void order.refetch();
    },
  });
  const acceptQuote = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/marketplace/orders/{id}/accept-quote', {
          params: { path },
        }),
      ),
    onSuccess: done,
  });
  const cancel = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/marketplace/orders/{id}/cancel', {
          params: { path },
          body: { reason: reason.trim() },
        }),
      ),
    onSuccess: (data) => {
      setModal(null);
      setReason('');
      done(data);
    },
  });
  const dispute = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/marketplace/orders/{id}/dispute', {
          params: { path },
          body: { reason: reason.trim(), evidenceFileIds: [] },
        }),
      ),
    onSuccess: (data) => {
      setModal(null);
      setReason('');
      done(data);
    },
  });
  const review = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/marketplace/orders/{id}/review', {
          params: { path },
          body: { rating: Number(rating), ...(comment.trim() ? { comment: comment.trim() } : {}) },
        }),
      ),
    onSuccess: done,
  });

  const data = order.data;
  const actions = data ? residentActions(data) : null;
  const actionError = pay.error ?? acceptQuote.error ?? review.error;

  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']}>
      <ScreenHeader
        title={data?.listingTitle ?? t('res.market.orders.detail')}
        subtitle={data?.vendorName}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/marketplace/orders'))}
        backIcon={<Icon name="arrow-back" />}
      />
      {order.isPending ? <Skeleton height={160} /> : null}
      {order.isError ? (
        <ErrorState message={errorText(order.error)} onRetry={() => void order.refetch()} />
      ) : null}
      {data && actions ? (
        <>
          <Card>
            <Row>
              <Text style={marketStyles.big}>
                {data.amountKobo !== null
                  ? nairaText(data.amountKobo)
                  : data.quoteKobo !== null
                    ? nairaText(data.quoteKobo)
                    : '-'}
              </Text>
              <StatusPill tone={ORDER_TONE[data.status]} label={orderStatusLabel(data.status)} />
            </Row>
            <Muted>
              {data.paid ? t('res.market.orders.paid') : t('res.market.orders.notPaid')}
            </Muted>
            {data.scheduledAt ? (
              <Muted>
                {t('res.market.orders.scheduled', { when: formatDateTime(data.scheduledAt) })}
              </Muted>
            ) : null}
            <Body>{data.details}</Body>
          </Card>
          {data.status === 'requested' ? (
            <Banner tone="info">{t('res.market.orders.awaitingVendor')}</Banner>
          ) : null}
          {verify.isPending ? <Banner tone="info">{t('res.market.orders.paying')}</Banner> : null}
          {data.paid && (data.status === 'accepted' || data.status === 'scheduled') ? (
            <Banner tone="success">{t('res.market.orders.paidNote')}</Banner>
          ) : null}
          {actions.acceptQuote && data.quoteKobo !== null ? (
            <ActionButton
              label={t('res.market.orders.acceptQuote', { amount: nairaText(data.quoteKobo) })}
              busy={acceptQuote.isPending}
              onPress={() => acceptQuote.mutate()}
            />
          ) : null}
          {actions.pay && data.amountKobo !== null ? (
            <>
              {payChoice.element}
              <ActionButton
                label={t('res.market.orders.payNow', { amount: nairaText(data.amountKobo) })}
                icon={<Icon name="card-outline" color="#FFFFFF" size={20} />}
                busy={pay.isPending}
                onPress={() => pay.mutate()}
              />
            </>
          ) : null}
          {actionError ? <Banner tone="danger">{errorText(actionError)}</Banner> : null}

          {actions.review ? (
            <Card>
              <ChipGroup
                label={t('res.market.orders.review')}
                value={rating}
                onChange={setRating}
                options={(['1', '2', '3', '4', '5'] as const).map((key) => ({ key, label: key }))}
              />
              <TextField
                label={t('res.market.orders.reviewComment')}
                value={comment}
                onChangeText={setComment}
                multiline
                maxLength={2000}
              />
              <ActionButton
                label={t('res.market.orders.submitReview')}
                disabled={!rating}
                busy={review.isPending}
                onPress={() => review.mutate()}
              />
            </Card>
          ) : null}
          {data.review ? (
            <Card>
              <Text style={marketStyles.label}>{t('res.market.orders.yourReview')}</Text>
              <Muted>{t('res.market.orders.stars', { rating: data.review.rating })}</Muted>
              {data.review.comment ? <Body>{data.review.comment}</Body> : null}
              {data.review.vendorResponse ? <Muted>{data.review.vendorResponse}</Muted> : null}
            </Card>
          ) : null}

          <Messages orderId={data.id} />

          <SectionHeader title={t('res.market.orders.history')} />
          {data.events.map((event, index) => (
            <Muted key={`${event.createdAt}-${index}`}>
              {formatDateTime(event.createdAt)} · {orderStatusLabel(event.toStatus)}
              {event.note ? ` · ${event.note}` : ''}
            </Muted>
          ))}

          {actions.dispute ? (
            <ActionButton
              label={t('res.market.orders.dispute')}
              variant="outline"
              onPress={() => setModal('dispute')}
            />
          ) : null}
          {actions.cancel ? (
            <ActionButton
              label={t('res.market.orders.cancel')}
              variant="text"
              onPress={() => setModal('cancel')}
            />
          ) : null}
        </>
      ) : null}
      <ConfirmModal
        visible={modal !== null}
        title={
          modal === 'dispute'
            ? t('res.market.orders.disputeTitle')
            : t('res.market.orders.cancelTitle')
        }
        body={
          modal === 'dispute'
            ? t('res.market.orders.disputeBody')
            : t('res.market.orders.cancelBody')
        }
        confirmLabel={
          modal === 'dispute' ? t('res.market.orders.dispute') : t('res.market.orders.cancel')
        }
        destructive={modal === 'cancel'}
        busy={cancel.isPending || dispute.isPending}
        error={
          modal === 'dispute'
            ? dispute.isError
              ? errorText(dispute.error)
              : null
            : cancel.isError
              ? errorText(cancel.error)
              : null
        }
        reason={{
          label:
            modal === 'dispute'
              ? t('res.market.orders.disputeReason')
              : t('res.market.orders.reason'),
          value: reason,
          onChange: setReason,
          required: true,
        }}
        onConfirm={() => (modal === 'dispute' ? dispute.mutate() : cancel.mutate())}
        onCancel={() => {
          setModal(null);
          setReason('');
        }}
      />
    </ScrollScreen>
  );
}
