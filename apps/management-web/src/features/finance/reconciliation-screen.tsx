'use client';

import { type ApiRow, unwrap, unwrapPage } from '@safezone/api-client';
import { formatDateTime, formatKobo, t } from '@safezone/i18n';
import {
  type Column,
  DataTable,
  PageHeader,
  StatCard,
  StatusPill,
  Tabs,
  type Tone,
} from '@safezone/web-ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useEstate } from '../../../lib/estate';
import { errorText } from '../../../lib/errors';
import { usePaged } from '../../../lib/paged';
import { api } from '../../../lib/session';

type TxRow = ApiRow<'/v1/estates/{estateId}/transactions', 'get'>;
type LedgerBalance = ApiRow<'/v1/estates/{estateId}/ledger/balances', 'get'>;
type TabId = 'transactions' | 'ledger';

const TX_TONE: Record<string, Tone> = {
  succeeded: 'success',
  pending: 'warning',
  failed: 'danger',
  refunded: 'neutral',
};

export function ReconciliationScreen() {
  const { estateId, can } = useEstate();
  const [tab, setTab] = useState<TabId>('transactions');

  const txList = usePaged<TxRow>(['estate', estateId, 'transactions'], (cursor) =>
    unwrapPage(
      api.GET('/v1/estates/{estateId}/transactions', {
        params: { path: { estateId }, query: { limit: 50, cursor } },
      }),
    ),
  );

  const payout = useQuery({
    queryKey: ['estate', estateId, 'payout-account'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/payout-account', { params: { path: { estateId } } })),
    enabled: can('estate.configure'),
  });

  const ledger = useQuery({
    queryKey: ['estate', estateId, 'ledger', 'balances'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/ledger/balances', { params: { path: { estateId } } })),
    enabled: tab === 'ledger' && can('report.read'),
  });

  const stats = useMemo(() => {
    const rows = txList.rows ?? [];
    let settled = 0;
    let pending = 0;
    for (const row of rows) {
      if (row.status === 'succeeded') settled += row.amount;
      else pending += row.amount;
    }
    return { settled, pending };
  }, [txList.rows]);

  const txCols: Column<TxRow>[] = [
    {
      key: 'time',
      header: 'Date',
      render: (r) => <span className="sz-num">{formatDateTime(r.paidAt)}</span>,
    },
    {
      key: 'ref',
      header: 'Provider reference',
      render: (r) => <span className="sz-num">{r.reference}</span>,
    },
    { key: 'provider', header: 'Provider', render: (r) => r.provider },
    { key: 'channel', header: 'Channel', render: (r) => r.channel ?? '-' },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      render: (r) => <span className="sz-num">{formatKobo(r.amount)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <StatusPill tone={TX_TONE[r.status] ?? 'neutral'} label={r.status} />,
    },
  ];

  const ledgerCols: Column<LedgerBalance>[] = [
    {
      key: 'code',
      header: 'Account code',
      render: (r) => <span className="sz-num">{r.code}</span>,
    },
    { key: 'name', header: 'Account', render: (r) => r.name },
    { key: 'type', header: 'Type', render: (r) => r.type },
    {
      key: 'balance',
      header: 'Balance',
      align: 'right',
      render: (r) => <span className="sz-num">{formatKobo(r.balance)}</span>,
    },
  ];

  return (
    <>
      <PageHeader title={t('reconciliation.title')} description={t('reconciliation.description')} />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 16,
          marginBottom: 20,
        }}
      >
        <StatCard label={t('reconciliation.kpi.settled')} value={formatKobo(stats.settled)} />
        <StatCard label={t('reconciliation.kpi.pending')} value={formatKobo(stats.pending)} />
        <StatCard
          label={t('reconciliation.kpi.payout')}
          value={
            payout.data
              ? `${payout.data.bankName} (••••${payout.data.accountLast4})`
              : t('reconciliation.payout.missing')
          }
        />
      </div>

      <Tabs<TabId>
        label={t('reconciliation.title')}
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'transactions', label: t('reconciliation.tab.transactions') },
          { key: 'ledger', label: t('reconciliation.tab.ledger') },
        ]}
      />

      {tab === 'transactions' ? (
        <DataTable
          caption={t('reconciliation.tab.transactions')}
          columns={txCols}
          rows={txList.rows}
          rowKey={(r) => r.id}
          loading={txList.loading}
          error={txList.error ? errorText(txList.error) : null}
          onRetry={() => void txList.refetch()}
          hasMore={txList.hasMore}
          loadingMore={txList.loadingMore}
          onLoadMore={txList.loadMore}
          empty={{
            icon: 'wallet',
            title: t('reconciliation.title'),
            body: t('reconciliation.empty'),
          }}
        />
      ) : (
        <DataTable
          caption={t('reconciliation.tab.ledger')}
          columns={ledgerCols}
          rows={ledger.data ?? []}
          rowKey={(r) => r.code}
          loading={ledger.isPending}
          error={ledger.isError ? errorText(ledger.error) : null}
          onRetry={() => void ledger.refetch()}
          empty={{
            icon: 'receipt',
            title: t('reconciliation.tab.ledger'),
            body: t('reconciliation.empty'),
          }}
        />
      )}
    </>
  );
}
