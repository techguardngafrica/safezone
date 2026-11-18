'use client';

import { unwrap, unwrapPage } from '@safezone/api-client';
import { formatDate, formatDateTime, formatKobo, type MessageKey, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  CheckboxField,
  type Column,
  ConfirmDialog,
  DataTable,
  DetailList,
  Dialog,
  Drawer,
  FormError,
  InputField,
  PageHeader,
  StatusPill,
  Tabs,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useEstate } from '../../../lib/estate';
import { errorText, formErrors } from '../../../lib/errors';
import { usePaged } from '../../../lib/paged';
import { api } from '../../../lib/session';
import {
  type BillingRun,
  type BillingRunItem,
  type Charge,
  periodText,
  runStatusLabel,
  runTone,
  todayWatDate,
} from './finance-labels';

type RunField = 'label' | 'periodStart' | 'periodEnd' | 'dueDate' | 'chargeIds';
const RUN_FIELD_PATHS: Record<string, RunField> = {
  label: 'label',
  periodStart: 'periodStart',
  periodEnd: 'periodEnd',
  dueDate: 'dueDate',
  chargeIds: 'chargeIds',
};

/** First and last day of next month, as YYYY-MM-DD (a sensible default period). */
function nextMonth(today: string): { start: string; end: string } {
  const [year = 2027, month = 1] = today.split('-').map(Number);
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function useCharges() {
  const { estateId } = useEstate();
  return useQuery({
    queryKey: ['estate', estateId, 'charges', 'active'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/charges', {
          params: { path: { estateId }, query: { status: 'active' } },
        }),
      ),
  });
}

function NewRunDialog({
  charges,
  onClose,
  onCreated,
}: {
  charges: Charge[];
  onClose: () => void;
  onCreated: (run: BillingRun) => void;
}) {
  const { estateId } = useEstate();
  const queryClient = useQueryClient();
  const period = nextMonth(todayWatDate());
  const [label, setLabel] = useState('');
  const [periodStart, setPeriodStart] = useState(period.start);
  const [periodEnd, setPeriodEnd] = useState(period.end);
  const [dueDate, setDueDate] = useState(period.start);
  const [chargeIds, setChargeIds] = useState<string[]>(charges.map((charge) => charge.id));
  const [errors, setErrors] = useState<Partial<Record<RunField, string>>>({});
  const [other, setOther] = useState<string[]>([]);

  const create = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/billing-runs', {
          params: { path: { estateId } },
          body: { label: label.trim(), periodStart, periodEnd, dueDate, chargeIds },
        }),
      ),
    onSuccess: (run) => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'billing-runs'] });
      onCreated(run);
    },
    onError: (error) => {
      const server = formErrors(error, RUN_FIELD_PATHS);
      setErrors(server.fields);
      setOther(server.other);
    },
  });

  const submit = () => {
    setOther([]);
    const next: Partial<Record<RunField, string>> = {};
    if (label.trim().length < 2) next.label = t('finance.nameRequired');
    if (!periodStart) next.periodStart = t('finance.dateRequired');
    if (!periodEnd) next.periodEnd = t('finance.dateRequired');
    else if (periodStart && periodEnd < periodStart) next.periodEnd = t('run.form.periodInvalid');
    if (!dueDate) next.dueDate = t('finance.dateRequired');
    else if (periodStart && dueDate < periodStart) next.dueDate = t('run.form.dueInvalid');
    if (chargeIds.length === 0) next.chargeIds = t('run.form.chargesRequired');
    setErrors(next);
    if (Object.keys(next).length === 0) create.mutate();
  };

  return (
    <Dialog
      wide
      title={t('run.new')}
      onClose={onClose}
      onSubmit={submit}
      actions={
        <>
          <ActionButton variant="text" onClick={onClose}>
            {t('common.cancel')}
          </ActionButton>
          <ActionButton type="submit" busy={create.isPending}>
            {t('run.form.create')}
          </ActionButton>
        </>
      }
    >
      <div className="sz-form">
        <InputField
          label={t('run.form.label')}
          placeholder={t('run.form.labelPlaceholder')}
          value={label}
          onChange={setLabel}
          error={errors.label}
          maxLength={120}
          autoFocus
        />
        <div className="sz-form-2">
          <InputField
            type="date"
            label={t('run.form.periodStart')}
            value={periodStart}
            onChange={setPeriodStart}
            error={errors.periodStart}
          />
          <InputField
            type="date"
            label={t('run.form.periodEnd')}
            value={periodEnd}
            onChange={setPeriodEnd}
            error={errors.periodEnd}
            min={periodStart}
          />
          <InputField
            type="date"
            label={t('run.form.dueDate')}
            value={dueDate}
            onChange={setDueDate}
            error={errors.dueDate}
            min={periodStart}
          />
        </div>
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 4 }}>
          <legend style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
            {t('run.form.charges')}
          </legend>
          {charges.map((charge) => (
            <CheckboxField
              key={charge.id}
              label={`${charge.name} · ${t(`charge.frequency.${charge.frequency}` as MessageKey)}`}
              checked={chargeIds.includes(charge.id)}
              onChange={(checked) =>
                setChargeIds((current) =>
                  checked ? [...current, charge.id] : current.filter((id) => id !== charge.id),
                )
              }
            />
          ))}
          <FormError message={errors.chargeIds} />
        </fieldset>
        {other.map((message) => (
          <FormError key={message} message={message} />
        ))}
        <FormError
          message={
            create.isError && Object.keys(errors).length === 0 && other.length === 0
              ? errorText(create.error)
              : null
          }
        />
      </div>
    </Dialog>
  );
}

