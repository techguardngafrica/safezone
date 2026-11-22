'use client';

import { unwrap } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  DataTable,
  ErrorState,
  PageHeader,
  Panel,
  Skeleton,
  StatCard,
  StatusPill,
} from '@safezone/web-ui';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/session';
import { errorText } from '../../lib/errors';
import { formatWat } from '../../lib/format';

export function HealthScreen() {
  const query = useQuery({
    queryKey: ['platform', 'health'],
    queryFn: () => unwrap(api.GET('/v1/platform/health')),
    refetchInterval: 30_000,
  });

  if (query.isPending) {
    return (
      <>
        <PageHeader title={t('admin.health.title')} description={t('admin.health.description')} />
        <Skeleton height={140} />
      </>
    );
  }
  if (query.isError) {
    return (
      <>
        <PageHeader title={t('admin.health.title')} description={t('admin.health.description')} />
        <ErrorState message={errorText(query.error)} onRetry={() => void query.refetch()} />
      </>
    );
  }

  const h = query.data;
  const totalFailed = h.queues.reduce((sum, q) => sum + q.failed, 0);

  return (
    <>
      <PageHeader
        title={t('admin.health.title')}
        description={t('admin.health.description')}
        actions={
          <ActionButton variant="outline" icon="refresh" onClick={() => void query.refetch()}>
            Refresh
          </ActionButton>
        }
      />

      <div
        style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          marginBottom: 24,
        }}
      >
        <StatCard
          label="Overall status"
          value={h.status.toUpperCase()}
          hint={`Checked ${formatWat(h.checkedAt)}`}
          icon="activity"
        />
        <StatCard label="PostgreSQL" value={h.checks.database.toUpperCase()} />
        <StatCard label="Redis" value={h.checks.redis.toUpperCase()} />
        <StatCard label="Failed jobs (DLQ)" value={totalFailed} />
      </div>

      <Panel title="BullMQ queues">
        <DataTable
          caption="BullMQ queues"
          rows={h.queues}
          rowKey={(q) => q.name}
          empty={{ title: 'No queues reported.' }}
          columns={[
            {
              key: 'name',
              header: 'Queue',
              render: (q) => (
                <span>
                  <code>{q.name}</code>
                  {q.name === 'sos' ? (
                    <span style={{ marginLeft: 8 }}>
                      <StatusPill tone="danger" label="Dedicated SOS pool" />
                    </span>
                  ) : null}
                </span>
              ),
            },
            { key: 'waiting', header: 'Waiting', render: (q) => q.waiting },
            { key: 'active', header: 'Active', render: (q) => q.active },
            { key: 'delayed', header: 'Delayed', render: (q) => q.delayed },
            {
              key: 'failed',
              header: 'Failed (DLQ)',
              render: (q) => (
                <StatusPill tone={q.failed > 0 ? 'danger' : 'success'} label={String(q.failed)} />
              ),
            },
          ]}
        />
      </Panel>
    </>
  );
}
