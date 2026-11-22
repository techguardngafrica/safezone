'use client';

import { unwrapPage } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  DataTable,
  ErrorState,
  InputField,
  PageHeader,
  StatusPill,
  Toolbar,
} from '@safezone/web-ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../../lib/session';
import { errorText } from '../../lib/errors';
import { formatWat } from '../../lib/format';

export function AuditScreen() {
  const [action, setAction] = useState('');
  const [resourceType, setResourceType] = useState('');
  const [estateId, setEstateId] = useState('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  const query = useQuery({
    queryKey: ['platform', 'audit', action, resourceType, estateId, cursor],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/platform/audit-events', {
          params: {
            query: {
              ...(action.trim() ? { action: action.trim() } : {}),
              ...(resourceType.trim() ? { resourceType: resourceType.trim() } : {}),
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
      <PageHeader title={t('admin.audit.title')} description={t('admin.audit.description')} />
      <Toolbar>
        <InputField
          label="Action"
          value={action}
          onChange={(v) => {
            setAction(v);
            setCursor(undefined);
          }}
          placeholder="e.g. tenancy.estate.suspend"
        />
        <InputField
          label="Resource type"
          value={resourceType}
          onChange={(v) => {
            setResourceType(v);
            setCursor(undefined);
          }}
          placeholder="e.g. estate, user, feature_flag"
        />
        <InputField
          label="Estate ID (optional)"
          value={estateId}
          onChange={(v) => {
            setEstateId(v);
            setCursor(undefined);
          }}
          placeholder="UUID"
        />
      </Toolbar>

      {query.isError ? (
        <ErrorState message={errorText(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <DataTable
          caption="Platform audit events"
          loading={query.isPending}
          rows={query.data?.items ?? []}
          rowKey={(row) => row.id}
          empty={{ icon: 'history', title: t('admin.audit.empty') }}
          columns={[
            { key: 'time', header: 'Occurred (WAT)', render: (row) => formatWat(row.occurredAt) },
            {
              key: 'action',
              header: 'Action',
              render: (row) => (
                <div>
                  <code>{row.action}</code>
                  {row.reason ? (
                    <div className="sz-muted" style={{ fontSize: 12 }}>
                      {row.reason}
                    </div>
                  ) : null}
                </div>
              ),
            },
            {
              key: 'resource',
              header: 'Resource',
              render: (row) => (
                <span>
                  {row.resourceType}
                  {row.resourceId ? ` (${row.resourceId.slice(0, 8)})` : ''}
                </span>
              ),
            },
            {
              key: 'actor',
              header: 'Actor',
              render: (row) => (
                <StatusPill
                  tone={row.actorType === 'platform_staff' ? 'info' : 'neutral'}
                  label={row.actorType}
                />
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
