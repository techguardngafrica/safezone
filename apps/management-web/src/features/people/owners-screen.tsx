'use client';

import { type ApiRow, unwrap, unwrapPage } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  type Column,
  ConfirmDialog,
  DataTable,
  InputField,
  PageHeader,
  SelectField,
  StatusPill,
  Tabs,
  type Tone,
  Toolbar,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useEstate } from '../../../lib/estate';
import { errorText } from '../../../lib/errors';
import { usePaged } from '../../../lib/paged';
import { api } from '../../../lib/session';

type Ownership = ApiRow<'/v1/estates/{estateId}/ownerships', 'get'>;
type Transfer = ApiRow<'/v1/estates/{estateId}/ownership-transfers', 'get'>;
type TabId = 'directory' | 'transfers';

const TRANSFER_TONE: Record<Transfer['status'], Tone> = {
  requested: 'warning',
  seller_confirmed: 'info',
  completed: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
};

export function OwnersScreen() {
  const { estateId, can } = useEstate();
  const queryClient = useQueryClient();
  const canManage = can('space.manage');

  const [tab, setTab] = useState<TabId>('directory');
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'ended'>('active');
  const [ending, setEnding] = useState<Ownership | null>(null);
  const [approving, setApproving] = useState<Transfer | null>(null);
  const [rejecting, setRejecting] = useState<Transfer | null>(null);

  const list = usePaged<Ownership>(
    ['estate', estateId, 'ownerships', search, activeFilter],
    (cursor) =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/ownerships', {
          params: {
            path: { estateId },
            query: {
              q: search.trim() || undefined,
              active:
                activeFilter === 'all' ? undefined : activeFilter === 'active' ? 'true' : 'false',
              limit: 50,
              cursor,
            },
          },
        }),
      ),
  );

  const transfers = useQuery({
    queryKey: ['estate', estateId, 'ownership-transfers'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/ownership-transfers', {
          params: { path: { estateId } },
        }),
      ),
  });

  const endOwnership = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/ownerships/{id}/end', {
          params: { path: { estateId, id } },
          body: { reason },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'ownerships'] });
      setEnding(null);
    },
  });

  const approveTransfer = useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/ownership-transfers/{id}/approve', {
          params: { path: { estateId, id } },
          body: {},
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'ownership-transfers'] });
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'ownerships'] });
      setApproving(null);
    },
  });

  const rejectTransfer = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/ownership-transfers/{id}/reject', {
          params: { path: { estateId, id } },
          body: { reason },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'ownership-transfers'] });
      setRejecting(null);
    },
  });

  const ownerColumns: Column<Ownership>[] = [
    {
      key: 'owner',
      header: t('owner.col.owner'),
      render: (row) => (
        <div>
          <div style={{ fontWeight: 600 }}>{row.companyName ?? row.ownerName}</div>
          {row.companyName ? (
            <div className="sz-muted" style={{ fontSize: 13 }}>
              {row.ownerName}
            </div>
          ) : null}
        </div>
      ),
    },
    { key: 'unit', header: t('owner.col.unit'), render: (row) => row.unitCode },
    { key: 'type', header: t('owner.col.type'), render: (row) => row.ownerType },
    {
      key: 'share',
      header: t('owner.col.share'),
      align: 'right',
      render: (row) => <span className="sz-num">{(row.shareBasisPoints / 100).toFixed(2)}%</span>,
    },
    {
      key: 'startsOn',
      header: t('owner.col.startsOn'),
      render: (row) => <span className="sz-num">{row.startsOn}</span>,
    },
    {
      key: 'status',
      header: t('owner.col.status'),
      render: (row) => (
        <StatusPill tone={row.status === 'active' ? 'success' : 'neutral'} label={row.status} />
      ),
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: '',
            align: 'right' as const,
            render: (row: Ownership) =>
              row.status === 'active' ? (
                <ActionButton
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    endOwnership.reset();
                    setEnding(row);
                  }}
                >
                  {t('owner.end.action')}
                </ActionButton>
              ) : null,
          },
        ]
      : []),
  ];

  const transferColumns: Column<Transfer>[] = [
    { key: 'unit', header: t('owner.transfer.col.unit'), render: (row) => row.unitCode },
    { key: 'type', header: t('owner.transfer.col.type'), render: (row) => row.type },
    {
      key: 'to',
      header: t('owner.transfer.col.to'),
      render: (row) =>
        row.toOwners
          .map((o) => `${o.companyName ?? o.name} (${(o.shareBasisPoints / 100).toFixed(0)}%)`)
          .join(', '),
    },
    {
      key: 'effective',
      header: t('owner.transfer.col.effective'),
      render: (row) => <span className="sz-num">{row.effectiveOn}</span>,
    },
    {
      key: 'status',
      header: t('owner.transfer.col.status'),
      render: (row) => (
        <StatusPill tone={TRANSFER_TONE[row.status]} label={row.status.replace(/_/g, ' ')} />
      ),
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: '',
            align: 'right' as const,
            render: (row: Transfer) =>
              row.status === 'seller_confirmed' ? (
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <ActionButton
                    size="sm"
                    onClick={() => {
                      approveTransfer.reset();
                      setApproving(row);
                    }}
                  >
                    {t('owner.transfer.approve')}
                  </ActionButton>
                  <ActionButton
                    variant="danger"
                    size="sm"
                    onClick={() => {
                      rejectTransfer.reset();
                      setRejecting(row);
                    }}
                  >
                    {t('owner.transfer.reject')}
                  </ActionButton>
                </div>
              ) : null,
          },
        ]
      : []),
  ];

  const pendingTransfersCount = (transfers.data ?? []).filter(
    (tr) => tr.status === 'requested' || tr.status === 'seller_confirmed',
  ).length;

  return (
    <>
      <PageHeader title={t('owner.title')} description={t('owner.description')} />

      <Tabs<TabId>
        label={t('owner.title')}
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'directory', label: t('owner.tab.directory') },
          { key: 'transfers', label: t('owner.tab.transfers', { count: pendingTransfersCount }) },
        ]}
      />

      {tab === 'directory' ? (
        <>
          <Toolbar>
            <InputField
              label={t('common.search')}
              placeholder={t('owner.search')}
              value={search}
              onChange={setSearch}
            />
            <SelectField
              label={t('owner.filter.status')}
              value={activeFilter}
              onChange={setActiveFilter}
              options={[
                { value: 'active', label: t('owner.filter.active') },
                { value: 'ended', label: t('owner.filter.ended') },
                { value: 'all', label: t('owner.filter.all') },
              ]}
            />
          </Toolbar>

          <DataTable
            caption={t('owner.tab.directory')}
            columns={ownerColumns}
            rows={list.rows}
            rowKey={(row) => row.id}
            loading={list.loading}
            error={list.error ? errorText(list.error) : null}
            onRetry={() => void list.refetch()}
            hasMore={list.hasMore}
            loadingMore={list.loadingMore}
            onLoadMore={list.loadMore}
            empty={{
              icon: 'building',
              title: t('owner.empty.title'),
              body: t('owner.empty.body'),
            }}
          />
        </>
      ) : (
        <DataTable
          caption={t('owner.tab.transfers', { count: pendingTransfersCount })}
          columns={transferColumns}
          rows={transfers.data ?? []}
          rowKey={(row) => row.id}
          loading={transfers.isPending}
          error={transfers.isError ? errorText(transfers.error) : null}
          onRetry={() => void transfers.refetch()}
          empty={{
            icon: 'fileCheck',
            title: t('owner.transfer.empty.title'),
            body: t('owner.transfer.empty.body'),
          }}
        />
      )}

      {ending ? (
        <ConfirmDialog
          title={t('owner.end.title')}
          body={t('owner.end.body')}
          confirmLabel={t('owner.end.action')}
          destructive
          reason={{ label: t('owner.end.reason'), required: true }}
          busy={endOwnership.isPending}
          error={endOwnership.isError ? errorText(endOwnership.error) : null}
          onClose={() => setEnding(null)}
          onConfirm={(reason) => endOwnership.mutate({ id: ending.id, reason: reason ?? '' })}
        />
      ) : null}

      {approving ? (
        <ConfirmDialog
          title={t('owner.transfer.approveTitle')}
          body={t('owner.transfer.approveBody')}
          confirmLabel={t('owner.transfer.approve')}
          busy={approveTransfer.isPending}
          error={approveTransfer.isError ? errorText(approveTransfer.error) : null}
          onClose={() => setApproving(null)}
          onConfirm={() => approveTransfer.mutate(approving.id)}
        />
      ) : null}

      {rejecting ? (
        <ConfirmDialog
          title={t('owner.transfer.rejectTitle')}
          body={t('owner.transfer.rejectBody')}
          confirmLabel={t('owner.transfer.reject')}
          destructive
          reason={{ label: t('owner.transfer.rejectReason'), required: true }}
          busy={rejectTransfer.isPending}
          error={rejectTransfer.isError ? errorText(rejectTransfer.error) : null}
          onClose={() => setRejecting(null)}
          onConfirm={(reason) => rejectTransfer.mutate({ id: rejecting.id, reason: reason ?? '' })}
        />
      ) : null}
    </>
  );
}
