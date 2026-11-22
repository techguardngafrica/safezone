'use client';

import { unwrap } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import { DataTable, ErrorState, PageHeader, StatusPill } from '@safezone/web-ui';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/session';
import { errorText } from '../../lib/errors';

export function PlansScreen() {
  const query = useQuery({
    queryKey: ['platform', 'plans'],
    queryFn: () => unwrap(api.GET('/v1/platform/plans')),
  });

  return (
    <>
      <PageHeader title={t('admin.plans.title')} description={t('admin.plans.description')} />
      {query.isError ? (
        <ErrorState message={errorText(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <DataTable
          caption="Platform plans"
          loading={query.isPending}
          rows={query.data ?? []}
          rowKey={(row) => row.key}
          empty={{ title: 'No plans seeded yet.' }}
          columns={[
            {
              key: 'name',
              header: 'Plan',
              render: (row) => (
                <div>
                  <strong>{row.name}</strong>{' '}
                  {row.isDefault ? <StatusPill tone="success" label="Default (free)" /> : null}
                  <div className="sz-muted" style={{ fontSize: 12 }}>
                    <code>{row.key}</code>
                  </div>
                </div>
              ),
            },
            {
              key: 'features',
              header: 'Included modules',
              render: (row) => (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {row.features.map((f) => (
                    <StatusPill key={f} tone="info" label={f} />
                  ))}
                </div>
              ),
            },
          ]}
        />
      )}
    </>
  );
}
