'use client';

import { unwrap } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import { DataTable, ErrorState, PageHeader, StatusPill } from '@safezone/web-ui';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/session';
import { errorText } from '../../lib/errors';
import { humanizeStatus, statusTone } from '../../lib/format';

/** Prohibited, restricted and allowed advertising categories (super-admin.md §6.9). */
export function AdCategoriesScreen() {
  const query = useQuery({
    queryKey: ['platform', 'ad-categories'],
    queryFn: () => unwrap(api.GET('/v1/platform/ad-categories')),
  });

  return (
    <>
      <PageHeader
        title={t('admin.platform.adCategories.title')}
        description={t('admin.platform.adCategories.description')}
      />

      {query.isError ? (
        <ErrorState message={errorText(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <DataTable
          caption={t('admin.platform.adCategories.title')}
          loading={query.isPending}
          rows={query.data ?? []}
          rowKey={(row) => row.category}
          columns={[
            {
              key: 'category',
              header: t('admin.platform.adCategories.category'),
              render: (row) => <strong>{humanizeStatus(row.category)}</strong>,
            },
            {
              key: 'policy',
              header: t('admin.platform.adCategories.policy'),
              render: (row) => (
                <StatusPill tone={statusTone(row.policy)} label={humanizeStatus(row.policy)} />
              ),
            },
            {
              key: 'enforcement',
              header: t('admin.platform.adCategories.enforcement'),
              render: (row) =>
                row.locked
                  ? t('admin.platform.adCategories.locked')
                  : t('admin.platform.adCategories.standard'),
            },
            {
              key: 'notes',
              header: t('admin.platform.adCategories.notes'),
              render: (row) => row.notes,
            },
          ]}
        />
      )}
    </>
  );
}
