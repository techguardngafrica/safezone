'use client';

import { unwrap } from '@safezone/api-client';
import { formatDate, formatKobo, t } from '@safezone/i18n';
import { EmptyState, ErrorState, PageHeader, Panel, Skeleton, StatCard } from '@safezone/web-ui';
import { useQuery } from '@tanstack/react-query';
import { errorText } from '../../lib/errors';
import { api } from '../../lib/session';
import { useVendor } from './vendor-context';

/** Earnings and reviews (public-web.md §8: Payouts, Reviews). */
export function EarningsScreen() {
  const { vendorId } = useVendor();
  const earnings = useQuery({
    queryKey: ['vendor', vendorId, 'earnings'],
    queryFn: () =>
      unwrap(api.GET('/v1/vendors/{vendorId}/payouts', { params: { path: { vendorId } } })),
  });
  const reviews = useQuery({
    queryKey: ['vendor', vendorId, 'reviews'],
    queryFn: () =>
      unwrap(api.GET('/v1/vendors/{vendorId}/reviews', { params: { path: { vendorId } } })),
  });
  return (
    <>
      <PageHeader
        title={t('vendor.earnings.title')}
        description={t('vendor.earnings.description')}
      />
      {earnings.isPending ? <Skeleton height={100} /> : null}
      {earnings.isError ? (
        <ErrorState message={errorText(earnings.error)} onRetry={() => void earnings.refetch()} />
      ) : null}
      {earnings.data ? (
        <div
          style={{
            display: 'grid',
            gap: 16,
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            marginBottom: 16,
          }}
        >
          <StatCard
            label={t('vendor.earnings.paidOrders')}
            icon="clipboard"
            value={earnings.data.paidOrders}
          />
          <StatCard
            label={t('vendor.earnings.gross')}
            icon="receipt"
            value={formatKobo(earnings.data.grossKobo)}
          />
          <StatCard
            label={t('vendor.earnings.commission')}
            icon="layers"
            value={formatKobo(earnings.data.commissionKobo)}
          />
          <StatCard
            label={t('vendor.earnings.vendor')}
            icon="wallet"
            value={formatKobo(earnings.data.vendorKobo)}
          />
          <StatCard
            label={t('vendor.earnings.refunded')}
            icon="refresh"
            value={formatKobo(earnings.data.refundedKobo)}
          />
        </div>
      ) : null}
      <Panel title={t('vendor.reviews.title')}>
        {reviews.isPending ? <Skeleton height={80} /> : null}
        {reviews.isError ? (
          <ErrorState message={errorText(reviews.error)} onRetry={() => void reviews.refetch()} />
        ) : null}
        {reviews.data?.length === 0 ? (
          <EmptyState icon="activity" title={t('vendor.reviews.empty')} />
        ) : null}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}>
          {reviews.data?.map((r) => (
            <li key={r.id} className="sz-card" style={{ padding: 12 }}>
              <strong>{t('vendor.orders.stars', { rating: r.rating })}</strong>
              <span className="sz-muted"> · {formatDate(r.createdAt)}</span>
              {r.comment ? (
                <p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{r.comment}</p>
              ) : null}
              {r.vendorResponse ? (
                <p className="sz-muted" style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>
                  {r.vendorResponse}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}
