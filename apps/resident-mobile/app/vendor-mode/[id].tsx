import { unwrap } from '@safezone/api-client';
import { formatDateTime, type MessageKey, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  Card,
  ConfirmModal,
  ErrorState,
  ScreenHeader,
  ScrollScreen,
  SectionHeader,
  Skeleton,
  StatusPill,
  TextField,
} from '@safezone/mobile-ui';
import { permissionsForRoles } from '@safezone/permissions';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Icon } from '../../src/components/icon';
import {
  nairaText,
  nairaToKobo,
  ORDER_TONE,
  vendorActions,
  watInstant,
} from '../../src/features/marketplace';
import { Body, marketStyles, MessageLine, Muted, Row } from '../../src/features/market-text';
import { errorText } from '../../src/lib/errors';
import { api } from '../../src/lib/session';

type Simple = 'accept' | 'start' | 'complete';

/** One order in Vendor mode: the same actions as the Vendor Portal, limited by the member's role. */
export default function VendorOrderScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id, vendorId } = useLocalSearchParams<{ id: string; vendorId: string }>();
  const path = { vendorId, id };
  const key = ['vendor', vendorId, 'orders', id];
  const [quote, setQuote] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [modal, setModal] = useState<'decline' | 'cancel' | null>(null);
  const [reason, setReason] = useState('');

  const mine = useQuery({
    queryKey: ['me', 'vendors'],
    queryFn: () => unwrap(api.GET('/v1/me/vendors')),
  });
  const role = mine.data?.find((v) => v.id === vendorId)?.role;
  const manage = role ? permissionsForRoles([role]).has('vendor.order.manage') : false;
  const order = useQuery({
    queryKey: key,
    queryFn: () => unwrap(api.GET('/v1/vendors/{vendorId}/orders/{id}', { params: { path } })),
  });
  const messages = useQuery({
    queryKey: [...key, 'messages'],
    queryFn: () =>
      unwrap(api.GET('/v1/vendors/{vendorId}/orders/{id}/messages', { params: { path } })),
  });
  const done = (data: unknown) => {
    queryClient.setQueryData(key, data);
    void queryClient.invalidateQueries({ queryKey: ['vendor', vendorId, 'orders'], exact: true });
  };
  const simple = useMutation({
    mutationFn: (action: Simple) =>
      action === 'accept'
        ? unwrap(api.POST('/v1/vendors/{vendorId}/orders/{id}/accept', { params: { path } }))
        : action === 'start'
          ? unwrap(api.POST('/v1/vendors/{vendorId}/orders/{id}/start', { params: { path } }))
          : unwrap(api.POST('/v1/vendors/{vendorId}/orders/{id}/complete', { params: { path } })),
    onSuccess: done,
  });
  const sendQuote = useMutation({
    mutationFn: (amountKobo: number) =>
      unwrap(
        api.POST('/v1/vendors/{vendorId}/orders/{id}/quote', {
          params: { path },
          body: { amountKobo },
        }),
      ),
    onSuccess: (data) => {
      setQuote('');
      done(data);
    },
  });
  const schedule = useMutation({
    mutationFn: (scheduledAt: string) =>
      unwrap(
        api.POST('/v1/vendors/{vendorId}/orders/{id}/schedule', {
          params: { path },
          body: { scheduledAt },
        }),
      ),
    onSuccess: done,
  });
  const close = useMutation({
    mutationFn: (kind: 'decline' | 'cancel') =>
      kind === 'decline'
        ? unwrap(
            api.POST('/v1/vendors/{vendorId}/orders/{id}/decline', {
              params: { path },
              body: { reason: reason.trim() },
            }),
          )
        : unwrap(
            api.POST('/v1/vendors/{vendorId}/orders/{id}/cancel', {
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
  const send = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/vendors/{vendorId}/orders/{id}/messages', {
          params: { path },
          body: { body: body.trim() },
        }),
      ),
    onSuccess: (data) => {
      setBody('');
      queryClient.setQueryData([...key, 'messages'], data);
    },
  });

  const data = order.data;
  const actions = data ? vendorActions(data, manage) : null;
  const error = simple.error ?? sendQuote.error ?? schedule.error;
  const quoteKobo = nairaToKobo(quote);

  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']}>
      <ScreenHeader
        title={data?.listingTitle ?? t('vendor.orders.detail')}
        onBack={() => router.back()}
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
              <StatusPill
                tone={ORDER_TONE[data.status]}
                label={t(`vendor.orderStatus.${data.status}` as MessageKey)}
              />
            </Row>
            {data.vendorAmountKobo !== null && data.commissionKobo !== null ? (
              <Muted>
                {t('res.vendorMode.youReceive', {
                  amount: nairaText(data.vendorAmountKobo),
                  commission: nairaText(data.commissionKobo),
                })}
              </Muted>
            ) : null}
            <Muted>
              {data.paid
                ? t('vendor.orders.paid')
                : data.status === 'accepted'
                  ? t('res.vendorMode.awaitingPayment')
                  : t('vendor.orders.notPayable')}
            </Muted>
            {data.scheduledAt ? (
              <Muted>
                {t('res.market.orders.scheduled', { when: formatDateTime(data.scheduledAt) })}
              </Muted>
            ) : null}
            <Body>{data.details}</Body>
          </Card>

          {actions.accept ? (
            <ActionButton
              label={t('res.vendorMode.accept')}
              busy={simple.isPending}
              onPress={() => simple.mutate('accept')}
            />
          ) : null}
          {actions.quote ? (
            <Card>
              <TextField
                label={t('res.vendorMode.quoteAmount')}
                value={quote}
                onChangeText={setQuote}
                keyboardType="number-pad"
                maxLength={14}
              />
              <ActionButton
                label={t('res.vendorMode.sendQuote')}
                variant="outline"
                busy={sendQuote.isPending}
                disabled={!quoteKobo}
                onPress={() => quoteKobo && sendQuote.mutate(quoteKobo)}
              />
            </Card>
          ) : null}
          {actions.schedule ? (
            <Card>
              <TextField
                label={t('res.vendorMode.scheduleDate')}
                value={date}
                onChangeText={setDate}
                placeholder="2026-12-01"
                maxLength={10}
              />
              <TextField
                label={t('res.vendorMode.scheduleTime')}
                value={time}
                onChangeText={setTime}
                placeholder="14:30"
                error={scheduleError}
                maxLength={5}
              />
              <ActionButton
                label={t('res.vendorMode.schedule')}
                variant="outline"
                busy={schedule.isPending}
                onPress={() => {
                  const at = watInstant(date, time);
                  if (!at) return setScheduleError(t('res.vendorMode.scheduleInvalid'));
                  setScheduleError(null);
                  schedule.mutate(at);
                }}
              />
            </Card>
          ) : null}
          {actions.start ? (
            <ActionButton
              label={t('res.vendorMode.start')}
              busy={simple.isPending}
              onPress={() => simple.mutate('start')}
            />
          ) : null}
          {actions.complete ? (
            <ActionButton
              label={t('res.vendorMode.complete')}
              busy={simple.isPending}
              onPress={() => simple.mutate('complete')}
            />
          ) : null}
          {error ? <Banner tone="danger">{errorText(error)}</Banner> : null}

          <SectionHeader title={t('vendor.orders.messages')} />
          <View style={{ gap: 8 }}>
            {messages.data?.map((m) => (
              <MessageLine
                key={m.id}
                mine={m.authorKind === 'vendor'}
                author={
                  m.authorKind === 'vendor'
                    ? t('res.market.orders.you')
                    : t('res.vendorMode.resident')
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
          <ActionButton
            label={t('res.market.orders.send')}
            variant="outline"
            busy={send.isPending}
            disabled={!body.trim()}
            onPress={() => send.mutate()}
          />
          {send.isError ? <Banner tone="danger">{errorText(send.error)}</Banner> : null}

          <SectionHeader title={t('vendor.orders.history')} />
          {data.events.map((event, index) => (
            <Muted key={`${event.createdAt}-${index}`}>
              {formatDateTime(event.createdAt)} ·{' '}
              {t(`vendor.orderStatus.${event.toStatus}` as MessageKey)}
              {event.note ? ` · ${event.note}` : ''}
            </Muted>
          ))}

          {actions.decline ? (
            <ActionButton
              label={t('res.vendorMode.decline')}
              variant="outline"
              onPress={() => setModal('decline')}
            />
          ) : null}
          {actions.cancel ? (
            <ActionButton
              label={t('res.vendorMode.cancel')}
              variant="text"
              onPress={() => setModal('cancel')}
            />
          ) : null}
        </>
      ) : null}
      <ConfirmModal
        visible={modal !== null}
        title={
          modal === 'decline' ? t('res.vendorMode.declineTitle') : t('res.vendorMode.cancelTitle')
        }
        body={
          modal === 'decline' ? t('res.vendorMode.declineBody') : t('res.vendorMode.cancelBody')
        }
        confirmLabel={
          modal === 'decline' ? t('res.vendorMode.decline') : t('res.vendorMode.cancel')
        }
        destructive
        busy={close.isPending}
        error={close.isError ? errorText(close.error) : null}
        reason={{
          label: t('res.vendorMode.reason'),
          value: reason,
          onChange: setReason,
          required: true,
        }}
        onConfirm={() => modal && close.mutate(modal)}
        onCancel={() => {
          setModal(null);
          setReason('');
        }}
      />
    </ScrollScreen>
  );
}
