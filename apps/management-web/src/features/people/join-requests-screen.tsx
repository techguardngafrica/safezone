'use client';

import { type ApiRow, unwrap, unwrapPage } from '@safezone/api-client';
import { type MessageKey, formatDateTime, t } from '@safezone/i18n';
import {
  ActionButton,
  type Column,
  ConfirmDialog,
  DataTable,
  PageHeader,
  StatusPill,
  Tabs,
  type Tone,
} from '@safezone/web-ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useEstate } from '../../../lib/estate';
import { errorText } from '../../../lib/errors';
import { usePaged } from '../../../lib/paged';
import { api } from '../../../lib/session';

type JoinRequest = ApiRow<'/v1/estates/{estateId}/join-requests', 'get'>;
type Status = JoinRequest['status'];
type TabKey = 'awaiting_manager' | 'awaiting_owner' | 'approved' | 'rejected';

const TONE: Record<Status, Tone> = {
  awaiting_household_head: 'info',
  awaiting_owner: 'info',
  awaiting_manager: 'info',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
  expired: 'neutral',
};

export function JoinRequestsScreen() {
  const { estateId } = useEstate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabKey>('awaiting_manager');
  const [deciding, setDeciding] = useState<{
    request: JoinRequest;
    action: 'approve' | 'reject';
  } | null>(null);

  const list = usePaged<JoinRequest>(['estate', estateId, 'join-requests', tab], (cursor) =>
    unwrapPage(
      api.GET('/v1/estates/{estateId}/join-requests', {
        params: { path: { estateId }, query: { status: tab, limit: 50, cursor } },
      }),
    ),
  );

  const decide = useMutation({
    mutationFn: ({
      request,
      action,
      reason,
    }: {
      request: JoinRequest;
      action: 'approve' | 'reject';
      reason: string;
    }) =>
      action === 'approve'
        ? unwrap(
            api.POST('/v1/estates/{estateId}/join-requests/{id}/approve', {
              params: { path: { estateId, id: request.id } },
              body: reason ? { reason } : {},
            }),
          )
        : unwrap(
            api.POST('/v1/estates/{estateId}/join-requests/{id}/reject', {
              params: { path: { estateId, id: request.id } },
              body: { reason },
            }),
          ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'join-requests'] });
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'residents'] });
      setDeciding(null);
    },
  });

  const columns: Column<JoinRequest>[] = [
    {
      key: 'name',
      header: t('join.col.name'),
      render: (row) => (
        <div>
          <strong>{row.fullName}</strong>
          {row.message ? (
            <div className="sz-muted" style={{ fontSize: 13, maxWidth: 360 }}>
              {row.message}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'unit',
      header: t('join.col.unit'),
      render: (row) => `${row.unit.code} ${row.unit.name}`.trim(),
    },
    {
      key: 'relationship',
      header: t('join.col.relationship'),
      render: (row) => t(`join.relationship.${row.relationship}` as MessageKey),
    },
    {
      key: 'status',
      header: t('join.col.status'),
      render: (row) => (
        <div>
          <StatusPill
            tone={TONE[row.status]}
            label={t(`join.status.${row.status}` as MessageKey)}
          />
          {row.reason ? (
            <div className="sz-muted" style={{ fontSize: 13 }}>
              {row.reason}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'created',
      header: t('join.col.created'),
      align: 'right',
      render: (row) => formatDateTime(row.createdAt),
    },
    ...(tab === 'awaiting_manager'
      ? [
          {
            key: 'actions',
            header: t('common.actions'),
            align: 'right' as const,
            render: (row: JoinRequest) => (
              <span style={{ display: 'inline-flex', gap: 8 }}>
                <ActionButton
                  size="sm"
                  onClick={() => setDeciding({ request: row, action: 'approve' })}
                >
                  {t('join.approve')}
                </ActionButton>
                <ActionButton
                  variant="outline"
                  size="sm"
                  onClick={() => setDeciding({ request: row, action: 'reject' })}
                >
                  {t('join.reject')}
                </ActionButton>
              </span>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader title={t('join.title')} description={t('join.description')} />
      <Tabs<TabKey>
        label={t('join.title')}
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'awaiting_manager', label: t('join.tab.awaitingYou') },
          { key: 'awaiting_owner', label: t('join.tab.awaitingOwner') },
          { key: 'approved', label: t('join.tab.approved') },
          { key: 'rejected', label: t('join.tab.rejected') },
        ]}
      />
      <DataTable
        caption={t('join.title')}
        columns={columns}
        rows={list.rows}
        rowKey={(row) => row.id}
        loading={list.loading}
        error={list.error ? errorText(list.error) : null}
        onRetry={list.refetch}
        hasMore={list.hasMore}
        loadingMore={list.loadingMore}
        onLoadMore={list.loadMore}
        empty={{ icon: 'userCheck', title: t('join.empty.title'), body: t('join.empty.body') }}
      />
      {deciding ? (
        <ConfirmDialog
          title={
            deciding.action === 'approve'
              ? t('join.approveConfirm.title', { name: deciding.request.fullName })
              : t('join.rejectConfirm.title', { name: deciding.request.fullName })
          }
          body={
            deciding.action === 'approve'
              ? t('join.approveConfirm.body', { unit: deciding.request.unit.code })
              : t('join.rejectConfirm.body')
          }
          confirmLabel={deciding.action === 'approve' ? t('join.approve') : t('join.reject')}
          destructive={deciding.action === 'reject'}
          reason={
            deciding.action === 'reject'
              ? { label: t('join.reason'), required: true, helper: t('join.reasonHelp') }
              : { label: t('join.noteOptional') }
          }
          busy={decide.isPending}
          error={decide.isError ? errorText(decide.error) : null}
          onConfirm={(reason) => decide.mutate({ ...deciding, reason })}
          onClose={() => setDeciding(null)}
        />
      ) : null}
    </>
  );
}
