'use client';

import { unwrapPage } from '@safezone/api-client';
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
import { useState } from 'react';
import { api } from '../../../lib/session';
import { errorText } from '../../lib/errors';
import { formatMoney, formatWat, humanizeStatus, statusTone } from '../../lib/format';

type InvoiceStatus = 'issued' | 'paid' | 'void';

/** Cross-campaign advertising invoices and payment status (super-admin.md §6.6). */
export function AdInvoicesScreen() {
  const router = useRouter();
  const [status, setStatus] = useState<InvoiceStatus | ''>('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  const query = useQuery({
    queryKey: ['platform', 'ad-invoices', status, cursor],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/platform/ad-invoices', {
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
      <PageHeader
        title={t('admin.ads.invoices.title')}
        description={t('admin.ads.invoices.description')}
      />
      <Toolbar>
        <SelectField
          label={t('admin.ads.status')}
          value={status}
          onChange={(value) => {
            setStatus(value);
            setCursor(undefined);
          }}
          options={[
            { value: '', label: t('admin.ads.allStatuses') },
            { value: 'issued', label: 'Issued' },
            { value: 'paid', label: 'Paid' },
            { value: 'void', label: 'Void' },
          ]}
        />
      </Toolbar>

      {query.isError ? (
        <ErrorState message={errorText(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <DataTable
          caption={t('admin.ads.invoices.title')}
          loading={query.isPending}
          rows={query.data?.items ?? []}
          rowKey={(row) => row.id}
          onRowClick={(row) => router.push(`/ads/campaigns/${row.campaignId}`)}
          empty={{ icon: 'wallet', title: t('admin.ads.invoices.empty') }}
          columns={[
            {
              key: 'number',
              header: t('admin.ads.invoices.number'),
              render: (row) => (
                <div>
                  <strong>{row.number}</strong>
                  <div className="sz-muted" style={{ fontSize: 12 }}>
                    {formatWat(row.createdAt)}
                  </div>
                </div>
              ),
            },
            {
              key: 'campaign',
              header: t('admin.ads.invoices.campaign'),
              render: (row) => (
                <div>
                  <strong>{row.campaignTitle}</strong>
                  <div className="sz-muted" style={{ fontSize: 12 }}>
                    {row.advertiserName}
                  </div>
                </div>
              ),
            },
            {
              key: 'subtotal',
              header: t('admin.ads.invoices.subtotal'),
              align: 'right',
              render: (row) => formatMoney(row.amountKobo),
            },
            {
              key: 'vat',
              header: t('admin.ads.invoices.vat'),
              align: 'right',
              render: (row) => formatMoney(row.vatKobo),
            },
            {
              key: 'total',
              header: t('admin.ads.invoices.total'),
              align: 'right',
              render: (row) => <strong>{formatMoney(row.totalKobo)}</strong>,
            },
            {
              key: 'status',
              header: t('admin.ads.status'),
              render: (row) => (
                <StatusPill tone={statusTone(row.status)} label={humanizeStatus(row.status)} />
              ),
            },
            {
              key: 'paidAt',
              header: t('admin.ads.invoices.paidAt'),
              render: (row) => formatWat(row.paidAt),
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
