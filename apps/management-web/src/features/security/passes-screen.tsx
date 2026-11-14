'use client';

import { type ApiRow, unwrap, unwrapPage } from '@safezone/api-client';
import { maskPhone } from '@safezone/auth';
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

type Pass = ApiRow<'/v1/estates/{estateId}/visitor-passes', 'get'>;
type Status = Pass['status'];

/** UI_GUIDELINES §6.8 visitor pass tones. */
const TONE: Record<Status, Tone> = {
  scheduled: 'info',
  active: 'success',
  used: 'neutral',
  expired: 'neutral',
  revoked: 'danger',
};

export function PassesScreen() {
  const { estateId, can } = useEstate();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>('active');
  const [revoking, setRevoking] = useState<Pass | null>(null);
  const showPhone = can('pii.view');
  const list = usePaged<Pass>(['estate', estateId, 'visitor-passes', status], (cursor) =>
    unwrapPage(
      api.GET('/v1/estates/{estateId}/visitor-passes', {
        params: { path: { estateId }, query: { status, limit: 50, cursor } },
      }),
    ),
  );
  const revoke = useMutation({
    mutationFn: ({ pass, reason }: { pass: Pass; reason: string }) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/visitor-passes/{id}/revoke', {
          params: { path: { estateId, id: pass.id } },
          body: { reason },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'visitor-passes'] });
      setRevoking(null);
    },
  });

  const columns: Column<Pass>[] = [
    {
      key: 'visitor',
      header: t('passes.col.visitor'),
      render: (row) => (
        <div>
          <strong>{row.visitorName}</strong>
          {row.visitorPhone ? (
            <div className="sz-muted sz-num" style={{ fontSize: 13 }}>
              {showPhone ? row.visitorPhone : maskPhone(row.visitorPhone)}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'type',
      header: t('passes.col.type'),
      render: (row) => t(`passes.type.${row.type}` as MessageKey),
    },
    {
      key: 'plate',
      header: t('passes.col.plate'),
      render: (row) => row.vehiclePlate ?? <span className="sz-muted">-</span>,
    },
    {
      key: 'valid',
      header: t('passes.col.valid'),
      render: (row) => (
        <span className="sz-num" style={{ fontSize: 13 }}>
          {formatDateTime(row.validFrom)}
          <br />
          {formatDateTime(row.validTo)}
        </span>
      ),
    },
    {
      key: 'uses',
      header: t('passes.col.uses'),
      align: 'right',
      render: (row) => (row.maxUses ? `${row.usesCount} / ${row.maxUses}` : String(row.usesCount)),
    },
    {
      key: 'status',
      header: t('passes.col.status'),
      render: (row) => (
        <StatusPill
          tone={TONE[row.status]}
          label={t(`passes.status.${row.status}` as MessageKey)}
        />
      ),
    },
    ...(status === 'active' || status === 'scheduled'
      ? [
          {
            key: 'actions',
            header: t('common.actions'),
            align: 'right' as const,
            render: (row: Pass) => (
              <ActionButton variant="text" size="sm" onClick={() => setRevoking(row)}>
                {t('passes.revoke')}
              </ActionButton>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader title={t('passes.title')} description={t('passes.description')} />
      <Tabs<Status>
        label={t('passes.title')}
        value={status}
        onChange={setStatus}
        tabs={(['active', 'scheduled', 'used', 'expired', 'revoked'] as Status[]).map((key) => ({
          key,
          label: t(`passes.status.${key}` as MessageKey),
        }))}
      />
      <DataTable
        caption={t('passes.title')}
        columns={columns}
        rows={list.rows}
        rowKey={(row) => row.id}
        loading={list.loading}
        error={list.error ? errorText(list.error) : null}
        onRetry={list.refetch}
        hasMore={list.hasMore}
        loadingMore={list.loadingMore}
        onLoadMore={list.loadMore}
        empty={{ icon: 'ticket', title: t('passes.empty.title'), body: t('passes.empty.body') }}
      />
      {revoking ? (
        <ConfirmDialog
          title={t('passes.revokeConfirm.title')}
          body={t('passes.revokeConfirm.body', { name: revoking.visitorName })}
          confirmLabel={t('passes.revoke')}
          cancelLabel={t('passes.revokeConfirm.keep')}
          destructive
          reason={{ label: t('passes.revokeConfirm.reason'), required: true }}
          busy={revoke.isPending}
          error={revoke.isError ? errorText(revoke.error) : null}
          onConfirm={(reason) => revoke.mutate({ pass: revoking, reason })}
          onClose={() => setRevoking(null)}
        />
      ) : null}
    </>
  );
}
