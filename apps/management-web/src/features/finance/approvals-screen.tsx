'use client';

import { type ApiRow, unwrap } from '@safezone/api-client';
import { formatDateTime, formatKobo, t } from '@safezone/i18n';
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

type BillingRun = ApiRow<'/v1/estates/{estateId}/billing-runs', 'get'>;
type Waiver = ApiRow<'/v1/estates/{estateId}/waivers', 'get'>;
type ManualPayment = ApiRow<'/v1/estates/{estateId}/manual-payments', 'get'>;
type Refund = ApiRow<'/v1/estates/{estateId}/refunds', 'get'>;
type TabId = 'runs' | 'waivers' | 'manual' | 'refunds';

type PendingDecision =
  | { kind: 'run'; id: string; action: 'approve' }
  | { kind: 'waiver'; id: string; invoiceId: string; action: 'approve' | 'reject' }
  | { kind: 'manual'; id: string; action: 'approve' | 'reject' }
  | { kind: 'refund'; id: string; action: 'approve' | 'reject' };

export function FinancialApprovalsScreen() {
  const { estateId } = useEstate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabId>('runs');
  const [decision, setDecision] = useState<PendingDecision | null>(null);

  const runs = useQuery({
    queryKey: ['estate', estateId, 'billing-runs'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/billing-runs', { params: { path: { estateId } } })),
  });

  const waivers = useQuery({
    queryKey: ['estate', estateId, 'waivers', 'pending'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/waivers', {
          params: { path: { estateId }, query: { status: 'pending' } },
        }),
      ),
  });

  const manual = useQuery({
    queryKey: ['estate', estateId, 'manual-payments', 'pending'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/manual-payments', {
          params: { path: { estateId }, query: { status: 'pending' } },
        }),
      ),
  });

  const refunds = useQuery({
    queryKey: ['estate', estateId, 'refunds', 'pending'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/refunds', {
          params: { path: { estateId }, query: { status: 'pending' } },
        }),
      ),
  });

  const pendingRuns = (runs.data ?? []).filter((r) => r.status === 'awaiting_approval');

  const act = useMutation({
    mutationFn: async ({
      target,
      reason,
    }: {
      target: PendingDecision;
      reason?: string;
    }): Promise<unknown> => {
      if (target.kind === 'run') {
        return unwrap(
          api.POST('/v1/estates/{estateId}/billing-runs/{id}/approve', {
            params: { path: { estateId, id: target.id } },
          }),
        );
      }
      if (target.kind === 'waiver') {
        return target.action === 'approve'
          ? unwrap(
              api.POST('/v1/estates/{estateId}/invoices/{id}/waivers/{waiverId}/approve', {
                params: { path: { estateId, id: target.invoiceId, waiverId: target.id } },
                body: {},
              }),
            )
          : unwrap(
              api.POST('/v1/estates/{estateId}/invoices/{id}/waivers/{waiverId}/reject', {
                params: { path: { estateId, id: target.invoiceId, waiverId: target.id } },
                body: { reason: reason ?? '' },
              }),
            );
      }
      if (target.kind === 'manual') {
        return target.action === 'approve'
          ? unwrap(
              api.POST('/v1/estates/{estateId}/manual-payments/{id}/approve', {
                params: { path: { estateId, id: target.id } },
                body: {},
              }),
            )
          : unwrap(
              api.POST('/v1/estates/{estateId}/manual-payments/{id}/reject', {
                params: { path: { estateId, id: target.id } },
                body: { reason: reason ?? '' },
              }),
            );
      }
      return target.action === 'approve'
        ? unwrap(
            api.POST('/v1/estates/{estateId}/refunds/{id}/approve', {
              params: { path: { estateId, id: target.id } },
              body: {},
            }),
          )
        : unwrap(
            api.POST('/v1/estates/{estateId}/refunds/{id}/reject', {
              params: { path: { estateId, id: target.id } },
              body: { reason: reason ?? '' },
            }),
          );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'billing-runs'] });
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'waivers'] });
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'manual-payments'] });
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'refunds'] });
      setDecision(null);
    },
  });

  const runCols: Column<BillingRun>[] = [
    { key: 'name', header: 'Run', render: (r) => r.label },
    {
      key: 'period',
      header: 'Period',
      render: (r) => (
        <span className="sz-num">
          {r.periodStart} to {r.periodEnd}
        </span>
      ),
    },
    {
      key: 'due',
      header: 'Due date',
      render: (r) => <span className="sz-num">{r.dueDate}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => (
        <ActionButton
          size="sm"
          onClick={() => {
            act.reset();
            setDecision({ kind: 'run', id: r.id, action: 'approve' });
          }}
        >
          {t('approvals.approve')}
        </ActionButton>
      ),
    },
  ];

  const waiverCols: Column<Waiver>[] = [
    {
      key: 'amount',
      header: 'Amount',
      render: (r) => <span className="sz-num">{formatKobo(r.amount)}</span>,
    },
    { key: 'reason', header: t('approvals.reason'), render: (r) => r.reason },
    {
      key: 'createdAt',
      header: 'Requested',
      render: (r) => <span className="sz-num">{formatDateTime(r.createdAt)}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <ActionButton
            size="sm"
            onClick={() => {
              act.reset();
              setDecision({ kind: 'waiver', id: r.id, invoiceId: r.invoiceId, action: 'approve' });
            }}
          >
            {t('approvals.approve')}
          </ActionButton>
          <ActionButton
            variant="danger"
            size="sm"
            onClick={() => {
              act.reset();
              setDecision({ kind: 'waiver', id: r.id, invoiceId: r.invoiceId, action: 'reject' });
            }}
          >
            {t('approvals.reject')}
          </ActionButton>
        </div>
      ),
    },
  ];

  const manualCols: Column<ManualPayment>[] = [
    {
      key: 'amount',
      header: 'Amount',
      render: (r) => <span className="sz-num">{formatKobo(r.amount)}</span>,
    },
    {
      key: 'method',
      header: 'Method',
      render: (r) => <StatusPill tone="neutral" label={r.method} />,
    },
    { key: 'ref', header: 'Reference', render: (r) => r.reference ?? '-' },
    {
      key: 'receivedOn',
      header: 'Received',
      render: (r) => <span className="sz-num">{r.receivedOn}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <ActionButton
            size="sm"
            onClick={() => {
              act.reset();
              setDecision({ kind: 'manual', id: r.id, action: 'approve' });
            }}
          >
            {t('approvals.approve')}
          </ActionButton>
          <ActionButton
            variant="danger"
            size="sm"
            onClick={() => {
              act.reset();
              setDecision({ kind: 'manual', id: r.id, action: 'reject' });
            }}
          >
            {t('approvals.reject')}
          </ActionButton>
        </div>
      ),
    },
  ];

  const refundCols: Column<Refund>[] = [
    {
      key: 'amount',
      header: 'Amount',
      render: (r) => <span className="sz-num">{formatKobo(r.amount)}</span>,
    },
    { key: 'reason', header: t('approvals.reason'), render: (r) => r.reason },
    {
      key: 'createdAt',
      header: 'Requested',
      render: (r) => <span className="sz-num">{formatDateTime(r.createdAt)}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <ActionButton
            size="sm"
            onClick={() => {
              act.reset();
              setDecision({ kind: 'refund', id: r.id, action: 'approve' });
            }}
          >
            {t('approvals.approve')}
          </ActionButton>
          <ActionButton
            variant="danger"
            size="sm"
            onClick={() => {
              act.reset();
              setDecision({ kind: 'refund', id: r.id, action: 'reject' });
            }}
          >
            {t('approvals.reject')}
          </ActionButton>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader title={t('approvals.title')} description={t('approvals.description')} />

      <Tabs<TabId>
        label={t('approvals.title')}
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'runs', label: t('approvals.tab.runs', { count: pendingRuns.length }) },
          {
            key: 'waivers',
            label: t('approvals.tab.waivers', { count: waivers.data?.length ?? 0 }),
          },
          {
            key: 'manual',
            label: t('approvals.tab.manual', { count: manual.data?.length ?? 0 }),
          },
          {
            key: 'refunds',
            label: t('approvals.tab.refunds', { count: refunds.data?.length ?? 0 }),
          },
        ]}
      />

      {tab === 'runs' ? (
        <DataTable
          caption={t('approvals.tab.runs', { count: pendingRuns.length })}
          columns={runCols}
          rows={pendingRuns}
          rowKey={(r) => r.id}
          loading={runs.isPending}
          error={runs.isError ? errorText(runs.error) : null}
          onRetry={() => void runs.refetch()}
          empty={{ icon: 'fileCheck', title: t('approvals.title'), body: t('approvals.empty') }}
        />
      ) : null}

      {tab === 'waivers' ? (
        <DataTable
          caption={t('approvals.tab.waivers', { count: waivers.data?.length ?? 0 })}
          columns={waiverCols}
          rows={waivers.data ?? []}
          rowKey={(r) => r.id}
          loading={waivers.isPending}
          error={waivers.isError ? errorText(waivers.error) : null}
          onRetry={() => void waivers.refetch()}
          empty={{ icon: 'fileCheck', title: t('approvals.title'), body: t('approvals.empty') }}
        />
      ) : null}

      {tab === 'manual' ? (
        <DataTable
          caption={t('approvals.tab.manual', { count: manual.data?.length ?? 0 })}
          columns={manualCols}
          rows={manual.data ?? []}
          rowKey={(r) => r.id}
          loading={manual.isPending}
          error={manual.isError ? errorText(manual.error) : null}
          onRetry={() => void manual.refetch()}
          empty={{ icon: 'fileCheck', title: t('approvals.title'), body: t('approvals.empty') }}
        />
      ) : null}

      {tab === 'refunds' ? (
        <DataTable
          caption={t('approvals.tab.refunds', { count: refunds.data?.length ?? 0 })}
          columns={refundCols}
          rows={refunds.data ?? []}
          rowKey={(r) => r.id}
          loading={refunds.isPending}
          error={refunds.isError ? errorText(refunds.error) : null}
          onRetry={() => void refunds.refetch()}
          empty={{ icon: 'fileCheck', title: t('approvals.title'), body: t('approvals.empty') }}
        />
      ) : null}

      {decision ? (
        <ConfirmDialog
          title={decision.action === 'approve' ? t('approvals.approve') : t('approvals.reject')}
          body={
            decision.action === 'approve'
              ? 'Confirm approval? Financial approvals are recorded in the immutable audit log.'
              : 'Reject this financial request?'
          }
          confirmLabel={
            decision.action === 'approve' ? t('approvals.approve') : t('approvals.reject')
          }
          destructive={decision.action === 'reject'}
          reason={
            decision.action === 'reject'
              ? { label: t('approvals.reason'), required: true }
              : undefined
          }
          busy={act.isPending}
          error={act.isError ? errorText(act.error) : null}
          onClose={() => setDecision(null)}
          onConfirm={(reason) => act.mutate({ target: decision, reason })}
        />
      ) : null}
    </>
  );
}
