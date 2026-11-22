'use client';

import { unwrapPage } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  DataTable,
  ErrorState,
  InputField,
  PageHeader,
  SelectField,
  StatusPill,
  Toolbar,
} from '@safezone/web-ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../lib/session';
import { errorText } from '../../lib/errors';
import { formatWat, humanizeStatus, statusTone } from '../../lib/format';

export function EstatesScreen() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  const query = useQuery({
    queryKey: ['platform', 'estates', q, status, cursor],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/platform/estates', {
          params: {
            query: {
              ...(q.trim() ? { q: q.trim() } : {}),
              ...(status ? { status } : {}),
              limit: 25,
              ...(cursor ? { cursor } : {}),
            },
          },
        }),
      ),
  });

  return (
    <>
      <PageHeader
        title={t('admin.estates.title')}
        description={t('admin.estates.description')}
        actions={
          <Link href="/estates/new">
            <ActionButton icon="userPlus">{t('admin.nav.createEstate')}</ActionButton>
          </Link>
        }
      />

      <Toolbar>
        <InputField
          label="Search"
          value={q}
          onChange={(v) => {
            setQ(v);
            setCursor(undefined);
          }}
          placeholder="Estate name or join code"
        />
        <SelectField
          label="Status"
          value={status}
          onChange={(v) => {
            setStatus(v);
            setCursor(undefined);
          }}
          options={[
            { value: '', label: 'All statuses' },
            { value: 'approved', label: 'Approved (setup)' },
            { value: 'active', label: 'Active' },
            { value: 'suspended', label: 'Suspended' },
            { value: 'deactivated', label: 'Deactivated' },
          ]}
        />
      </Toolbar>

      {query.isError ? (
        <ErrorState message={errorText(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <DataTable
          caption="Estates directory"
          loading={query.isPending}
          rows={query.data?.items ?? []}
          rowKey={(row) => row.id}
          empty={{ icon: 'building', title: t('admin.estates.empty') }}
          columns={[
            {
              key: 'name',
              header: 'Estate',
              render: (row) => (
                <div>
                  <strong>{row.name}</strong>
                  <div className="sz-muted" style={{ fontSize: 12 }}>
                    {row.lga}, {row.state}
                  </div>
                </div>
              ),
            },
            {
              key: 'code',
              header: 'Join code',
              render: (row) => <code>{row.code}</code>,
            },
            {
              key: 'status',
              header: 'Status',
              render: (row) => (
                <StatusPill tone={statusTone(row.status)} label={humanizeStatus(row.status)} />
              ),
            },
            {
              key: 'created',
              header: 'Created',
              render: (row) => formatWat(row.createdAt),
            },
            {
              key: 'action',
              header: '',
              render: (row) => (
                <Link href={`/estates/${row.id}`}>
                  <ActionButton variant="outline" size="sm">
                    Manage
                  </ActionButton>
                </Link>
              ),
            },
          ]}
        />
      )}

      {query.data?.nextCursor ? (
        <div style={{ marginTop: 16 }}>
          <ActionButton
            variant="outline"
            onClick={() => setCursor(query.data?.nextCursor ?? undefined)}
          >
            Load next page
          </ActionButton>
        </div>
      ) : null}
    </>
  );
}
