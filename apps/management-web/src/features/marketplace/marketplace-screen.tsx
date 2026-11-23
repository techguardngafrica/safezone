'use client';

import { type ApiData, type ApiRow, unwrap, unwrapPage } from '@safezone/api-client';
import { formatDateTime, type MessageKey, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  type Column,
  DataTable,
  Dialog,
  ErrorState,
  FormError,
  InputField,
  PageHeader,
  SelectField,
  StatCard,
  StatusPill,
  Tabs,
  TextAreaField,
  Toolbar,
  type Tone,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useEstate } from '../../../lib/estate';
import { errorText } from '../../../lib/errors';
import { usePaged } from '../../../lib/paged';
import { api } from '../../../lib/session';

type EstateVendorRow = ApiData<
  '/v1/estates/{estateId}/marketplace/vendor-approvals',
  'get'
>[number];
type Overview = ApiData<'/v1/estates/{estateId}/marketplace/overview', 'get'>;
type VendorVolumeRow = Overview['byVendor'][number];
type EstateDisputeRow = ApiRow<'/v1/estates/{estateId}/marketplace/disputes', 'get'>;

type TabId = 'vendors' | 'orders' | 'disputes';
type ApprovalFilter = 'all' | 'approved' | 'undecided' | 'blocked';
type DisputeStatusFilter = '' | 'open' | 'resolved';

const APPROVAL_TONE: Record<string, Tone> = {
  approved: 'success',
  blocked: 'danger',
};

const DISPUTE_TONE: Record<string, Tone> = {
  open: 'warning',
  resolved: 'success',
};

function BlockVendorDialog({
  vendor,
  onClose,
}: {
  vendor: EstateVendorRow['vendor'];
  onClose: () => void;
}) {
  const { estateId } = useEstate();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');

  const block = useMutation({
    mutationFn: () =>
      unwrap(
        api.PUT('/v1/estates/{estateId}/marketplace/vendor-approvals', {
          params: { path: { estateId } },
          body: {
            vendorId: vendor.id,
            status: 'blocked',
            reason: reason.trim() || undefined,
          },
        }),
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(['estate', estateId, 'marketplace', 'vendors'], data);
      onClose();
    },
  });

  return (
    <Dialog
      title={t('mw.marketplace.block.title', { name: vendor.name })}
      onClose={onClose}
      onSubmit={() => block.mutate()}
      actions={
        <>
          <ActionButton variant="text" onClick={onClose}>
            {t('common.cancel')}
          </ActionButton>
          <ActionButton type="submit" variant="danger" busy={block.isPending}>
            {t('mw.marketplace.block.confirm')}
          </ActionButton>
        </>
      }
    >
      <div className="sz-form">
        <p style={{ margin: 0 }}>{t('mw.marketplace.block.body')}</p>
        <TextAreaField
          label={t('mw.marketplace.block.reason')}
          value={reason}
          onChange={setReason}
          rows={3}
          maxLength={500}
        />
        <FormError message={block.isError ? errorText(block.error) : null} />
      </div>
    </Dialog>
  );
}

