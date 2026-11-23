'use client';

import { unwrap } from '@safezone/api-client';
import { formatDate, t } from '@safezone/i18n';
import { EmptyState, ErrorState, PageHeader, Panel, Skeleton } from '@safezone/web-ui';
import { useQuery } from '@tanstack/react-query';
import { errorText } from '../../lib/errors';
import { api } from '../../lib/session';
import { useVendor } from './vendor-context';

/** Estates that have approved this vendor (public-web.md §8: Estates). */
export function EstatesScreen() {
  const { vendorId } = useVendor();
  const estates = useQuery({
    queryKey: ['vendor', vendorId, 'estates'],
    queryFn: () =>
      unwrap(api.GET('/v1/vendors/{vendorId}/estates', { params: { path: { vendorId } } })),
  });

  return (
    <>
      <PageHeader title={t('vendor.estates.title')} description={t('vendor.estates.description')} />
      <Panel>
        {estates.isPending ? <Skeleton height={100} /> : null}
        {estates.isError ? (
          <ErrorState message={errorText(estates.error)} onRetry={() => void estates.refetch()} />
        ) : null}
        {estates.data?.length === 0 ? (
          <EmptyState
            icon="building"
            title={t('vendor.estates.empty')}
            body={t('vendor.estates.emptyBody')}
          />
        ) : null}
        {estates.data && estates.data.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="sz-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>{t('vendor.estates.col.estate')}</th>
                  <th>{t('vendor.estates.col.location')}</th>
                  <th>{t('vendor.estates.col.approvedAt')}</th>
                </tr>
              </thead>
              <tbody>
                {estates.data.map((row) => (
                  <tr key={row.estateId}>
                    <td style={{ fontWeight: 600 }}>{row.estateName}</td>
                    <td>{[row.lga, row.state].filter(Boolean).join(', ') || '-'}</td>
                    <td>{formatDate(row.decidedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Panel>
    </>
  );
}
