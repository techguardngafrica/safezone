'use client';

import { type ApiRow, unwrap } from '@safezone/api-client';
import { formatDateTime, t } from '@safezone/i18n';
import {
  ActionButton,
  type Column,
  ConfirmDialog,
  DataTable,
  PageHeader,
  StatusPill,
  Tabs,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useEstate } from '../../../lib/estate';
import { errorText } from '../../../lib/errors';
import { api } from '../../../lib/session';

type ReportRow = ApiRow<'/v1/estates/{estateId}/moderation/queue', 'get'>;
type ActionRow = ApiRow<'/v1/estates/{estateId}/moderation/actions', 'get'>;
type TabId = 'queue' | 'actions';

export function ModerationScreen() {
  const { estateId } = useEstate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabId>('queue');
  const [removing, setRemoving] = useState<ReportRow | null>(null);
  const [appealTarget, setAppealTarget] = useState<{
    action: ActionRow;
    decision: 'upheld' | 'overturned';
  } | null>(null);

  const queue = useQuery({
    queryKey: ['estate', estateId, 'moderation', 'queue'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/moderation/queue', {
          params: { path: { estateId }, query: { status: 'open' } },
        }),
      ),
  });

  const actions = useQuery({
    queryKey: ['estate', estateId, 'moderation', 'actions'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/moderation/actions', { params: { path: { estateId } } }),
      ),
  });

  const takeAction = useMutation({
    mutationFn: ({ report, reason }: { report: ReportRow; reason: string }) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/moderation/actions', {
          params: { path: { estateId } },
          body: {
            action: report.targetType === 'message' ? 'remove_message' : 'suspend_channel',
            targetType: report.targetType,
            targetId: report.targetId,
            reason,
            reportId: report.id,
          },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'moderation'] });
      setRemoving(null);
    },
  });

  const decideAppeal = useMutation({
    mutationFn: ({
      id,
      decision,
      note,
    }: {
      id: string;
      decision: 'upheld' | 'overturned';
      note?: string;
    }) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/moderation/actions/{id}/decide', {
          params: { path: { estateId, id } },
          body: { decision, note },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'moderation'] });
      setAppealTarget(null);
    },
  });

  const queueCols: Column<ReportRow>[] = [
    { key: 'target', header: 'Target', render: (r) => r.targetType },
    { key: 'reason', header: 'Reason', render: (r) => r.reason },
    { key: 'details', header: 'Details', render: (r) => r.details ?? '-' },
    {
      key: 'created',
      header: 'Reported',
      render: (r) => <span className="sz-num">{formatDateTime(r.createdAt)}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => (
        <ActionButton
          variant="danger"
          size="sm"
          onClick={() => {
            takeAction.reset();
            setRemoving(r);
          }}
        >
          Take action
        </ActionButton>
      ),
    },
  ];

  const actionCols: Column<ActionRow>[] = [
    { key: 'action', header: 'Action', render: (r) => r.action.replace(/_/g, ' ') },
    { key: 'target', header: 'Target', render: (r) => r.targetType },
    { key: 'reason', header: 'Reason', render: (r) => r.reason },
    {
      key: 'appeal',
      header: 'Appeal',
      render: (r) =>
        r.appealStatus ? (
          <StatusPill
            tone={r.appealStatus === 'pending' ? 'warning' : 'neutral'}
            label={r.appealStatus}
          />
        ) : (
          <span className="sz-muted">-</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) =>
        r.appealStatus === 'pending' ? (
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <ActionButton
              variant="outline"
              size="sm"
              onClick={() => setAppealTarget({ action: r, decision: 'upheld' })}
            >
              Uphold
            </ActionButton>
            <ActionButton
              variant="secondary"
              size="sm"
              onClick={() => setAppealTarget({ action: r, decision: 'overturned' })}
            >
              Overturn
            </ActionButton>
          </div>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader title={t('moderation.title')} description={t('moderation.description')} />

      <Tabs<TabId>
        label={t('moderation.title')}
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'queue', label: t('moderation.tab.queue', { count: queue.data?.length ?? 0 }) },
          { key: 'actions', label: t('moderation.tab.actions') },
        ]}
      />

      {tab === 'queue' ? (
        <DataTable
          caption={t('moderation.tab.queue', { count: queue.data?.length ?? 0 })}
          columns={queueCols}
          rows={queue.data ?? []}
          rowKey={(r) => r.id}
          loading={queue.isPending}
          error={queue.isError ? errorText(queue.error) : null}
          onRetry={() => void queue.refetch()}
          empty={{ icon: 'shield', title: t('moderation.title'), body: t('moderation.emptyQueue') }}
        />
      ) : (
        <DataTable
          caption={t('moderation.tab.actions')}
          columns={actionCols}
          rows={actions.data ?? []}
          rowKey={(r) => r.id}
          loading={actions.isPending}
          error={actions.isError ? errorText(actions.error) : null}
          onRetry={() => void actions.refetch()}
          empty={{
            icon: 'history',
            title: t('moderation.tab.actions'),
            body: t('moderation.emptyActions'),
          }}
        />
      )}

      {removing ? (
        <ConfirmDialog
          title="Take moderation action"
          body="Enforce moderation action on this reported item? The action is logged and appealable."
          confirmLabel="Enforce"
          destructive
          reason={{ label: 'Moderation reason', required: true }}
          busy={takeAction.isPending}
          error={takeAction.isError ? errorText(takeAction.error) : null}
          onClose={() => setRemoving(null)}
          onConfirm={(reason) => takeAction.mutate({ report: removing, reason: reason ?? '' })}
        />
      ) : null}

      {appealTarget ? (
        <ConfirmDialog
          title={appealTarget.decision === 'upheld' ? 'Uphold action' : 'Overturn action'}
          body="Record your decision on this moderation appeal?"
          confirmLabel={appealTarget.decision === 'upheld' ? 'Uphold' : 'Overturn'}
          reason={{ label: 'Note (optional)' }}
          busy={decideAppeal.isPending}
          error={decideAppeal.isError ? errorText(decideAppeal.error) : null}
          onClose={() => setAppealTarget(null)}
          onConfirm={(note) =>
            decideAppeal.mutate({
              id: appealTarget.action.id,
              decision: appealTarget.decision,
              note,
            })
          }
        />
      ) : null}
    </>
  );
}
