'use client';

import { type ApiRow, unwrapPage } from '@safezone/api-client';
import { formatDateTime, t } from '@safezone/i18n';
import { type Column, DataTable, PageHeader } from '@safezone/web-ui';
import { useEstate } from '../../../lib/estate';
import { errorText } from '../../../lib/errors';
import { usePaged } from '../../../lib/paged';
import { api } from '../../../lib/session';

type AuditEvent = ApiRow<'/v1/estates/{estateId}/audit-events', 'get'>;

export function AuditLogScreen() {
  const { estateId } = useEstate();
  const list = usePaged<AuditEvent>(['estate', estateId, 'audit-events'], (cursor) =>
    unwrapPage(
      api.GET('/v1/estates/{estateId}/audit-events', {
        params: { path: { estateId }, query: { limit: 50, cursor } },
      }),
    ),
  );
  const columns: Column<AuditEvent>[] = [
    {
      key: 'time',
      header: t('audit.col.time'),
      render: (row) => <span className="sz-num">{formatDateTime(row.occurredAt)}</span>,
    },
    { key: 'action', header: t('audit.col.action'), render: (row) => <code>{row.action}</code> },
    {
      key: 'actor',
      header: t('audit.col.actor'),
      render: (row) => (
        <span>
          {row.actingRole ?? row.actorType}
          {row.actorId ? (
            <span className="sz-muted" style={{ fontSize: 12 }}>
              {' '}
              {row.actorId.slice(-8)}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'resource',
      header: t('audit.col.resource'),
      render: (row) => (
        <span>
          {row.resourceType}
          {row.resourceId ? (
            <span className="sz-muted" style={{ fontSize: 12 }}>
              {' '}
              {row.resourceId.slice(-8)}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'reason',
      header: t('audit.col.reason'),
      render: (row) => row.reason ?? <span className="sz-muted">-</span>,
    },
    { key: 'app', header: t('audit.col.app'), render: (row) => row.app ?? '-' },
  ];
  return (
    <>
      <PageHeader title={t('audit.title')} description={t('audit.description')} />
      <DataTable
        caption={t('audit.title')}
        columns={columns}
        rows={list.rows}
        rowKey={(row) => row.id}
        loading={list.loading}
        error={list.error ? errorText(list.error) : null}
        onRetry={list.refetch}
        hasMore={list.hasMore}
        loadingMore={list.loadingMore}
        onLoadMore={list.loadMore}
        empty={{ icon: 'history', title: t('audit.empty.title') }}
      />
    </>
  );
}
