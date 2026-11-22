'use client';

import { type ApiData, type ApiRow, unwrap, unwrapPage } from '@safezone/api-client';
import { formatDateTime, formatKobo, type MessageKey, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  type Column,
  ConfirmDialog,
  DataTable,
  DetailList,
  Drawer,
  ErrorState,
  FormError,
  InputField,
  PageHeader,
  SelectField,
  Skeleton,
  StatusPill,
  Tabs,
  TextAreaField,
  type Tone,
} from '@safezone/web-ui';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorText } from '../../lib/errors';
import { api } from '../../lib/session';
import { nairaToKobo } from './money';
import { useVendor } from './vendor-context';

type Order = ApiRow<'/v1/vendors/{vendorId}/orders', 'get'>;
type OrderDetail = ApiData<'/v1/vendors/{vendorId}/orders/{id}', 'get'>;
type Status = Order['status'];
type Filter = 'all' | 'requested' | 'accepted' | 'scheduled' | 'in_progress' | 'completed';
const FILTERS: Filter[] = ['all', 'requested', 'accepted', 'scheduled', 'in_progress', 'completed'];

export function orderTone(status: Status): Tone {
  if (status === 'requested' || status === 'quoted') return 'info';
  if (status === 'accepted' || status === 'scheduled' || status === 'in_progress') return 'warning';
  if (status === 'completed' || status === 'reviewed') return 'success';
  if (status === 'disputed') return 'danger';
  return 'neutral';
}

function statusLabel(status: Status): string {
  return t(`vendor.orderStatus.${status}` as MessageKey);
}

type Action = 'accept' | 'start' | 'complete';

function OrderActions({ order }: { order: OrderDetail }) {
  const { vendorId, can, vendor } = useVendor();
  const queryClient = useQueryClient();
  const [quote, setQuote] = useState('');
  const [when, setWhen] = useState('');
  const [confirm, setConfirm] = useState<'decline' | 'cancel' | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['vendor', vendorId, 'orders'] });
  };
  const path = { vendorId, id: order.id };
  const simple = useMutation({
    mutationFn: (action: Action) => {
      if (action === 'accept')
        return unwrap(api.POST('/v1/vendors/{vendorId}/orders/{id}/accept', { params: { path } }));
      if (action === 'start')
        return unwrap(api.POST('/v1/vendors/{vendorId}/orders/{id}/start', { params: { path } }));
      return unwrap(api.POST('/v1/vendors/{vendorId}/orders/{id}/complete', { params: { path } }));
    },
    onSuccess: refresh,
  });
  const sendQuote = useMutation({
    mutationFn: (amountKobo: number) =>
      unwrap(
        api.POST('/v1/vendors/{vendorId}/orders/{id}/quote', {
          params: { path },
          body: { amountKobo },
        }),
      ),
    onSuccess: () => {
      setQuote('');
      refresh();
    },
  });
  const schedule = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/vendors/{vendorId}/orders/{id}/schedule', {
          params: { path },
          // datetime-local is the viewer's local time; the API takes an ISO instant with offset.
          body: { scheduledAt: new Date(when).toISOString() },
        }),
      ),
    onSuccess: refresh,
  });
  const close = useMutation({
    mutationFn: ({ kind, reason }: { kind: 'decline' | 'cancel'; reason: string }) =>
      kind === 'decline'
        ? unwrap(
            api.POST('/v1/vendors/{vendorId}/orders/{id}/decline', {
              params: { path },
              body: { reason },
            }),
          )
        : unwrap(
            api.POST('/v1/vendors/{vendorId}/orders/{id}/cancel', {
              params: { path },
              body: { reason },
            }),
          ),
    onSuccess: () => {
      setConfirm(null);
      refresh();
    },
  });

  const manage = can('vendor.order.manage');
  const active = vendor.status === 'approved';
  const s = order.status;
  const error = simple.error ?? sendQuote.error ?? schedule.error;
  const quoteKobo = nairaToKobo(quote);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {manage && active && s === 'requested' && order.amountKobo !== null ? (
        <ActionButton busy={simple.isPending} onClick={() => simple.mutate('accept')}>
          {t('vendor.orders.accept')}
        </ActionButton>
      ) : null}
      {manage && active && (s === 'requested' || s === 'quoted') ? (
        <form
          className="sz-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (quoteKobo) sendQuote.mutate(quoteKobo);
          }}
        >
          <InputField
            label={t('vendor.orders.quoteAmount')}
            value={quote}
            onChange={setQuote}
            inputMode="decimal"
            maxLength={14}
          />
          <div>
            <ActionButton
              type="submit"
              variant="outline"
              busy={sendQuote.isPending}
              disabled={!quoteKobo}
            >
              {t('vendor.orders.sendQuote')}
            </ActionButton>
          </div>
        </form>
      ) : null}
      {manage && active && order.paid && (s === 'accepted' || s === 'scheduled') ? (
        <form
          className="sz-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (when) schedule.mutate();
          }}
        >
          <InputField
            label={t('vendor.orders.scheduleAt')}
            type="datetime-local"
            value={when}
            onChange={setWhen}
          />
          <div>
            <ActionButton
              type="submit"
              variant="outline"
              busy={schedule.isPending}
              disabled={!when}
            >
              {t('vendor.orders.schedule')}
            </ActionButton>
          </div>
        </form>
      ) : null}
      {order.paid && (s === 'accepted' || s === 'scheduled') ? (
        <ActionButton busy={simple.isPending} onClick={() => simple.mutate('start')}>
          {t('vendor.orders.start')}
        </ActionButton>
      ) : null}
      {s === 'in_progress' ? (
        <ActionButton busy={simple.isPending} onClick={() => simple.mutate('complete')}>
          {t('vendor.orders.complete')}
        </ActionButton>
      ) : null}
      {manage && (s === 'requested' || s === 'quoted') ? (
        <ActionButton variant="outline" onClick={() => setConfirm('decline')}>
          {t('vendor.orders.decline')}
        </ActionButton>
      ) : null}
      {manage && (s === 'accepted' || s === 'scheduled') ? (
        <ActionButton variant="danger" onClick={() => setConfirm('cancel')}>
          {t('vendor.orders.cancel')}
        </ActionButton>
      ) : null}
      <FormError message={error ? errorText(error) : null} />
      {confirm ? (
        <ConfirmDialog
          title={
            confirm === 'decline' ? t('vendor.orders.declineTitle') : t('vendor.orders.cancelTitle')
          }
          body={
            confirm === 'decline' ? t('vendor.orders.declineBody') : t('vendor.orders.cancelBody')
          }
          confirmLabel={
            confirm === 'decline' ? t('vendor.orders.decline') : t('vendor.orders.cancel')
          }
          destructive
          reason={{ label: t('vendor.orders.reason'), required: true }}
          busy={close.isPending}
          error={close.isError ? errorText(close.error) : null}
          onConfirm={(reason) => close.mutate({ kind: confirm, reason })}
          onClose={() => setConfirm(null)}
        />
      ) : null}
    </div>
  );
}

