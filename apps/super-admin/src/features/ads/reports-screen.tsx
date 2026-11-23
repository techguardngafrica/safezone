'use client';

import { unwrap } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  DataTable,
  ErrorState,
  InputField,
  PageHeader,
  Panel,
  StatCard,
  StatusPill,
  Toolbar,
} from '@safezone/web-ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../lib/session';
import { errorText } from '../../lib/errors';
import { formatMoney, humanizeStatus, statusTone } from '../../lib/format';

function defaultDateRange() {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Aggregate platform advertising performance and revenue reports (super-admin.md §6.6). */
export function AdReportsScreen() {
  const router = useRouter();
  const defaults = defaultDateRange();
  const [fromDate, setFromDate] = useState(defaults.from);
  const [toDate, setToDate] = useState(defaults.to);

  const query = useQuery({
    queryKey: ['platform', 'ad-reports', fromDate, toDate],
    queryFn: () =>
      unwrap(
        api.GET('/v1/platform/ad-reports', {
          params: {
            query: {
              from: `${fromDate}T00:00:00Z`,
              to: `${toDate}T23:59:59Z`,
            },
          },
        }),
      ),
  });

  function exportCsv() {
    if (!query.data) return;
    const lines = [
      `# Safezone Ad Report (${fromDate} to ${toDate}) generated ${new Date().toISOString()}`,
      'Campaign,Advertiser,Status,Impressions,Clicks,CTR %,Paid (NGN)',
      ...query.data.byCampaign.map((c) =>
        [
          csvCell(c.campaignTitle),
          csvCell(c.advertiserName),
          csvCell(c.status),
          c.impressions,
          c.clicks,
          (c.ctr * 100).toFixed(2),
          (c.paidKobo / 100).toFixed(2),
        ].join(','),
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `safezone-ad-report-${fromDate}-to-${toDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <PageHeader
        title={t('admin.ads.reports.title')}
        description={t('admin.ads.reports.description')}
        actions={
          <ActionButton variant="outline" disabled={!query.data} onClick={exportCsv}>
            {t('admin.ads.reports.exportCsv')}
          </ActionButton>
        }
      />

      <Toolbar>
        <InputField
          label={t('admin.ads.reports.from')}
          type="date"
          value={fromDate}
          onChange={setFromDate}
        />
        <InputField
          label={t('admin.ads.reports.to')}
          type="date"
          value={toDate}
          onChange={setToDate}
        />
      </Toolbar>

      {query.isError ? (
        <ErrorState message={errorText(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 12,
            }}
          >
            <StatCard
              label={t('admin.ads.reports.impressions')}
              value={query.data ? query.data.impressions.toLocaleString() : '-'}
            />
            <StatCard
              label={t('admin.ads.reports.clicks')}
              value={query.data ? query.data.clicks.toLocaleString() : '-'}
            />
            <StatCard
              label={t('admin.ads.reports.ctr')}
              value={query.data ? `${(query.data.ctr * 100).toFixed(2)}%` : '-'}
            />
            <StatCard
              label={t('admin.ads.reports.invoiced')}
              value={query.data ? formatMoney(query.data.invoicedKobo) : '-'}
            />
            <StatCard
              label={t('admin.ads.reports.paid')}
              value={query.data ? formatMoney(query.data.paidKobo) : '-'}
            />
          </div>

          <Panel title={t('admin.ads.reports.byPlacement')}>
            <DataTable
              caption={t('admin.ads.reports.byPlacement')}
              loading={query.isPending}
              rows={query.data?.byPlacement ?? []}
              rowKey={(row) => row.placementKey}
              columns={[
                {
                  key: 'placement',
                  header: 'Placement',
                  render: (row) => <code>{row.placementKey}</code>,
                },
                {
                  key: 'impressions',
                  header: t('admin.ads.reports.impressions'),
                  align: 'right',
                  render: (row) => row.impressions.toLocaleString(),
                },
                {
                  key: 'clicks',
                  header: t('admin.ads.reports.clicks'),
                  align: 'right',
                  render: (row) => row.clicks.toLocaleString(),
                },
                {
                  key: 'ctr',
                  header: t('admin.ads.reports.ctr'),
                  align: 'right',
                  render: (row) => `${(row.ctr * 100).toFixed(2)}%`,
                },
              ]}
            />
          </Panel>

          <Panel title={t('admin.ads.reports.byCampaign')}>
            <DataTable
              caption={t('admin.ads.reports.byCampaign')}
              loading={query.isPending}
              rows={query.data?.byCampaign ?? []}
              rowKey={(row) => row.campaignId}
              onRowClick={(row) => router.push(`/ads/campaigns/${row.campaignId}`)}
              empty={{ icon: 'activity', title: t('admin.ads.reports.emptyCampaigns') }}
              columns={[
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
                  key: 'status',
                  header: t('admin.ads.status'),
                  render: (row) => (
                    <StatusPill tone={statusTone(row.status)} label={humanizeStatus(row.status)} />
                  ),
                },
                {
                  key: 'impressions',
                  header: t('admin.ads.reports.impressions'),
                  align: 'right',
                  render: (row) => row.impressions.toLocaleString(),
                },
                {
                  key: 'clicks',
                  header: t('admin.ads.reports.clicks'),
                  align: 'right',
                  render: (row) => row.clicks.toLocaleString(),
                },
                {
                  key: 'ctr',
                  header: t('admin.ads.reports.ctr'),
                  align: 'right',
                  render: (row) => `${(row.ctr * 100).toFixed(2)}%`,
                },
                {
                  key: 'paid',
                  header: t('admin.ads.reports.paid'),
                  align: 'right',
                  render: (row) => formatMoney(row.paidKobo),
                },
              ]}
            />
          </Panel>
        </>
      )}
    </div>
  );
}
