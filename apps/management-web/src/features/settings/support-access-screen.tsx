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
  type Tone,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useEstate } from '../../../lib/estate';
import { errorText } from '../../../lib/errors';
import { api } from '../../../lib/session';

type SupportSession = ApiRow<'/v1/estates/{estateId}/support-sessions', 'get'>;

const STATUS_TONE: Record<SupportSession['status'], Tone> = {
  pending: 'warning',
  approved: 'success',
  denied: 'danger',
  revoked: 'neutral',
  expired: 'neutral',
};

export function SupportAccessScreen() {
  const { estateId } = useEstate();
  const queryClient = useQueryClient();
  const [action, setAction] = useState<{
    session: SupportSession;
    kind: 'approve' | 'deny' | 'revoke';
  } | null>(null);

  const list = useQuery({
    queryKey: ['estate', estateId, 'support-sessions'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/support-sessions', { params: { path: { estateId } } }),
      ),
  });

  const decide = useMutation({
    mutationFn: ({
      id,
      kind,
      reason,
    }: {
      id: string;
      kind: 'approve' | 'deny' | 'revoke';
      reason?: string;
    }) => {
      if (kind === 'approve') {
        return unwrap(
          api.POST('/v1/estates/{estateId}/support-sessions/{id}/approve', {
            params: { path: { estateId, id } },
            body: { reason: reason || undefined },
          }),
        );
      }
      if (kind === 'deny') {
        return unwrap(
          api.POST('/v1/estates/{estateId}/support-sessions/{id}/deny', {
            params: { path: { estateId, id } },
            body: { reason: reason || undefined },
          }),
        );
      }
      return unwrap(
        api.POST('/v1/estates/{estateId}/support-sessions/{id}/revoke', {
          params: { path: { estateId, id } },
          body: { reason: reason || undefined },
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'support-sessions'] });
      setAction(null);
    },
  });

  const columns: Column<SupportSession>[] = [
    {
      key: 'staff',
      header: t('supportAccess.col.staff'),
      render: (row) => row.platformUserName ?? `${row.platformUserId.slice(0, 8)}...`,
    },
    { key: 'reason', header: t('supportAccess.col.reason'), render: (row) => row.reason },
    {
      key: 'duration',
      header: t('supportAccess.col.duration'),
      render: (row) => <span className="sz-num">{row.durationMinutes} min</span>,
    },
    {
      key: 'status',
      header: t('supportAccess.col.status'),
      render: (row) => <StatusPill tone={STATUS_TONE[row.status]} label={row.status} />,
    },
    {
      key: 'expires',
      header: t('supportAccess.col.expires'),
      render: (row) =>
        row.expiresAt ? (
          <span className="sz-num">{formatDateTime(row.expiresAt)}</span>
        ) : (
          <span className="sz-muted">-</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {row.status === 'pending' ? (
            <>
              <ActionButton
                size="sm"
                onClick={() => {
                  decide.reset();
                  setAction({ session: row, kind: 'approve' });
                }}
              >
                {t('supportAccess.approve')}
              </ActionButton>
              <ActionButton
                variant="danger"
                size="sm"
                onClick={() => {
                  decide.reset();
                  setAction({ session: row, kind: 'deny' });
                }}
              >
                {t('supportAccess.deny')}
              </ActionButton>
            </>
          ) : null}
          {row.status === 'approved' ? (
            <ActionButton
              variant="danger"
              size="sm"
              onClick={() => {
                decide.reset();
                setAction({ session: row, kind: 'revoke' });
              }}
            >
              {t('supportAccess.revoke')}
            </ActionButton>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader title={t('supportAccess.title')} description={t('supportAccess.description')} />

      <DataTable
        caption={t('supportAccess.title')}
        columns={columns}
        rows={list.data ?? []}
        rowKey={(row) => row.id}
        loading={list.isPending}
        error={list.isError ? errorText(list.error) : null}
        onRetry={() => void list.refetch()}
        empty={{
          icon: 'shield',
          title: t('supportAccess.empty.title'),
          body: t('supportAccess.empty.body'),
        }}
      />

      {action ? (
        <ConfirmDialog
          title={
            action.kind === 'approve'
              ? t('supportAccess.approveTitle')
              : action.kind === 'deny'
                ? t('supportAccess.denyTitle')
                : t('supportAccess.revokeTitle')
          }
          body={
            action.kind === 'approve'
              ? t('supportAccess.approveBody')
              : action.kind === 'deny'
                ? t('supportAccess.denyBody')
                : t('supportAccess.revokeBody')
          }
          confirmLabel={
            action.kind === 'approve'
              ? t('supportAccess.approve')
              : action.kind === 'deny'
                ? t('supportAccess.deny')
                : t('supportAccess.revoke')
          }
          destructive={action.kind !== 'approve'}
          reason={{ label: t('supportAccess.reasonLabel'), required: action.kind === 'deny' }}
          busy={decide.isPending}
          error={decide.isError ? errorText(decide.error) : null}
          onClose={() => setAction(null)}
          onConfirm={(reason) =>
            decide.mutate({ id: action.session.id, kind: action.kind, reason })
          }
        />
      ) : null}
    </>
  );
}