function Assign({ order }: { order: OrderDetail }) {
  const { vendorId } = useVendor();
  const queryClient = useQueryClient();
  const members = useQuery({
    queryKey: ['vendor', vendorId, 'members'],
    queryFn: () =>
      unwrap(api.GET('/v1/vendors/{vendorId}/members', { params: { path: { vendorId } } })),
  });
  const assign = useMutation({
    mutationFn: (memberId: string) =>
      unwrap(
        api.POST('/v1/vendors/{vendorId}/orders/{id}/assign', {
          params: { path: { vendorId, id: order.id } },
          body: { memberId },
        }),
      ),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['vendor', vendorId, 'orders'] }),
  });
  if (!members.data) return null;
  return (
    <>
      <SelectField
        label={t('vendor.orders.assigned')}
        value={order.assignedMemberId ?? ''}
        onChange={(memberId) => {
          if (memberId) assign.mutate(memberId);
        }}
        options={[
          { value: '', label: t('vendor.orders.unassigned') },
          ...members.data.map((m) => ({
            value: m.id,
            label: `${m.displayName ?? t('vendor.team.noName')} (${t(`vendor.role.${m.role}` as MessageKey)})`,
          })),
        ]}
      />
      <FormError message={assign.isError ? errorText(assign.error) : null} />
    </>
  );
}

