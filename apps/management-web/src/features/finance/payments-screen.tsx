'use client';

import { unwrap, unwrapPage } from '@safezone/api-client';
import { formatDate, formatDateTime, formatKobo, type MessageKey, t } from '@safezone/i18n';
import {
  ActionButton,
  type Column,
  ConfirmDialog,
  DataTable,
  Dialog,
  FormError,
  InputField,
  PageHeader,
  SelectField,
  StatusPill,
  Tabs,
  TextAreaField,
  Toolbar,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useEstate } from '../../../lib/estate';
import { errorText, formErrors } from '../../../lib/errors';
import { parsePositiveNaira } from '../../../lib/money';
import { usePaged } from '../../../lib/paged';
import { api } from '../../../lib/session';
import { decisionTone, type ManualPayment, todayWatDate, type Transaction } from './finance-labels';
import { type Payer, PayerPicker, useResidentNames } from './payer-picker';

type Method = ManualPayment['method'];
const METHODS: Method[] = ['cash', 'bank_deposit', 'pos', 'cheque'];
type OfficeFilter = 'pending' | 'approved' | 'rejected' | 'all';
type RecordField = 'payer' | 'amount' | 'receivedOn' | 'reference' | 'note';

function RecordDialog({ onClose }: { onClose: () => void }) {
  const { estateId } = useEstate();
  const queryClient = useQueryClient();
  const [payer, setPayer] = useState<Payer | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<Method>('cash');
  const [receivedOn, setReceivedOn] = useState(todayWatDate());
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Partial<Record<RecordField, string>>>({});

  const record = useMutation({
    mutationFn: (body: {
      payerUserId: string;
      spaceId: string;
      amount: number;
      method: Method;
      receivedOn: string;
      reference?: string;
      note?: string;
    }) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/manual-payments', {
          params: { path: { estateId } },
          body,
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'manual-payments'] });
      onClose();
    },
    onError: (error) =>
      setErrors(
        formErrors(error, {
          payerUserId: 'payer',
          amount: 'amount',
          receivedOn: 'receivedOn',
          reference: 'reference',
          note: 'note',
        } as const).fields,
      ),
  });

  const submit = () => {
    const kobo = parsePositiveNaira(amount);
    const next: Partial<Record<RecordField, string>> = {
      payer: payer ? undefined : t('finance.payerPicker.required'),
      amount: kobo === null ? t('finance.amountInvalid') : undefined,
      receivedOn: !receivedOn
        ? t('finance.dateRequired')
        : receivedOn > todayWatDate()
          ? t('payment.office.form.receivedFuture')
          : undefined,
    };
    setErrors(next);
    if (!payer || kobo === null || next.receivedOn) return;
    record.mutate({
      payerUserId: payer.userId,
      spaceId: payer.unitId,
      amount: kobo,
      method,
      receivedOn,
      reference: reference.trim() || undefined,
      note: note.trim() || undefined,
    });
  };

  return (
    <Dialog
      wide
      title={t('payment.office.record')}
      onClose={onClose}
      onSubmit={submit}
      actions={
        <>
          <ActionButton variant="text" onClick={onClose}>
            {t('common.cancel')}
          </ActionButton>
          <ActionButton type="submit" busy={record.isPending}>
            {t('payment.office.form.submit')}
          </ActionButton>
        </>
      }
    >
      <div className="sz-form">
        <PayerPicker value={payer} onChange={setPayer} error={errors.payer} />
        <div className="sz-form-2">
          <InputField
            label={t('finance.amount')}
            value={amount}
            onChange={setAmount}
            error={errors.amount}
            inputMode="decimal"
          />
          <SelectField<Method>
            label={t('payment.office.form.method')}
            value={method}
            onChange={setMethod}
            options={METHODS.map((value) => ({
              value,
              label: t(`payment.office.method.${value}` as MessageKey),
            }))}
          />
          <InputField
            type="date"
            label={t('payment.office.form.receivedOn')}
            value={receivedOn}
            onChange={setReceivedOn}
            error={errors.receivedOn}
            max={todayWatDate()}
          />
          <InputField
            label={t('payment.office.form.reference')}
            value={reference}
            onChange={setReference}
            error={errors.reference}
            maxLength={120}
          />
        </div>
        <TextAreaField
          label={t('payment.office.form.note')}
          value={note}
          onChange={setNote}
          error={errors.note}
          rows={2}
          maxLength={500}
        />
        <p className="sz-muted" style={{ margin: 0, fontSize: 13 }}>
          {t('payment.office.form.helper')}
        </p>
        <FormError
          message={
            record.isError && Object.values(errors).every((value) => !value)
              ? errorText(record.error)
              : null
          }
        />
      </div>
    </Dialog>
  );
}