type Step = 'preview' | 'submit' | 'approve' | 'issue' | 'cancel';

function RunItems({ run }: { run: BillingRun }) {
  const { estateId } = useEstate();
  const [skipped, setSkipped] = useState(false);
  const items = usePaged<BillingRunItem>(
    ['estate', estateId, 'billing-runs', run.id, 'items', skipped, run.totals?.invoices ?? null],
    (cursor) =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/billing-runs/{id}/items', {
          params: {
            path: { estateId, id: run.id },
            query: { skipped: skipped ? 'true' : 'false', limit: 50, cursor },
          },
        }),
      ),
    { enabled: run.totals !== null },
  );
  if (!run.totals)
    return (
      <p className="sz-muted" style={{ fontSize: 14 }}>
        {t('run.item.notPreviewed')}
      </p>
    );
  const columns: Column<BillingRunItem>[] = [
    {
      key: 'unit',
      header: t('run.item.col.unit'),
      render: (row) => <strong>{row.unitCode}</strong>,
    },
    {
      key: 'payer',
      header: t('run.item.col.payer'),
      render: (row) => row.payerName ?? <span className="sz-muted">-</span>,
    },
    skipped
      ? {
          key: 'reason',
          header: t('run.item.col.reason'),
          render: (row) => (row.skipReason ? t(`run.skip.${row.skipReason}` as MessageKey) : '-'),
        }
      : {
          key: 'amount',
          header: t('run.item.col.amount'),
          align: 'right',
          render: (row) => (
            <span className="sz-num" title={row.lines.map((line) => line.description).join(', ')}>
              {formatKobo(row.amount)}
            </span>
          ),
        },
  ];
  return (
    <>
      <Tabs
        label={t('run.detail.items')}
        value={skipped ? 'skipped' : 'billed'}
        onChange={(key) => setSkipped(key === 'skipped')}
        tabs={[
          {
            key: 'billed',
            label: `${t('run.detail.showBilled')} (${run.totals.invoices})`,
          },
          {
            key: 'skipped',
            label: `${t('run.detail.showSkipped')} (${run.totals.skippedUnits})`,
          },
        ]}
      />
      <DataTable
        caption={t('run.detail.items')}
        columns={columns}
        rows={items.rows}
        rowKey={(row) => row.spaceId}
        loading={items.loading}
        error={items.error ? errorText(items.error) : null}
        onRetry={items.refetch}
        hasMore={items.hasMore}
        loadingMore={items.loadingMore}
        onLoadMore={items.loadMore}
        empty={{ title: t('run.item.empty') }}
      />
    </>
  );
}