function Messages({ orderId }: { orderId: string }) {
  const { vendorId } = useVendor();
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const key = ['vendor', vendorId, 'orders', orderId, 'messages'];
  const messages = useQuery({
    queryKey: key,
    queryFn: () =>
      unwrap(
        api.GET('/v1/vendors/{vendorId}/orders/{id}/messages', {
          params: { path: { vendorId, id: orderId } },
        }),
      ),
  });
  const send = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/vendors/{vendorId}/orders/{id}/messages', {
          params: { path: { vendorId, id: orderId } },
          body: { body: body.trim() },
        }),
      ),
    onSuccess: (data) => {
      setBody('');
      queryClient.setQueryData(key, data);
    },
  });
  return (
    <section>
      <h3>{t('vendor.orders.messages')}</h3>
      {messages.isPending ? <Skeleton height={60} /> : null}
      {messages.isError ? <FormError message={errorText(messages.error)} /> : null}
      {messages.data?.length === 0 ? (
        <p className="sz-muted">{t('vendor.orders.noMessages')}</p>
      ) : null}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
        {messages.data?.map((m) => (
          <li key={m.id} className="sz-card" style={{ padding: 12 }}>
            <strong>
              {m.authorKind === 'vendor'
                ? t('vendor.orders.fromYou')
                : t('vendor.orders.fromResident')}
            </strong>
            <span className="sz-muted"> · {formatDateTime(m.createdAt)}</span>
            <p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{m.body}</p>
          </li>
        ))}
      </ul>
      <form
        className="sz-form"
        style={{ marginTop: 8 }}
        onSubmit={(event) => {
          event.preventDefault();
          if (body.trim()) send.mutate();
        }}
      >
        <TextAreaField
          label={t('vendor.orders.messagePlaceholder')}
          value={body}
          onChange={setBody}
          rows={2}
          maxLength={2000}
        />
        <FormError message={send.isError ? errorText(send.error) : null} />
        <div>
          <ActionButton
            type="submit"
            variant="outline"
            size="sm"
            busy={send.isPending}
            disabled={!body.trim()}
          >
            {t('vendor.orders.send')}
          </ActionButton>
        </div>
      </form>
    </section>
  );
}

