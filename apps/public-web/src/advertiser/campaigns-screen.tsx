'use client';

import { type ApiRow, unwrap } from '@safezone/api-client';
import { formatDate, type MessageKey, t } from '@safezone/i18n';
import { DataTable, PageHeader, StatusPill, type Tone } from '@safezone/web-ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { errorText } from '../../lib/errors';
import { api } from '../../lib/session';
import { useAdvertiser } from './advertiser-shell';

type Campaign = ApiRow<'/v1/advertisers/{advertiserId}/campaigns', 'get'>;

export function campaignTone(status: Campaign['status']): Tone {
  if (status === 'active') return 'success';
  if (status === 'awaiting_payment' || status === 'rejected' || status === 'paused')
    return 'warning';
  if (status === 'cancelled' || status === 'completed') return 'neutral';
  return 'info';
}

export function campaignStatusLabel(status: Campaign['status']): string {
  return t(`advertiser.status.${status}` as MessageKey);
}

export function CampaignsScreen() {
  const router = useRouter();
  const { advertiserId } = useAdvertiser();
  const campaigns = useQuery({
    queryKey: ['advertiser', advertiserId, 'campaigns'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/advertisers/{advertiserId}/campaigns', { params: { path: { advertiserId } } }),
      ),
  });
  return (
    <>
      <PageHeader
        title={t('advertiser.campaigns.title')}
        description={t('advertiser.campaigns.description')}
      />
      <DataTable
        caption={t('advertiser.campaigns.title')}
        rows={campaigns.data}
        rowKey={(row) => row.id}
        loading={campaigns.isPending}
        error={campaigns.isError ? errorText(campaigns.error) : null}
        onRetry={() => void campaigns.refetch()}
        onRowClick={(row) => router.push(`/advertiser/campaigns/${row.id}`)}
        empty={{ icon: 'megaphone', title: t('advertiser.campaigns.empty') }}
        columns={[
          {
            key: 'title',
            header: t('advertiser.campaigns.col.title'),
            render: (row) => <strong>{row.title}</strong>,
          },
          {
            key: 'runs',
            header: t('advertiser.campaigns.col.runs'),
            render: (row) =>
              t('advertiser.campaigns.runs', {
                from: formatDate(row.startsAt),
                to: formatDate(row.endsAt),
              }),
          },
          {
            key: 'status',
            header: t('advertiser.campaigns.col.status'),
            render: (row) => (
              <StatusPill tone={campaignTone(row.status)} label={campaignStatusLabel(row.status)} />
            ),
          },
        ]}
      />
    </>
  );
}