function RunDrawer({
  runId,
  charges,
  onClose,
}: {
  runId: string;
  charges: Charge[];
  onClose: () => void;
}) {
  const { estateId, can } = useEstate();
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState<'approve' | 'issue' | 'cancel' | null>(null);
  const runQuery = useQuery({
    queryKey: ['estate', estateId, 'billing-runs', runId],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/billing-runs/{id}', {
          params: { path: { estateId, id: runId } },
        }),
      ),
  });
  const step = useMutation({
    mutationFn: ({ action, reason }: { action: Step; reason?: string }) => {
      const params = { path: { estateId, id: runId } };
      switch (action) {
        case 'preview':
          return unwrap(api.POST('/v1/estates/{estateId}/billing-runs/{id}/preview', { params }));
        case 'submit':
          return unwrap(api.POST('/v1/estates/{estateId}/billing-runs/{id}/submit', { params }));
        case 'approve':
          return unwrap(api.POST('/v1/estates/{estateId}/billing-runs/{id}/approve', { params }));
        case 'issue':
          return unwrap(api.POST('/v1/estates/{estateId}/billing-runs/{id}/issue', { params }));
        case 'cancel':
          return unwrap(
            api.POST('/v1/estates/{estateId}/billing-runs/{id}/cancel', {
              params,
              body: { reason: reason ?? '' },
            }),
          );
      }
    },
    onSuccess: (run, { action }) => {
      queryClient.setQueryData(['estate', estateId, 'billing-runs', runId], run);
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'billing-runs'] });
      if (action === 'issue')
        void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'invoices'] });
      setConfirm(null);
    },
  });

  const run = runQuery.data;
  const canCreate = can('billing.run.create');
  const canApprove = can('billing.run.approve');
  const busy = (action: Step) => step.isPending && step.variables?.action === action;
  const chargeNames = run
    ? run.chargeIds
        .map((id) => charges.find((charge) => charge.id === id)?.name ?? null)
        .filter((name): name is string => name !== null)
    : [];

  return (
    <Drawer title={run?.label ?? t('run.title')} onClose={onClose}>
      {runQuery.isError ? <Banner tone="danger">{errorText(runQuery.error)}</Banner> : null}
      {run ? (
        <div style={{ display: 'grid', gap: 16 }}>
          <div>
            <StatusPill tone={runTone(run.status)} label={runStatusLabel(run.status)} />
          </div>
          <DetailList
            items={[
              {
                label: t('run.detail.period'),
                value: periodText(run.periodStart, run.periodEnd, formatDate),
              },
              { label: t('run.detail.due'), value: formatDate(run.dueDate) },
              {
                label: t('run.detail.charges'),
                value: chargeNames.length > 0 ? chargeNames.join(', ') : run.chargeIds.length,
              },
              ...(run.totals
                ? [
                    { label: t('run.detail.invoices'), value: run.totals.invoices },
                    {
                      label: t('run.detail.total'),
                      value: <span className="sz-num">{formatKobo(run.totals.amount)}</span>,
                    },
                    { label: t('run.detail.skipped'), value: run.totals.skippedUnits },
                  ]
                : []),
              ...(run.issuedAt
                ? [{ label: t('run.detail.issuedAt'), value: formatDateTime(run.issuedAt) }]
                : []),
              ...(run.cancelReason
                ? [{ label: t('run.detail.cancelReason'), value: run.cancelReason }]
                : []),
            ]}
          />
          {run.status === 'draft' ? (
            <p className="sz-muted" style={{ margin: 0, fontSize: 14 }}>
              {t('run.detail.draftHelp')}
            </p>
          ) : null}
          {run.status === 'previewed' ? (
            <p className="sz-muted" style={{ margin: 0, fontSize: 14 }}>
              {t('run.detail.previewHelp')}
            </p>
          ) : null}
          {run.status === 'awaiting_approval' ? (
            <Banner tone="info">{t('run.detail.awaitingHelp')}</Banner>
          ) : null}
          {run.status === 'approved' ? (
            <Banner tone="info">{t('run.detail.approvedHelp')}</Banner>
          ) : null}
          {step.isError && !confirm ? <Banner tone="danger">{errorText(step.error)}</Banner> : null}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {canCreate && (run.status === 'draft' || run.status === 'previewed') ? (
              <ActionButton
                variant={run.status === 'draft' ? 'primary' : 'outline'}
                icon="refresh"
                busy={busy('preview')}
                onClick={() => step.mutate({ action: 'preview' })}
              >
                {run.status === 'draft' ? t('run.preview') : t('run.previewAgain')}
              </ActionButton>
            ) : null}
            {canCreate && run.status === 'previewed' ? (
              <ActionButton busy={busy('submit')} onClick={() => step.mutate({ action: 'submit' })}>
                {t('run.submit')}
              </ActionButton>
            ) : null}
            {canApprove && run.status === 'awaiting_approval' ? (
              <ActionButton icon="check" onClick={() => setConfirm('approve')}>
                {t('run.approve')}
              </ActionButton>
            ) : null}
            {canCreate && run.status === 'approved' ? (
              <ActionButton icon="fileText" onClick={() => setConfirm('issue')}>
                {t('run.issue')}
              </ActionButton>
            ) : null}
            {canCreate && run.status !== 'issued' && run.status !== 'cancelled' ? (
              <ActionButton variant="text" onClick={() => setConfirm('cancel')}>
                {t('run.cancel')}
              </ActionButton>
            ) : null}
          </div>
          <h3 style={{ margin: 0, fontSize: 16 }}>{t('run.detail.items')}</h3>
          <RunItems run={run} />
        </div>
      ) : null}
      {run && confirm === 'approve' ? (
        <ConfirmDialog
          title={t('run.approve.title', { label: run.label })}
          body={t('run.approve.body', {
            count: run.totals?.invoices ?? 0,
            amount: formatKobo(run.totals?.amount ?? 0),
          })}
          confirmLabel={t('run.approve')}
          busy={busy('approve')}
          error={step.isError ? errorText(step.error) : null}
          onConfirm={() => step.mutate({ action: 'approve' })}
          onClose={() => {
            step.reset();
            setConfirm(null);
          }}
        />
      ) : null}
      {run && confirm === 'issue' ? (
        <ConfirmDialog
          title={t('run.issue.title', { label: run.label })}
          body={t('run.issue.body', {
            count: run.totals?.invoices ?? 0,
            due: formatDate(run.dueDate),
          })}
          confirmLabel={t('run.issue')}
          busy={busy('issue')}
          error={step.isError ? errorText(step.error) : null}
          onConfirm={() => step.mutate({ action: 'issue' })}
          onClose={() => {
            step.reset();
            setConfirm(null);
          }}
        />
      ) : null}
      {run && confirm === 'cancel' ? (
        <ConfirmDialog
          title={t('run.cancel.title', { label: run.label })}
          body={t('run.cancel.body')}
          confirmLabel={t('run.cancel')}
          cancelLabel={t('run.cancel.keep')}
          destructive
          reason={{
            label: t('finance.reason'),
            required: true,
            helper: t('finance.reasonRequired'),
          }}
          busy={busy('cancel')}
          error={step.isError ? errorText(step.error) : null}
          onConfirm={(reason) => step.mutate({ action: 'cancel', reason })}
          onClose={() => {
            step.reset();
            setConfirm(null);
          }}
        />
      ) : null}
    </Drawer>
  );
}

