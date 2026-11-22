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
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../lib/session';
import { errorText } from '../../lib/errors';
import { formatMoney, formatWat, humanizeStatus, statusTone } from '../../lib/format';
import { usePlatform } from '../../lib/platform';

const STATUSES = [
  'draft',
  'under_review',
  'awaiting_payment',
  'approved',
  'scheduled',
  'active',
  'paused',
  'completed',
  'rejected',
  'cancelled',
] as const;
type Status = (typeof STATUSES)[number];

/** Campaign list (advertising.md §4). */
export function CampaignsScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const advertiserId = params.get('advertiserId') ?? undefined;
  const { can } = usePlatform();
  const [status, setStatus] = useState<Status | ''>('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const query = useQuery({
    queryKey: ['platform', 'ad-campaigns', status, advertiserId, cursor],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/platform/ad-campaigns', {
          params: {
            query: {
              limit: 25,
              ...(status ? { status } : {}),
              ...(advertiserId ? { advertiserId } : {}),
              ...(cursor ? { cursor } : {}),
            },
          },
        }),
      ),
  });
  return (
    <>
      <PageHeader
        title={t('admin.ads.campaigns.title')}
        description={t('admin.ads.campaigns.description')}
        actions={
          can('ad.campaign.manage') ? (
            <Link href="/ads/campaigns/new">
              <ActionButton icon="plus">{t('admin.ads.campaigns.new')}</ActionButton>
            </Link>
          ) : null
        }
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
            ...STATUSES.map((value) => ({ value, label: humanizeStatus(value) })),
          ]}
        />
      </Toolbar>
      {query.isError ? (
        <ErrorState message={errorText(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <DataTable
          caption={t('admin.ads.campaigns.title')}
          loading={query.isPending}
          rows={query.data?.items ?? []}
          rowKey={(row) => row.id}
          onRowClick={(row) => router.push(`/ads/campaigns/${row.id}`)}
          empty={{ icon: 'megaphone', title: t('admin.ads.campaigns.empty') }}
          columns={[
            {
              key: 'title',
              header: t('admin.ads.campaigns.titleField'),
              render: (row) => (
                <div>
                  <strong>{row.title}</strong>
                  <div className="sz-muted" style={{ fontSize: 12 }}>
                    {row.advertiserName}
                  </div>
                </div>
              ),
            },
            {
              key: 'flight',
              header: t('admin.ads.campaigns.flight'),
              render: (row) => `${formatWat(row.startsAt)} to ${formatWat(row.endsAt)}`,
            },
            {
              key: 'budget',
              header: t('admin.ads.budget'),
              align: 'right',
              render: (row) => formatMoney(row.budgetKobo),
            },
            {
              key: 'paid',
              header: t('admin.ads.campaigns.paid'),
              render: (row) =>
                row.paid
                  ? t('admin.ads.campaigns.paid')
                  : row.creditApproved
                    ? t('admin.ads.campaigns.credit')
                    : t('admin.ads.campaigns.unpaid'),
            },
            {
              key: 'status',
              header: t('admin.ads.status'),
              render: (row) => (
                <StatusPill tone={statusTone(row.status)} label={humanizeStatus(row.status)} />
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
            {t('admin.ads.loadMore')}
          </ActionButton>
        </div>
      ) : null}
    </>
  );
}

/** Advertiser choices for the campaign form (first 100). */
export function useAdvertiserOptions() {
  return useQuery({
    queryKey: ['platform', 'advertisers', 'options'],
    queryFn: () =>
      unwrapPage(api.GET('/v1/platform/advertisers', { params: { query: { limit: 100 } } })),
  });
}

/** Estate choices for estate targeting (first 100); needs platform.estate.create, else IDs are typed. */
export function useEstateOptions(enabled: boolean) {
  return useQuery({
    queryKey: ['platform', 'estates', 'options'],
    enabled,
    queryFn: () =>
      unwrapPage(api.GET('/v1/platform/estates', { params: { query: { limit: 100 } } })),
  });
}
