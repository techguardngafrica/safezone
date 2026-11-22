'use client';

import { unwrap } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import { DataTable, ErrorState, PageHeader, StatusPill } from '@safezone/web-ui';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/session';
import { errorText } from '../../lib/errors';
import { humanizeStatus, statusTone } from '../../lib/format';

export function ProvidersScreen() {
  const query = useQuery({
    queryKey: ['platform', 'providers'],
    queryFn: () => unwrap(api.GET('/v1/platform/providers')),
  });

  return (
    <>
      <PageHeader
        title={t('admin.providers.title')}
        description={t('admin.providers.description')}
      />
      {query.isError ? (
        <ErrorState message={errorText(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <DataTable
          caption="External providers"
          loading={query.isPending}
          rows={query.data ?? []}
          rowKey={(row) => row.category}
          empty={{ title: 'No providers reported.' }}
          columns={[
            {
              key: 'category',
              header: 'Category',
              render: (row) => <strong>{humanizeStatus(row.category).toUpperCase()}</strong>,
            },
            { key: 'provider', header: 'Active adapter', render: (row) => row.provider },
            {
              key: 'mode',
              header: 'Mode',
              render: (row) => (
                <StatusPill tone={statusTone(row.mode)} label={humanizeStatus(row.mode)} />
              ),
            },
            {
              key: 'configured',
              header: 'Credentials',
              render: (row) => (
                <StatusPill
                  tone={row.configured ? 'success' : 'warning'}
                  label={row.configured ? 'Configured' : 'Not configured'}
                />
              ),
            },
            { key: 'notes', header: 'Notes', render: (row) => row.notes },
          ]}
        />
      )}
    </>
  );
}