export function BillingRunsScreen() {
  const { estateId, can } = useEstate();
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const charges = useCharges();
  const runs = useQuery({
    queryKey: ['estate', estateId, 'billing-runs'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/billing-runs', { params: { path: { estateId } } })),
  });
  const activeCharges = charges.data ?? [];
  const canCreate = can('billing.run.create');

  const columns: Column<BillingRun>[] = [
    { key: 'label', header: t('run.col.label'), render: (row) => <strong>{row.label}</strong> },
    {
      key: 'period',
      header: t('run.col.period'),
      render: (row) => periodText(row.periodStart, row.periodEnd, formatDate),
    },
    { key: 'due', header: t('run.col.due'), render: (row) => formatDate(row.dueDate) },
    {
      key: 'invoices',
      header: t('run.col.invoices'),
      align: 'right',
      render: (row) => <span className="sz-num">{row.totals?.invoices ?? '-'}</span>,
    },
    {
      key: 'amount',
      header: t('run.col.amount'),
      align: 'right',
      render: (row) => (
        <span className="sz-num">{row.totals ? formatKobo(row.totals.amount) : '-'}</span>
      ),
    },
    {
      key: 'status',
      header: t('run.col.status'),
      render: (row) => <StatusPill tone={runTone(row.status)} label={runStatusLabel(row.status)} />,
    },
  ];

  return (
    <>
      <PageHeader
        title={t('run.title')}
        description={t('run.description')}
        actions={
          canCreate ? (
            <ActionButton
              icon="plus"
              disabled={activeCharges.length === 0}
              onClick={() => setCreating(true)}
            >
              {t('run.new')}
            </ActionButton>
          ) : null
        }
      />
      {canCreate && charges.data && activeCharges.length === 0 ? (
        <Banner tone="info">{t('run.noCharges')}</Banner>
      ) : null}
      <DataTable
        caption={t('run.title')}
        columns={columns}
        rows={runs.data}
        rowKey={(row) => row.id}
        loading={runs.isPending}
        error={runs.isError ? errorText(runs.error) : null}
        onRetry={() => void runs.refetch()}
        onRowClick={(row) => setOpenId(row.id)}
        selectedKey={openId}
        empty={{ icon: 'layers', title: t('run.empty.title'), body: t('run.empty.body') }}
      />
      {creating ? (
        <NewRunDialog
          charges={activeCharges}
          onClose={() => setCreating(false)}
          onCreated={(run) => {
            setCreating(false);
            setOpenId(run.id);
          }}
        />
      ) : null}
      {openId ? (
        <RunDrawer runId={openId} charges={activeCharges} onClose={() => setOpenId(null)} />
      ) : null}
    </>
  );
}
