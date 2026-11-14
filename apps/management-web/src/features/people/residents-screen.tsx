'use client';

import { type ApiRow, unwrapPage } from '@safezone/api-client';
import { maskPhone } from '@safezone/auth';
import { type MessageKey, t } from '@safezone/i18n';
import { type Column, DataTable, InputField, PageHeader, Toolbar } from '@safezone/web-ui';
import { useEffect, useState } from 'react';
import { useEstate } from '../../../lib/estate';
import { errorText } from '../../../lib/errors';
import { usePaged } from '../../../lib/paged';
import { api } from '../../../lib/session';

type Resident = ApiRow<'/v1/estates/{estateId}/residents', 'get'>;

function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

export function ResidentsScreen() {
  const { estateId, can } = useEstate();
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const showPhone = can('pii.view');
  const list = usePaged<Resident>(['estate', estateId, 'residents', q], (cursor) =>
    unwrapPage(
      api.GET('/v1/estates/{estateId}/residents', {
        params: { path: { estateId }, query: { q: q || undefined, limit: 50, cursor } },
      }),
    ),
  );
  const columns: Column<Resident>[] = [
    {
      key: 'name',
      header: t('resident.col.name'),
      render: (row) => <strong>{row.fullName}</strong>,
    },
    { key: 'unit', header: t('resident.col.unit'), render: (row) => row.unit.code },
    {
      key: 'relationship',
      header: t('resident.col.relationship'),
      render: (row) => t(`resident.relationship.${row.relationship}` as MessageKey),
    },
    {
      key: 'phone',
      header: t('resident.col.phone'),
      render: (row) =>
        row.phone ? (
          <span className="sz-num">{showPhone ? row.phone : maskPhone(row.phone)}</span>
        ) : (
          <span className="sz-muted">{t('resident.noAccount')}</span>
        ),
    },
  ];
  return (
    <>
      <PageHeader title={t('resident.title')} description={t('resident.description')} />
      <Toolbar>
        <div style={{ width: 320, maxWidth: '100%' }}>
          <InputField
            label={t('resident.search')}
            type="search"
            value={search}
            onChange={setSearch}
            placeholder={t('resident.searchPlaceholder')}
          />
        </div>
      </Toolbar>
      <DataTable
        caption={t('resident.title')}
        columns={columns}
        rows={list.rows}
        rowKey={(row) => row.memberId}
        loading={list.loading}
        error={list.error ? errorText(list.error) : null}
        onRetry={list.refetch}
        hasMore={list.hasMore}
        loadingMore={list.loadingMore}
        onLoadMore={list.loadMore}
        empty={{
          icon: 'users',
          title: q ? t('resident.empty.searchTitle') : t('resident.empty.title'),
          body: q ? undefined : t('resident.empty.body'),
        }}
      />
    </>
  );
}
