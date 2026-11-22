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
import { useState } from 'react';
import { api } from '../../../lib/session';
import { errorText } from '../../lib/errors';
import { formatMoney, formatWat, humanizeStatus, statusTone } from '../../lib/format';

export function TransactionsScreen() {
  const [provider, setProvider] = useState('');
  const [status, setStatus] = useState('');
  const [estateId, setEstateId] = useState('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  const query = useQuery({
    queryKey: ['platform', 'transactions', provider, status, estateId, cursor],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/platform/transactions', {
          params: {
            query: {
              ...(provider ? { provider } : {}),
              ...(status ? { status } : {}),
              ...(estateId.trim() ? { estateId: estateId.trim() } : {}),
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
        title={t('admin.transactions.title')}
        description={t('admin.transactions.description')}
      />
      <Toolbar>
        <SelectField
          label="Provider"
          value={provider}
          onChange={(v) => {
            setProvider(v);
            setCursor(undefined);
          }}
          options={[
            { value: '', label: 'All providers' },
            { value: 'paystack', label: 'Paystack' },
            { value: 'fake', label: 'Fake (dev)' },
          ]}
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
            { value: 'succeeded', label: 'Succeeded' },
            { value: 'partially_refunded', label: 'Partially refunded' },
            { value: 'refunded', label: 'Refunded' },
          ]}
        />
        <InputField
          label="Estate ID (optional)"
          value={estateId}
          onChange={(v) => {
            setEstateId(v);
            setCursor(undefined);
          }}
          placeholder="Filter by estate UUID"
        />
      </Toolbar>

      {query.isError ? (
        <ErrorState message={errorText(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <DataTable
          caption="Platform transactions"
          loading={query.isPending}
          rows={query.data?.items ?? []}
          rowKey={(row) => row.id}
          empty={{ icon: 'wallet', title: t('admin.transactions.empty') }}
          columns={[
            {
              key: 'estate',
              header: 'Estate',
              render: (row) => row.estateName ?? row.estateId.slice(0, 8),
            },
            {
              key: 'reference',
              header: 'Reference',
              render: (row) => <code>{row.reference}</code>,
            },
            {
              key: 'amount',
              header: 'Amount',
              render: (row) => <strong>{formatMoney(row.amountKobo)}</strong>,
            },
            {
              key: 'provider',
              header: 'Provider / Channel',
              render: (row) => `${row.provider}${row.channel ? ` (${row.channel})` : ''}`,
            },
            {
              key: 'status',
              header: 'Status',
              render: (row) => (
                <StatusPill tone={statusTone(row.status)} label={humanizeStatus(row.status)} />
              ),
            },
            { key: 'paid', header: 'Paid at', render: (row) => formatWat(row.paidAt) },
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
