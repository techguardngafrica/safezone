'use client';

import { unwrap, unwrapPage } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  DataTable,
  ErrorState,
  PageHeader,
  SelectField,
  StatusPill,
  Toolbar,
} from '@safezone/web-ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { api } from '../../../lib/session';
import { errorText } from '../../lib/errors';
import { formatWat, humanizeStatus, statusTone } from '../../lib/format';

const STATUSES = ['applied', 'under_review', 'approved', 'rejected', 'suspended'] as const;
type Status = (typeof STATUSES)[number];

/** Vendor applications and accounts (super-admin.md §6.5). */
export function VendorsScreen() {
  const router = useRouter();
  const [status, setStatus] = useState<Status | ''>('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  const categories = useQuery({
    queryKey: ['marketplace', 'categories'],
    queryFn: () => unwrap(api.GET('/v1/marketplace/categories')),
    staleTime: 10 * 60_000,
  });
  const categoryNames = useMemo(
    () => new Map((categories.data ?? []).map((c) => [c.id, c.name])),
    [categories.data],
  );

  const query = useQuery({
    queryKey: ['platform', 'vendors', status, cursor],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/platform/vendors', {
          params: {
            query: {
              limit: 25,
              ...(status ? { status } : {}),
              ...(cursor ? { cursor } : {}),
            },
          },
        }),
      ),
  });

  return (
    <>
      <PageHeader title={t('admin.vendors.title')} description={t('admin.vendors.description')} />
      <Toolbar>
        <SelectField
          label={t('admin.vendors.status')}
          value={status}
          onChange={(value) => {
            setStatus(value);
            setCursor(undefined);
          }}
          options={[
            { value: '', label: t('admin.vendors.allStatuses') },
            ...STATUSES.map((value) => ({ value, label: humanizeStatus(value) })),
          ]}
        />
      </Toolbar>
      {query.isError ? (
        <ErrorState message={errorText(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <DataTable
          caption={t('admin.vendors.title')}
          loading={query.isPending}
          rows={query.data?.items ?? []}
          rowKey={(row) => row.id}
          onRowClick={(row) => router.push(`/vendors/${row.id}`)}
          empty={{ icon: 'building', title: t('admin.vendors.empty') }}
          columns={[
            {
              key: 'name',
              header: t('admin.vendors.name'),
              render: (row) => (
                <div>
                  <strong>{row.name}</strong>
                  <div className="sz-muted" style={{ fontSize: 12 }}>
                    {row.contactEmail}
                    {row.cacNumber ? ` · ${row.cacNumber}` : ''}
                  </div>
                </div>
              ),
            },
            {
              key: 'tier',
              header: t('admin.vendors.tier'),
              render: (row) => humanizeStatus(row.verificationTier),
            },
            {
              key: 'categories',
              header: t('admin.vendors.categories'),
              render: (row) => {
                const names = row.categoryIds
                  .map((id) => categoryNames.get(id) ?? id.slice(0, 8))
                  .slice(0, 3);
                return names.length ? names.join(', ') : '-';
              },
            },
            {
              key: 'payout',
              header: t('admin.vendors.payout'),
              render: (row) => (
                <StatusPill
                  tone={row.payout.ready ? 'success' : 'neutral'}
                  label={
                    row.payout.ready
                      ? t('admin.vendors.payoutReady')
                      : t('admin.vendors.payoutPending')
                  }
                />
              ),
            },
            {
              key: 'status',
              header: t('admin.vendors.status'),
              render: (row) => (
                <StatusPill tone={statusTone(row.status)} label={humanizeStatus(row.status)} />
              ),
            },
            {
              key: 'created',
              header: t('admin.vendors.created'),
              render: (row) => formatWat(row.createdAt),
            },
          ]}
        />
      )}
      {query.data?.nextCursor ? (
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
          <ActionButton
            variant="outline"
            onClick={() => setCursor(query.data.nextCursor ?? undefined)}
          >
            {t('ui.loadMore')}
          </ActionButton>
        </div>
      ) : null}
    </>
  );
}