function ReviewBlock({ order }: { order: OrderDetail }) {
  const { vendorId, can } = useVendor();
  const queryClient = useQueryClient();
  const [response, setResponse] = useState('');
  const respond = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/vendors/{vendorId}/orders/{id}/review-response', {
          params: { path: { vendorId, id: order.id } },
          body: { response: response.trim() },
        }),
      ),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['vendor', vendorId, 'orders'] }),
  });
  if (!order.review) return null;
  return (
    <section>
      <h3>{t('vendor.orders.review')}</h3>
      <p style={{ margin: 0 }}>
        <strong>{t('vendor.orders.stars', { rating: order.review.rating })}</strong>
      </p>
      {order.review.comment ? (
        <p style={{ whiteSpace: 'pre-wrap' }}>{order.review.comment}</p>
      ) : null}
      {order.review.vendorResponse ? (
        <p className="sz-muted" style={{ whiteSpace: 'pre-wrap' }}>
          {order.review.vendorResponse}
        </p>
      ) : can('vendor.order.manage') ? (
        <form
          className="sz-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (response.trim().length >= 2) respond.mutate();
          }}
        >
          <TextAreaField
            label={t('vendor.orders.responsePlaceholder')}
            value={response}
            onChange={setResponse}
            rows={2}
            maxLength={2000}
          />
          <FormError message={respond.isError ? errorText(respond.error) : null} />
          <div>
            <ActionButton type="submit" variant="outline" size="sm" busy={respond.isPending}>
              {t('vendor.orders.respond')}
            </ActionButton>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function OrderDrawer({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const { vendorId, can } = useVendor();
  const detail = useQuery({
    queryKey: ['vendor', vendorId, 'orders', orderId],
    queryFn: () =>
      unwrap(
        api.GET('/v1/vendors/{vendorId}/orders/{id}', {
          params: { path: { vendorId, id: orderId } },
        }),
      ),
  });
  return (
    <Drawer title={t('vendor.orders.detail')} onClose={onClose}>
      {detail.isPending ? <Skeleton height={200} /> : null}
      {detail.isError ? (
        <ErrorState message={errorText(detail.error)} onRetry={() => void detail.refetch()} />
      ) : null}
      {detail.data ? (
        <div style={{ display: 'grid', gap: 16 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 8,
              alignItems: 'center',
            }}
          >
            <strong>{detail.data.listingTitle}</strong>
            <StatusPill
              tone={orderTone(detail.data.status)}
              label={statusLabel(detail.data.status)}
            />
          </div>
          {detail.data.status === 'disputed' ? (
            <Banner tone="danger">{statusLabel('disputed')}</Banner>
          ) : null}
          <DetailList
            items={[
              {
                label: t('vendor.orders.details'),
                value: <span style={{ whiteSpace: 'pre-wrap' }}>{detail.data.details}</span>,
              },
              ...(detail.data.preferredAt
                ? [
                    {
                      label: t('vendor.orders.preferred'),
                      value: formatDateTime(detail.data.preferredAt),
                    },
                  ]
                : []),
              ...(detail.data.scheduledAt
                ? [
                    {
                      label: t('vendor.orders.scheduled'),
                      value: formatDateTime(detail.data.scheduledAt),
                    },
                  ]
                : []),
              ...(detail.data.quoteKobo !== null
                ? [{ label: t('vendor.orders.quote'), value: formatKobo(detail.data.quoteKobo) }]
                : []),
              ...(detail.data.amountKobo !== null
                ? [{ label: t('vendor.orders.amount'), value: formatKobo(detail.data.amountKobo) }]
                : []),
              ...(detail.data.commissionKobo !== null
                ? [
                    {
                      label: t('vendor.orders.commission'),
                      value: formatKobo(detail.data.commissionKobo),
                    },
                  ]
                : []),
              ...(detail.data.vendorAmountKobo !== null
                ? [
                    {
                      label: t('vendor.orders.yourShare'),
                      value: formatKobo(detail.data.vendorAmountKobo),
                    },
                  ]
                : []),
              {
                label: t('vendor.orders.payment'),
                value: detail.data.paid
                  ? t('vendor.orders.paid')
                  : detail.data.status === 'accepted'
                    ? t('vendor.orders.awaitingPayment')
                    : t('vendor.orders.notPayable'),
              },
            ]}
          />
          <OrderActions order={detail.data} />
          {can('vendor.order.manage') ? <Assign order={detail.data} /> : null}
          <ReviewBlock order={detail.data} />
          <Messages orderId={detail.data.id} />
          <section>
            <h3>{t('vendor.orders.history')}</h3>
            <ol style={{ margin: 0, paddingLeft: 20 }}>
              {detail.data.events.map((e, index) => (
                <li key={`${e.createdAt}-${index}`}>
                  {statusLabel(e.toStatus)} · {t(`vendor.actor.${e.actorKind}` as MessageKey)} ·{' '}
                  {formatDateTime(e.createdAt)}
                  {e.note ? <div className="sz-muted">{e.note}</div> : null}
                </li>
              ))}
            </ol>
          </section>
        </div>
      ) : null}
    </Drawer>
  );
}

/** Orders inbox (public-web.md §8). */
export function OrdersScreen() {
  const { vendorId } = useVendor();
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<string | null>(null);
  const orders = useInfiniteQuery({
    queryKey: ['vendor', vendorId, 'orders', 'list', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrapPage(
        api.GET('/v1/vendors/{vendorId}/orders', {
          params: {
            path: { vendorId },
            query: {
              limit: 30,
              ...(filter === 'all' ? {} : { status: filter }),
              ...(pageParam ? { cursor: pageParam } : {}),
            },
          },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const columns: Column<Order>[] = [
    {
      key: 'order',
      header: t('vendor.orders.col.order'),
      render: (o) => (
        <div>
          <strong>{o.listingTitle}</strong>
          <div
            className="sz-muted"
            style={{
              maxWidth: 'min(360px, 55vw)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {o.details}
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      header: t('vendor.orders.col.status'),
      render: (o) => <StatusPill tone={orderTone(o.status)} label={statusLabel(o.status)} />,
    },
    {
      key: 'amount',
      header: t('vendor.orders.col.amount'),
      align: 'right',
      render: (o) =>
        o.amountKobo !== null
          ? formatKobo(o.amountKobo)
          : o.quoteKobo !== null
            ? formatKobo(o.quoteKobo)
            : '-',
    },
    {
      key: 'placed',
      header: t('vendor.orders.col.placed'),
      render: (o) => <span style={{ whiteSpace: 'nowrap' }}>{formatDateTime(o.createdAt)}</span>,
    },
  ];
  return (
    <>
      <PageHeader title={t('vendor.orders.title')} description={t('vendor.orders.description')} />
      <Tabs
        label={t('vendor.orders.title')}
        value={filter}
        onChange={setFilter}
        tabs={FILTERS.map((key) => ({
          key,
          label: key === 'all' ? t('vendor.orders.filter.all') : statusLabel(key),
        }))}
      />
      <DataTable
        caption={t('vendor.orders.title')}
        columns={columns}
        rows={orders.data?.pages.flatMap((p) => p.items)}
        rowKey={(o) => o.id}
        loading={orders.isPending}
        error={orders.isError ? errorText(orders.error) : null}
        onRetry={() => void orders.refetch()}
        empty={{
          icon: 'clipboard',
          title: t('vendor.orders.empty.title'),
          body: t('vendor.orders.empty.body'),
        }}
        onRowClick={(o) => setOpen(o.id)}
        selectedKey={open}
        hasMore={orders.hasNextPage}
        loadingMore={orders.isFetchingNextPage}
        onLoadMore={() => void orders.fetchNextPage()}
      />
      {open ? <OrderDrawer orderId={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