function OfficePayments() {
  const { estateId, can } = useEstate();
  const queryClient = useQueryClient();
  const nameOf = useResidentNames();
  const [filter, setFilter] = useState<OfficeFilter>('pending');
  const [recording, setRecording] = useState(false);
  const [decision, setDecision] = useState<{
    payment: ManualPayment;
    decision: 'approve' | 'reject';
  } | null>(null);
  const canApprove = can('billing.run.approve');

  const payments = useQuery({
    queryKey: ['estate', estateId, 'manual-payments', filter],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/manual-payments', {
          params: { path: { estateId }, query: { status: filter === 'all' ? undefined : filter } },
        }),
      ),
  });
  const decide = useMutation({
    mutationFn: ({
      payment,
      decision,
      reason,
    }: {
      payment: ManualPayment;
      decision: 'approve' | 'reject';
      reason: string;
    }) => {
      const params = { path: { estateId, id: payment.id } };
      return decision === 'approve'
        ? unwrap(
            api.POST('/v1/estates/{estateId}/manual-payments/{id}/approve', {
              params,
              body: { reason: reason || undefined },
            }),
          )
        : unwrap(
            api.POST('/v1/estates/{estateId}/manual-payments/{id}/reject', {
              params,
              body: { reason },
            }),
          );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'manual-payments'] });
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'invoices'] });
      setDecision(null);
    },
  });

  const columns: Column<ManualPayment>[] = [
    {
      key: 'received',
      header: t('payment.office.col.received'),
      render: (row) => formatDate(row.receivedOn),
    },
    { key: 'payer', header: t('payment.col.payer'), render: (row) => nameOf(row.payerUserId) },
    {
      key: 'method',
      header: t('payment.office.col.method'),
      render: (row) => t(`payment.office.method.${row.method}` as MessageKey),
    },
    {
      key: 'reference',
      header: t('payment.col.reference'),
      render: (row) => (
        <span style={{ display: 'grid' }}>
          <span>{row.reference ?? '-'}</span>
          {row.note ? (
            <span className="sz-muted" style={{ fontSize: 13 }}>
              {row.note}
            </span>
          ) : null}
          {row.decisionReason ? (
            <span className="sz-muted" style={{ fontSize: 13 }}>
              {t('payment.office.detail.decision')}: {row.decisionReason}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'amount',
      header: t('payment.col.amount'),
      align: 'right',
      render: (row) => <span className="sz-num">{formatKobo(row.amount)}</span>,
    },
    {
      key: 'status',
      header: t('payment.col.status'),
      render: (row) => (
        <StatusPill
          tone={decisionTone(row.status)}
          label={t(`payment.office.status.${row.status}` as MessageKey)}
        />
      ),
    },
  ];
  if (canApprove)
    columns.push({
      key: 'actions',
      header: t('common.actions'),
      align: 'right',
      render: (row) =>
        row.status === 'pending' ? (
          <span style={{ display: 'inline-flex', gap: 4 }}>
            <ActionButton
              size="sm"
              onClick={() => setDecision({ payment: row, decision: 'approve' })}
            >
              {t('payment.office.approve')}
            </ActionButton>
            <ActionButton
              size="sm"
              variant="outline"
              onClick={() => setDecision({ payment: row, decision: 'reject' })}
            >
              {t('payment.office.reject')}
            </ActionButton>
          </span>
        ) : null,
    });

  const params = decision
    ? { amount: formatKobo(decision.payment.amount), payer: nameOf(decision.payment.payerUserId) }
    : null;
  return (
    <>
      <Toolbar>
        <SelectField<OfficeFilter>
          label={t('payment.office.filter')}
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'pending', label: t('payment.office.status.pending') },
            { value: 'approved', label: t('payment.office.status.approved') },
            { value: 'rejected', label: t('payment.office.status.rejected') },
            { value: 'all', label: t('payment.office.all') },
          ]}
        />
        <span style={{ flex: 1 }} />
        {can('payment.reconcile') ? (
          <ActionButton icon="plus" onClick={() => setRecording(true)}>
            {t('payment.office.record')}
          </ActionButton>
        ) : null}
      </Toolbar>
      <DataTable
        caption={t('payment.tab.office')}
        columns={columns}
        rows={payments.data}
        rowKey={(row) => row.id}
        loading={payments.isPending}
        error={payments.isError ? errorText(payments.error) : null}
        onRetry={() => void payments.refetch()}
        empty={{
          icon: 'wallet',
          title: t('payment.office.empty.title'),
          body: t('payment.office.empty.body'),
        }}
      />
      {recording ? <RecordDialog onClose={() => setRecording(false)} /> : null}
      {decision && params ? (
        <ConfirmDialog
          title={
            decision.decision === 'approve'
              ? t('payment.office.approve.title', params)
              : t('payment.office.reject.title', params)
          }
          body={
            decision.decision === 'approve'
              ? t('payment.office.approve.body')
              : t('payment.office.reject.body')
          }
          confirmLabel={
            decision.decision === 'approve'
              ? t('payment.office.approve')
              : t('payment.office.reject')
          }
          destructive={decision.decision === 'reject'}
          reason={
            decision.decision === 'approve'
              ? { label: t('waiver.note') }
              : { label: t('finance.reason'), required: true, helper: t('finance.reasonRequired') }
          }
          busy={decide.isPending}
          error={decide.isError ? errorText(decide.error) : null}
          onConfirm={(reason) => decide.mutate({ ...decision, reason })}
          onClose={() => {
            decide.reset();
            setDecision(null);
          }}
        />
      ) : null}
    </>
  );
}

