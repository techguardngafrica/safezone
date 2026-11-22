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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../lib/session';
import { errorText } from '../../lib/errors';
import { formatWat, humanizeStatus, statusTone } from '../../lib/format';

type LeadStatus = '' | 'new' | 'contacted' | 'converted' | 'closed';

export function LeadsScreen() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<LeadStatus>('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  const query = useQuery({
    queryKey: ['platform', 'leads', status, cursor],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/platform/onboarding-leads', {
          params: {
            query: {
              ...(status ? { status } : {}),
              limit: 25,
              ...(cursor ? { cursor } : {}),
            },
          },
        }),
      ),
  });

  const updateStatus = useMutation({
    mutationFn: ({
      id,
      next,
    }: {
      id: string;
      next: 'new' | 'contacted' | 'converted' | 'closed';
    }) =>
      unwrap(
        api.PATCH('/v1/platform/onboarding-leads/{id}', {
          params: { path: { id } },
          body: { status: next },
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['platform', 'leads'] });
      void qc.invalidateQueries({ queryKey: ['platform', 'overview'] });
    },
  });

  return (
    <>
      <PageHeader title={t('admin.leads.title')} description={t('admin.leads.description')} />
      <Toolbar>
        <SelectField
          label="Status"
          value={status}
          onChange={(v) => {
            setStatus(v as LeadStatus);
            setCursor(undefined);
          }}
          options={[
            { value: '', label: 'All statuses' },
            { value: 'new', label: 'New' },
            { value: 'contacted', label: 'Contacted' },
            { value: 'converted', label: 'Converted' },
            { value: 'closed', label: 'Closed' },
          ]}
        />
      </Toolbar>

      {query.isError ? (
        <ErrorState message={errorText(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <DataTable
          caption="Assisted onboarding leads"
          loading={query.isPending}
          rows={query.data?.items ?? []}
          rowKey={(row) => row.id}
          empty={{ icon: 'clipboard', title: t('admin.leads.empty') }}
          columns={[
            {
              key: 'estate',
              header: 'Estate',
              render: (row) => (
                <div>
                  <strong>{row.estateName}</strong>
                  <div className="sz-muted" style={{ fontSize: 12 }}>
                    {row.location}
                  </div>
                </div>
              ),
            },
            {
              key: 'contact',
              header: 'Contact',
              render: (row) => (
                <div>
                  <div>{row.name}</div>
                  <div className="sz-muted" style={{ fontSize: 12 }}>
                    {row.phone}
                    {row.email ? ` / ${row.email}` : ''}
                  </div>
                </div>
              ),
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
              header: 'Received',
              render: (row) => formatWat(row.createdAt),
            },
            {
              key: 'actions',
              header: '',
              render: (row) => (
                <div style={{ display: 'flex', gap: 8 }}>
                  {row.status === 'new' ? (
                    <ActionButton
                      variant="outline"
                      size="sm"
                      onClick={() => updateStatus.mutate({ id: row.id, next: 'contacted' })}
                    >
                      Mark contacted
                    </ActionButton>
                  ) : null}
                  {!row.estateId ? (
                    <Link
                      href={`/estates/new?leadId=${row.id}&name=${encodeURIComponent(row.estateName)}`}
                    >
                      <ActionButton size="sm">{t('admin.leads.createFromLead')}</ActionButton>
                    </Link>
                  ) : (
                    <Link href={`/estates/${row.estateId}`}>
                      <ActionButton variant="outline" size="sm">
                        Open estate
                      </ActionButton>
                    </Link>
                  )}
                </div>
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
