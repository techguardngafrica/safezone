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
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../lib/session';
import { errorText } from '../../lib/errors';
import { formatWat, humanizeStatus, statusTone } from '../../lib/format';

/** ARCON approval register for managed campaigns (super-admin.md §6.8). */
export function ArconScreen() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [hasRef, setHasRef] = useState<'yes' | 'no' | ''>('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  const query = useQuery({
    queryKey: ['platform', 'compliance', 'arcon', q, hasRef, cursor],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/platform/compliance/arcon', {
          params: {
            query: {
              limit: 25,
              ...(q.trim() ? { q: q.trim() } : {}),
              ...(hasRef ? { hasRef } : {}),
              ...(cursor ? { cursor } : {}),
            },
          },
        }),
      ),
  });

  return (
    <>
      <PageHeader
        title={t('admin.compliance.arcon.title')}
        description={t('admin.compliance.arcon.description')}
      />
      <Toolbar>
        <InputField
          label={t('admin.compliance.arcon.search')}
          value={q}
          onChange={(value) => {
            setQ(value);
            setCursor(undefined);
          }}
        />
        <SelectField
          label={t('admin.compliance.arcon.hasRef')}
          value={hasRef}
          onChange={(value) => {
            setHasRef(value);
            setCursor(undefined);
          }}
          options={[
            { value: '', label: t('admin.compliance.arcon.all') },
            { value: 'yes', label: t('admin.compliance.arcon.withRef') },
            { value: 'no', label: t('admin.compliance.arcon.missingRef') },
          ]}
        />
      </Toolbar>

      {query.isError ? (
        <ErrorState message={errorText(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <DataTable
          caption={t('admin.compliance.arcon.title')}
          loading={query.isPending}
          rows={query.data?.items ?? []}
          rowKey={(row) => row.campaignId}
          onRowClick={(row) => router.push(`/ads/campaigns/${row.campaignId}`)}
          empty={{ icon: 'clipboard', title: t('admin.compliance.arcon.empty') }}
          columns={[
            {
              key: 'ref',
              header: t('admin.compliance.arcon.ref'),
              render: (row) =>
                row.arconApprovalRef ? (
                  <code>{row.arconApprovalRef}</code>
                ) : (
                  <StatusPill tone="warning" label="Missing" />
                ),
            },
            {
              key: 'campaign',
              header: t('admin.ads.invoices.campaign'),
              render: (row) => (
                <div>
                  <strong>{row.campaignTitle}</strong>
                  {row.restrictedNote ? (
                    <div className="sz-muted" style={{ fontSize: 12 }}>
                      Note: {row.restrictedNote}
                    </div>
                  ) : null}
                </div>
              ),
            },
            {
              key: 'advertiser',
              header: t('admin.compliance.arcon.advertiser'),
              render: (row) => (
                <div>
                  <strong>{row.advertiserName}</strong>
                  <div className="sz-muted" style={{ fontSize: 12 }}>
                    {humanizeStatus(row.category)}
                  </div>
                </div>
              ),
            },
            {
              key: 'status',
              header: t('admin.ads.status'),
              render: (row) => (
                <StatusPill
                  tone={statusTone(row.campaignStatus)}
                  label={humanizeStatus(row.campaignStatus)}
                />
              ),
            },
            {
              key: 'flight',
              header: t('admin.compliance.arcon.flight'),
              render: (row) => `${formatWat(row.startsAt)} to ${formatWat(row.endsAt)}`,
            },
            {
              key: 'approvedAt',
              header: t('admin.compliance.arcon.approvedAt'),
              render: (row) => formatWat(row.approvedAt),
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
