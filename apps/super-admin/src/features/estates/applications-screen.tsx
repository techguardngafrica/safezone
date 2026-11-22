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
import { useState } from 'react';
import { api } from '../../../lib/session';
import { errorText } from '../../lib/errors';
import { formatWat, humanizeStatus, statusTone } from '../../lib/format';

type AppStatus =
  '' | 'submitted' | 'under_review' | 'info_requested' | 'approved' | 'rejected' | 'withdrawn';

export function ApplicationsScreen() {
  const [status, setStatus] = useState<AppStatus>('submitted');
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  const query = useQuery({
    queryKey: ['platform', 'applications', status, cursor],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/platform/estate-applications', {
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

  return (
    <>
      <PageHeader
        title={t('admin.applications.title')}
        description={t('admin.applications.description')}
      />
      <Toolbar>
        <SelectField
          label="Status"
          value={status}
          onChange={(v) => {
            setStatus(v as AppStatus);
            setCursor(undefined);
          }}
          options={[
            { value: '', label: 'All statuses' },
            { value: 'submitted', label: 'Submitted' },
            { value: 'under_review', label: 'Under review' },
            { value: 'info_requested', label: 'Info requested' },
            { value: 'approved', label: 'Approved' },
            { value: 'rejected', label: 'Rejected' },
          ]}
        />
      </Toolbar>

      {query.isError ? (
        <ErrorState message={errorText(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <DataTable
          caption="Estate applications"
          loading={query.isPending}
          rows={query.data?.items ?? []}
          rowKey={(row) => row.id}
          empty={{ icon: 'inbox', title: t('admin.applications.empty') }}
          columns={[
            {
              key: 'estate',
              header: 'Estate',
              render: (row) => (
                <div>
                  <strong>{row.estate.name}</strong>
                  <div className="sz-muted" style={{ fontSize: 12 }}>
                    {row.estate.lga}, {row.estate.state}
                  </div>
                </div>
              ),
            },
            {
              key: 'rep',
              header: 'Representative',
              render: (row) => (
                <div>
                  <div>{row.representative.fullName}</div>
                  <div className="sz-muted" style={{ fontSize: 12 }}>
                    {row.representative.role}
                  </div>
                </div>
              ),
            },
            {
              key: 'units',
              header: 'Est. units',
              render: (row) => row.estate.unitsEstimate,
            },
            {
              key: 'status',
              header: 'Status',
              render: (row) => (
                <StatusPill tone={statusTone(row.status)} label={humanizeStatus(row.status)} />
              ),
            },
            {
              key: 'submitted',
              header: 'Submitted',
              render: (row) => formatWat(row.submittedAt),
            },
            {
              key: 'action',
              header: '',
              render: (row) => (
                <Link href={`/estates/applications/${row.id}`}>
                  <ActionButton variant="outline" size="sm">
                    Review
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