function OnlinePayments() {
  const { estateId } = useEstate();
  const nameOf = useResidentNames();
  const list = usePaged<Transaction>(['estate', estateId, 'transactions'], (cursor) =>
    unwrapPage(
      api.GET('/v1/estates/{estateId}/transactions', {
        params: { path: { estateId }, query: { limit: 50, cursor } },
      }),
    ),
  );
  const columns: Column<Transaction>[] = [
    { key: 'paidAt', header: t('payment.col.paidAt'), render: (row) => formatDateTime(row.paidAt) },
    { key: 'payer', header: t('payment.col.payer'), render: (row) => nameOf(row.payerUserId) },
    {
      key: 'reference',
      header: t('payment.col.reference'),
      render: (row) => <span className="sz-num">{row.reference}</span>,
    },
    { key: 'channel', header: t('payment.col.channel'), render: (row) => row.channel },
    {
      key: 'amount',
      header: t('payment.col.amount'),
      align: 'right',
      render: (row) => <span className="sz-num">{formatKobo(row.amount)}</span>,
    },
    {
      key: 'status',
      header: t('payment.col.status'),
      render: (row) => (
        <StatusPill
          tone={row.status === 'succeeded' ? 'success' : 'neutral'}
          label={t(`payment.status.${row.status}` as MessageKey)}
        />
      ),
    },
  ];
  return (
    <DataTable
      caption={t('payment.tab.online')}
      columns={columns}
      rows={list.rows}
      rowKey={(row) => row.id}
      loading={list.loading}
      error={list.error ? errorText(list.error) : null}
      onRetry={list.refetch}
      hasMore={list.hasMore}
      loadingMore={list.loadingMore}
      onLoadMore={list.loadMore}
      empty={{ icon: 'wallet', title: t('payment.empty.title'), body: t('payment.empty.body') }}
    />
  );
}

export function PaymentsScreen() {
  const { can } = useEstate();
  // Approvers read office payments to approve them (ADR-0016). The estate-wide online list is for
  // reconcilers only: for anyone else the API returns just their own payments.
  const canOffice = can('payment.reconcile') || can('billing.run.approve');
  const canOnline = can('payment.reconcile');
  const [tab, setTab] = useState<'online' | 'office'>(canOffice ? 'office' : 'online');
  return (
    <>
      <PageHeader title={t('payment.title')} description={t('payment.description')} />
      {canOffice && canOnline ? (
        <Tabs
          label={t('payment.title')}
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'office', label: t('payment.tab.office') },
            { key: 'online', label: t('payment.tab.online') },
          ]}
        />
      ) : null}
      {tab === 'office' && canOffice ? <OfficePayments /> : <OnlinePayments />}
    </>
  );
}