/** Estate Marketplace oversight: vendor approvals, order volume and disputes (management-web.md §6.11). */
export function MarketplaceScreen() {
  const { estateId } = useEstate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabId>('vendors');
  const [search, setSearch] = useState('');
  const [approvalFilter, setApprovalFilter] = useState<ApprovalFilter>('all');
  const [disputeStatus, setDisputeStatus] = useState<DisputeStatusFilter>('');
  const [blockingVendor, setBlockingVendor] = useState<EstateVendorRow['vendor'] | null>(null);

  const vendorsQuery = useQuery({
    queryKey: ['estate', estateId, 'marketplace', 'vendors'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/marketplace/vendor-approvals', {
          params: { path: { estateId } },
        }),
      ),
  });

  const overviewQuery = useQuery({
    queryKey: ['estate', estateId, 'marketplace', 'overview'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/marketplace/overview', {
          params: { path: { estateId } },
        }),
      ),
  });

  const disputesList = usePaged<EstateDisputeRow>(
    ['estate', estateId, 'marketplace', 'disputes', disputeStatus],
    (cursor) =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/marketplace/disputes', {
          params: {
            path: { estateId },
            query: {
              ...(disputeStatus ? { status: disputeStatus } : {}),
              limit: 30,
              cursor,
            },
          },
        }),
      ),
    { enabled: tab === 'disputes' },
  );

  const approveMutation = useMutation({
    mutationFn: (vendorId: string) =>
      unwrap(
        api.PUT('/v1/estates/{estateId}/marketplace/vendor-approvals', {
          params: { path: { estateId } },
          body: { vendorId, status: 'approved' },
        }),
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(['estate', estateId, 'marketplace', 'vendors'], data);
    },
  });

  const ordersByVendor = useMemo(() => {
    const map = new Map<string, VendorVolumeRow>();
    for (const row of overviewQuery.data?.byVendor ?? []) {
      map.set(row.vendorId, row);
    }
    return map;
  }, [overviewQuery.data]);

  const approvedCount = useMemo(
    () => (vendorsQuery.data ?? []).filter((row) => row.status === 'approved').length,
    [vendorsQuery.data],
  );

  const filteredVendors = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (vendorsQuery.data ?? []).filter((row) => {
      if (approvalFilter === 'approved' && row.status !== 'approved') return false;
      if (approvalFilter === 'blocked' && row.status !== 'blocked') return false;
      if (approvalFilter === 'undecided' && row.status !== null) return false;
      if (!needle) return true;
      return (
        row.vendor.name.toLowerCase().includes(needle) ||
        row.vendor.description.toLowerCase().includes(needle)
      );
    });
  }, [vendorsQuery.data, search, approvalFilter]);

  const vendorColumns: Column<EstateVendorRow>[] = [
    {
      key: 'vendor',
      header: t('mw.marketplace.col.vendor'),
      render: (row) => (
        <div>
          <strong>{row.vendor.name}</strong>
          <div className="sz-muted" style={{ fontSize: 12 }}>
            {row.vendor.description}
          </div>
        </div>
      ),
    },
    {
      key: 'type',
      header: t('mw.marketplace.col.type'),
      render: (row) => t(`mw.marketplace.type.${row.vendor.type}` as MessageKey),
    },
    {
      key: 'rating',
      header: t('mw.marketplace.col.rating'),
      render: (row) =>
        row.vendor.ratingAvg !== null && row.vendor.ratingCount > 0 ? (
          <span className="sz-num">
            {t('mw.marketplace.rating.value', {
              avg: row.vendor.ratingAvg.toFixed(1),
              count: row.vendor.ratingCount,
            })}
          </span>
        ) : (
          <span className="sz-muted">{t('mw.marketplace.rating.none')}</span>
        ),
    },
    {
      key: 'orders',
      header: t('mw.marketplace.col.orders'),
      align: 'right',
      render: (row) => (
        <span className="sz-num">{ordersByVendor.get(row.vendor.id)?.orderCount ?? 0}</span>
      ),
    },
    {
      key: 'status',
      header: t('mw.marketplace.col.status'),
      render: (row) => (
        <StatusPill
          tone={row.status ? (APPROVAL_TONE[row.status] ?? 'neutral') : 'neutral'}
          label={
            row.status === 'approved'
              ? t('mw.marketplace.filter.approved')
              : row.status === 'blocked'
                ? t('mw.marketplace.filter.blocked')
                : t('mw.marketplace.filter.undecided')
          }
        />
      ),
    },
    {
      key: 'decidedAt',
      header: t('mw.marketplace.col.decidedAt'),
      render: (row) =>
        row.decidedAt ? (
          <span className="sz-num">{formatDateTime(row.decidedAt)}</span>
        ) : (
          <span className="sz-muted">-</span>
        ),
    },
    {
      key: 'actions',
      header: t('mw.marketplace.col.actions'),
      render: (row) => (
        <div style={{ display: 'flex', gap: 8 }}>
          {row.status !== 'approved' ? (
            <ActionButton
              size="sm"
              variant="outline"
              busy={approveMutation.isPending && approveMutation.variables === row.vendor.id}
              onClick={() => approveMutation.mutate(row.vendor.id)}
            >
              {t('mw.marketplace.action.approve')}
            </ActionButton>
          ) : null}
          {row.status !== 'blocked' ? (
            <ActionButton size="sm" variant="text" onClick={() => setBlockingVendor(row.vendor)}>
              {t('mw.marketplace.action.block')}
            </ActionButton>
          ) : null}
        </div>
      ),
    },
  ];

  const volumeColumns: Column<VendorVolumeRow>[] = [
    { key: 'vendor', header: t('mw.marketplace.col.vendor'), render: (row) => row.vendorName },
    {
      key: 'orders',
      header: t('mw.marketplace.col.orders'),
      align: 'right',
      render: (row) => <span className="sz-num">{row.orderCount}</span>,
    },
    {
      key: 'completed',
      header: t('mw.marketplace.orders.col.completed'),
      align: 'right',
      render: (row) => <span className="sz-num">{row.completedCount}</span>,
    },
    {
      key: 'openDisputes',
      header: t('mw.marketplace.orders.col.openDisputes'),
      align: 'right',
      render: (row) =>
        row.openDisputeCount > 0 ? (
          <StatusPill tone="warning" label={String(row.openDisputeCount)} />
        ) : (
          <span className="sz-num">0</span>
        ),
    },
  ];

  const disputeColumns: Column<EstateDisputeRow>[] = [
    {
      key: 'createdAt',
      header: t('mw.marketplace.disputes.col.created'),
      render: (row) => <span className="sz-num">{formatDateTime(row.createdAt)}</span>,
    },
    { key: 'vendor', header: t('mw.marketplace.col.vendor'), render: (row) => row.vendorName },
    {
      key: 'listing',
      header: t('mw.marketplace.disputes.col.listing'),
      render: (row) => row.listingTitle,
    },
    {
      key: 'reason',
      header: t('mw.marketplace.disputes.col.reason'),
      render: (row) => (
        <div>
          <div>{row.reason}</div>
          {row.note ? (
            <div className="sz-muted" style={{ fontSize: 12 }}>
              {row.note}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'status',
      header: t('mw.marketplace.col.status'),
      render: (row) => (
        <StatusPill
          tone={DISPUTE_TONE[row.status] ?? 'neutral'}
          label={
            row.status === 'open'
              ? t('mw.marketplace.disputes.filter.open')
              : t('mw.marketplace.disputes.filter.resolved')
          }
        />
      ),
    },
    {
      key: 'resolution',
      header: t('mw.marketplace.disputes.col.resolution'),
      render: (row) =>
        row.resolution
          ? t(`mw.marketplace.disputes.resolution.${row.resolution}` as MessageKey)
          : t('mw.marketplace.disputes.resolution.pending'),
    },
    {
      key: 'resolvedAt',
      header: t('mw.marketplace.disputes.col.resolvedAt'),
      render: (row) =>
        row.resolvedAt ? (
          <span className="sz-num">{formatDateTime(row.resolvedAt)}</span>
        ) : (
          <span className="sz-muted">-</span>
        ),
    },
  ];

  return (
    <>
      <PageHeader title={t('mw.marketplace.title')} description={t('mw.marketplace.description')} />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 16,
          marginBottom: 20,
        }}
      >
        <StatCard label={t('mw.marketplace.kpi.approvedVendors')} value={approvedCount} />
        <StatCard
          label={t('mw.marketplace.kpi.totalOrders')}
          value={overviewQuery.data?.totalOrders ?? 0}
        />
        <StatCard
          label={t('mw.marketplace.kpi.activeOrders')}
          value={overviewQuery.data?.activeOrders ?? 0}
        />
        <StatCard
          label={t('mw.marketplace.kpi.openDisputes')}
          value={overviewQuery.data?.openDisputes ?? 0}
        />
      </div>

      <FormError message={approveMutation.isError ? errorText(approveMutation.error) : null} />

      <Tabs<TabId>
        label={t('mw.marketplace.title')}
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'vendors', label: t('mw.marketplace.tab.vendors') },
          { key: 'orders', label: t('mw.marketplace.tab.orders') },
          { key: 'disputes', label: t('mw.marketplace.tab.disputes') },
        ]}
      />

      {tab === 'vendors' ? (
        <>
          <Toolbar>
            <InputField
              label={t('mw.marketplace.filter.search')}
              value={search}
              onChange={setSearch}
            />
            <SelectField<ApprovalFilter>
              label={t('mw.marketplace.filter.status')}
              value={approvalFilter}
              onChange={setApprovalFilter}
              options={[
                { value: 'all', label: t('mw.marketplace.filter.all') },
                { value: 'approved', label: t('mw.marketplace.filter.approved') },
                { value: 'undecided', label: t('mw.marketplace.filter.undecided') },
                { value: 'blocked', label: t('mw.marketplace.filter.blocked') },
              ]}
            />
          </Toolbar>
          {vendorsQuery.isError ? (
            <ErrorState
              message={errorText(vendorsQuery.error)}
              onRetry={() => void vendorsQuery.refetch()}
            />
          ) : (
            <DataTable
              caption={t('mw.marketplace.tab.vendors')}
              loading={vendorsQuery.isPending}
              rows={filteredVendors}
              rowKey={(row) => row.vendor.id}
              columns={vendorColumns}
              empty={{
                icon: 'store',
                title: t('mw.marketplace.tab.vendors'),
                body: t('mw.marketplace.empty.vendors'),
              }}
            />
          )}
        </>
      ) : null}

      {tab === 'orders' ? (
        <div style={{ display: 'grid', gap: 16 }}>
          <Banner tone="info">{t('mw.marketplace.orders.note')}</Banner>
          {overviewQuery.isError ? (
            <ErrorState
              message={errorText(overviewQuery.error)}
              onRetry={() => void overviewQuery.refetch()}
            />
          ) : (
            <>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: 16,
                }}
              >
                <StatCard
                  label={t('mw.marketplace.orders.kpi.active')}
                  value={overviewQuery.data?.activeOrders ?? 0}
                />
                <StatCard
                  label={t('mw.marketplace.orders.kpi.completed')}
                  value={overviewQuery.data?.completedOrders ?? 0}
                />
                <StatCard
                  label={t('mw.marketplace.orders.kpi.cancelled')}
                  value={overviewQuery.data?.cancelledOrders ?? 0}
                />
                <StatCard
                  label={t('mw.marketplace.orders.kpi.disputed')}
                  value={overviewQuery.data?.disputedOrders ?? 0}
                />
              </div>
              <DataTable
                caption={t('mw.marketplace.tab.orders')}
                loading={overviewQuery.isPending}
                rows={overviewQuery.data?.byVendor ?? []}
                rowKey={(row) => row.vendorId}
                columns={volumeColumns}
                empty={{
                  icon: 'store',
                  title: t('mw.marketplace.tab.orders'),
                  body: t('mw.marketplace.empty.orders'),
                }}
              />
            </>
          )}
        </div>
      ) : null}

      {tab === 'disputes' ? (
        <>
          <Toolbar>
            <SelectField<DisputeStatusFilter>
              label={t('mw.marketplace.disputes.filter.status')}
              value={disputeStatus}
              onChange={setDisputeStatus}
              options={[
                { value: '', label: t('mw.marketplace.filter.all') },
                { value: 'open', label: t('mw.marketplace.disputes.filter.open') },
                { value: 'resolved', label: t('mw.marketplace.disputes.filter.resolved') },
              ]}
            />
          </Toolbar>
          <DataTable
            caption={t('mw.marketplace.tab.disputes')}
            loading={disputesList.loading}
            error={disputesList.error ? errorText(disputesList.error) : null}
            onRetry={() => void disputesList.refetch()}
            rows={disputesList.rows}
            rowKey={(row) => row.id}
            columns={disputeColumns}
            hasMore={disputesList.hasMore}
            loadingMore={disputesList.loadingMore}
            onLoadMore={disputesList.loadMore}
            empty={{
              icon: 'shield',
              title: t('mw.marketplace.tab.disputes'),
              body: t('mw.marketplace.empty.disputes'),
            }}
          />
        </>
      ) : null}

      {blockingVendor ? (
        <BlockVendorDialog vendor={blockingVendor} onClose={() => setBlockingVendor(null)} />
      ) : null}
    </>
  );
}
