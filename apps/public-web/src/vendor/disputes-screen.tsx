'use client';

import { unwrapPage } from '@safezone/api-client';
import { formatDate, formatKobo, type MessageKey, t } from '@safezone/i18n';
import {
  ActionButton,
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  Skeleton,
  StatusPill,
} from '@safezone/web-ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { errorText } from '../../lib/errors';
import { api } from '../../lib/session';
import { useVendor } from './vendor-context';

type Filter = 'all' | 'open' | 'resolved';

function resolutionLabel(
  resolution: 'refund' | 'partial_refund' | 'no_action' | null,
  refundKobo: number | null,
): string | null {
  if (!resolution) return null;
  if (resolution === 'partial_refund') {
    return t('vendor.disputes.resolution.partial_refund', {
      amount: formatKobo(refundKobo ?? 0),
    });
  }
  return t(`vendor.disputes.resolution.${resolution}` as MessageKey);
}

/** Open disputes and outcomes (public-web.md §8: Disputes). */
export function DisputesScreen() {
  const { vendorId } = useVendor();
  const [filter, setFilter] = useState<Filter>('all');

  const disputes = useInfiniteQuery({
    queryKey: ['vendor', vendorId, 'disputes', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrapPage(
        api.GET('/v1/vendors/{vendorId}/disputes', {
          params: {
            path: { vendorId },
            query: {
              ...(filter === 'all' ? {} : { status: filter }),
              ...(pageParam ? { cursor: pageParam } : {}),
            },
          },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const items = disputes.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <PageHeader
        title={t('vendor.disputes.title')}
        description={t('vendor.disputes.description')}
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {(['all', 'open', 'resolved'] as const).map((key) => (
          <ActionButton
            key={key}
            size="sm"
            variant={filter === key ? 'primary' : 'outline'}
            onClick={() => setFilter(key)}
          >
            {t(`vendor.disputes.filter.${key}` as MessageKey)}
          </ActionButton>
        ))}
      </div>
      <Panel>
        {disputes.isPending ? <Skeleton height={120} /> : null}
        {disputes.isError ? (
          <ErrorState message={errorText(disputes.error)} onRetry={() => void disputes.refetch()} />
        ) : null}
        {!disputes.isPending && !disputes.isError && items.length === 0 ? (
          <EmptyState icon="alert" title={t('vendor.disputes.empty')} />
        ) : null}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}>
          {items.map((dispute) => {
            const outcome = resolutionLabel(dispute.resolution, dispute.refundKobo);
            return (
              <li
                key={dispute.id}
                className="sz-card"
                style={{ padding: 16, display: 'grid', gap: 8 }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    <strong>{dispute.listingTitle}</strong>
                    <span className="sz-muted"> · {dispute.estateName}</span>
                  </div>
                  <StatusPill
                    tone={dispute.status === 'open' ? 'warning' : 'success'}
                    label={t(`vendor.disputes.status.${dispute.status}` as MessageKey)}
                  />
                </div>
                <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{dispute.reason}</p>
                <div className="sz-muted" style={{ fontSize: 13 }}>
                  {t('vendor.disputes.openedAt', { date: formatDate(dispute.createdAt) })}
                  {dispute.resolvedAt
                    ? ` · ${t('vendor.disputes.resolvedAt', { date: formatDate(dispute.resolvedAt) })}`
                    : ''}
                  {dispute.orderAmountKobo !== null
                    ? ` · ${t('vendor.disputes.orderAmount', { amount: formatKobo(dispute.orderAmountKobo) })}`
                    : ''}
                </div>
                {outcome ? <div style={{ fontWeight: 600 }}>{outcome}</div> : null}
                {dispute.note ? (
                  <p className="sz-muted" style={{ margin: 0, fontSize: 14 }}>
                    {t('vendor.disputes.outcomeNote', { note: dispute.note })}
                  </p>
                ) : null}
                <div>
                  <Link href="/vendor/orders">{t('vendor.disputes.viewOrders')}</Link>
                </div>
              </li>
            );
          })}
        </ul>
        {disputes.hasNextPage ? (
          <div style={{ marginTop: 16 }}>
            <ActionButton
              variant="outline"
              busy={disputes.isFetchingNextPage}
              onClick={() => void disputes.fetchNextPage()}
            >
              {t('ui.loadMore')}
            </ActionButton>
          </div>
        ) : null}
      </Panel>
    </>
  );
}
