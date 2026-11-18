'use client';

import { unwrap, unwrapPage } from '@safezone/api-client';
import { formatDate, formatDateTime, formatKobo, type MessageKey, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  type Column,
  ConfirmDialog,
  DataTable,
  DetailList,
  Dialog,
  Drawer,
  FormError,
  Icon,
  InputField,
  PageHeader,
  StatusPill,
  Tabs,
  TextAreaField,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useEstate } from '../../../lib/estate';
import { errorText, formErrors } from '../../../lib/errors';
import { parsePositiveNaira } from '../../../lib/money';
import { usePaged } from '../../../lib/paged';
import { api } from '../../../lib/session';
import {
  decisionTone,
  type Invoice,
  type InvoiceDetail,
  invoiceStatusLabel,
  invoiceTone,
  todayWatDate,
  type Waiver,
  watDatePlus,
} from './finance-labels';
import { type Payer, PayerPicker } from './payer-picker';

type View = 'all' | 'overdue' | 'issued' | 'partially_paid' | 'paid' | 'waivers';
const STATUS_VIEWS: Exclude<View, 'waivers'>[] = [
  'all',
  'overdue',
  'issued',
  'partially_paid',
  'paid',
];

// ---- Credit note and waiver -------------------------------------------------------------------

function AdjustDialog({
  kind,
  invoice,
  onClose,
}: {
  kind: 'credit' | 'waiver';
  invoice: InvoiceDetail;
  onClose: () => void;
}) {
  const { estateId } = useEstate();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ amount?: string; reason?: string }>({});
  const balance = formatKobo(invoice.balance);
  const save = useMutation({
    mutationFn: async (kobo: number): Promise<void> => {
      const params = { path: { estateId, id: invoice.id } };
      const body = { amount: kobo, reason: reason.trim() };
      if (kind === 'credit')
        await unwrap(
          api.POST('/v1/estates/{estateId}/invoices/{id}/credit-notes', { params, body }),
        );
      else await unwrap(api.POST('/v1/estates/{estateId}/invoices/{id}/waivers', { params, body }));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'invoices'] });
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'waivers'] });
      onClose();
    },
    onError: (error) =>
      setErrors(formErrors(error, { amount: 'amount', reason: 'reason' } as const).fields),
  });
  const submit = () => {
    const kobo = parsePositiveNaira(amount);
    const next = {
      amount:
        kobo === null
          ? t('finance.amountInvalid')
          : kobo > invoice.balance
            ? t('invoice.amountTooHigh', { balance })
            : undefined,
      reason: reason.trim().length < 3 ? t('finance.reasonRequired') : undefined,
    };
    setErrors(next);
    if (kobo !== null && !next.amount && !next.reason) save.mutate(kobo);
  };
  const credit = kind === 'credit';
  return (
    <Dialog
      title={
        credit
          ? t('invoice.creditNote.title', { number: invoice.number })
          : t('invoice.waiver.title', { number: invoice.number })
      }
      onClose={onClose}
      onSubmit={submit}
      actions={
        <>
          <ActionButton variant="text" onClick={onClose}>
            {t('common.cancel')}
          </ActionButton>
          <ActionButton type="submit" busy={save.isPending}>
            {credit ? t('invoice.creditNote.submit') : t('invoice.waiver.submit')}
          </ActionButton>
        </>
      }
    >
      <div className="sz-form">
        <p style={{ margin: 0, fontSize: 14 }}>
          {credit
            ? t('invoice.creditNote.body', { balance })
            : t('invoice.waiver.body', { balance })}
        </p>
        <InputField
          label={t('finance.amount')}
          value={amount}
          onChange={setAmount}
          error={errors.amount}
          inputMode="decimal"
          autoFocus
        />
        <TextAreaField
          label={t('finance.reason')}
          value={reason}
          onChange={setReason}
          error={errors.reason}
          rows={3}
          maxLength={500}
        />
        <FormError
          message={save.isError && !errors.amount && !errors.reason ? errorText(save.error) : null}
        />
      </div>
    </Dialog>
  );
}

function WaiverDecision({
  waiver,
  decision,
  onClose,
}: {
  waiver: Pick<Waiver, 'id' | 'invoiceId' | 'amount' | 'reason'>;
  decision: 'approve' | 'reject';
  onClose: () => void;
}) {
  const { estateId } = useEstate();
  const queryClient = useQueryClient();
  const decide = useMutation({
    mutationFn: (reason: string) => {
      const params = { path: { estateId, id: waiver.invoiceId, waiverId: waiver.id } };
      return decision === 'approve'
        ? unwrap(
            api.POST('/v1/estates/{estateId}/invoices/{id}/waivers/{waiverId}/approve', {
              params,
              body: { reason: reason || undefined },
            }),
          )
        : unwrap(
            api.POST('/v1/estates/{estateId}/invoices/{id}/waivers/{waiverId}/reject', {
              params,
              body: { reason },
            }),
          );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'waivers'] });
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'invoices'] });
      onClose();
    },
  });
  const amount = formatKobo(waiver.amount);
  return (
    <ConfirmDialog
      title={
        decision === 'approve'
          ? t('waiver.approve.title', { amount })
          : t('waiver.reject.title', { amount })
      }
      body={
        decision === 'approve'
          ? t('waiver.approve.body', { reason: waiver.reason })
          : t('waiver.reject.body')
      }
      confirmLabel={decision === 'approve' ? t('waiver.approve') : t('waiver.reject')}
      destructive={decision === 'reject'}
      reason={
        decision === 'approve'
          ? { label: t('waiver.note') }
          : { label: t('finance.reason'), required: true, helper: t('finance.reasonRequired') }
      }
      busy={decide.isPending}
      error={decide.isError ? errorText(decide.error) : null}
      onConfirm={(reason) => decide.mutate(reason)}
      onClose={onClose}
    />
  );
}

// ---- One-off invoice --------------------------------------------------------------------------

interface LineDraft {
  key: number;
  description: string;
  quantity: string;
  unitAmount: string;
}
type LineErrors = { description?: string; quantity?: string; unitAmount?: string };

function OneOffDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { estateId } = useEstate();
  const queryClient = useQueryClient();
  const [payer, setPayer] = useState<Payer | null>(null);
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState(watDatePlus(14));
  const [lines, setLines] = useState<LineDraft[]>([
    { key: 0, description: '', quantity: '1', unitAmount: '' },
  ]);
  const [errors, setErrors] = useState<{
    payer?: string;
    description?: string;
    dueDate?: string;
    lines: LineErrors[];
  }>({ lines: [] });

  const create = useMutation({
    mutationFn: (body: {
      spaceId: string;
      description: string;
      dueDate: string;
      lines: { description: string; quantity: number; unitAmount: number }[];
    }) =>
      unwrap(api.POST('/v1/estates/{estateId}/invoices', { params: { path: { estateId } }, body })),
    onSuccess: (invoice) => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'invoices'] });
      onCreated(invoice.id);
    },
  });

  const parsed = lines.map((line) => ({
    description: line.description.trim(),
    quantity: /^\d+$/.test(line.quantity.trim()) ? Number(line.quantity) : null,
    unitAmount: parsePositiveNaira(line.unitAmount),
  }));
  const total = parsed.reduce(
    (sum, line) => sum + (line.quantity ?? 0) * (line.unitAmount ?? 0),
    0,
  );

  const submit = () => {
    const today = todayWatDate();
    const lineErrors = parsed.map<LineErrors>((line) => ({
      description: line.description.length < 2 ? t('finance.nameRequired') : undefined,
      quantity:
        line.quantity === null || line.quantity < 1 || line.quantity > 10_000
          ? t('invoice.oneOff.qtyInvalid')
          : undefined,
      unitAmount: line.unitAmount === null ? t('finance.amountInvalid') : undefined,
    }));
    const next = {
      payer: payer ? undefined : t('finance.payerPicker.required'),
      description: description.trim().length < 2 ? t('finance.nameRequired') : undefined,
      dueDate: !dueDate
        ? t('finance.dateRequired')
        : dueDate < today
          ? t('invoice.oneOff.duePast')
          : undefined,
      lines: lineErrors,
    };
    setErrors(next);
    const linesOk = lineErrors.every(
      (line) => !line.description && !line.quantity && !line.unitAmount,
    );
    if (!payer || next.payer || next.description || next.dueDate || !linesOk) return;
    create.mutate({
      spaceId: payer.unitId,
      description: description.trim(),
      dueDate,
      lines: parsed.map((line) => ({
        description: line.description,
        quantity: line.quantity ?? 1,
        unitAmount: line.unitAmount ?? 0,
      })),
    });
  };

  const editLine = (index: number, patch: Partial<LineDraft>) =>
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  return (
    <Dialog
      wide
      title={t('invoice.oneOff.title')}
      onClose={onClose}
      onSubmit={submit}
      actions={
        <>
          <ActionButton variant="text" onClick={onClose}>
            {t('common.cancel')}
          </ActionButton>
          <ActionButton type="submit" busy={create.isPending}>
            {t('invoice.oneOff.submit')}
          </ActionButton>
        </>
      }
    >
      <div className="sz-form">
        <PayerPicker value={payer} onChange={setPayer} error={errors.payer} />
        <p className="sz-muted" style={{ margin: 0, fontSize: 13 }}>
          {t('invoice.oneOff.helper')}
        </p>
        <div className="sz-form-2">
          <InputField
            label={t('invoice.oneOff.description')}
            placeholder={t('invoice.oneOff.descriptionPlaceholder')}
            value={description}
            onChange={setDescription}
            error={errors.description}
            maxLength={120}
          />
          <InputField
            type="date"
            label={t('invoice.oneOff.due')}
            value={dueDate}
            onChange={setDueDate}
            error={errors.dueDate}
            min={todayWatDate()}
          />
        </div>
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 12 }}>
          <legend style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
            {t('invoice.oneOff.items')}
          </legend>
          {lines.map((line, index) => (
            <div
              key={line.key}
              style={{
                display: 'grid',
                gap: 8,
                gridTemplateColumns:
                  'minmax(180px, 2fr) minmax(80px, 0.6fr) minmax(120px, 1fr) auto',
                alignItems: 'start',
              }}
            >
              <InputField
                label={`${t('invoice.oneOff.item')} ${index + 1}`}
                value={line.description}
                onChange={(value) => editLine(index, { description: value })}
                error={errors.lines[index]?.description}
                maxLength={200}
              />
              <InputField
                label={t('invoice.oneOff.qty')}
                value={line.quantity}
                onChange={(value) => editLine(index, { quantity: value })}
                error={errors.lines[index]?.quantity}
                inputMode="numeric"
              />
              <InputField
                label={t('invoice.oneOff.unitAmount')}
                value={line.unitAmount}
                onChange={(value) => editLine(index, { unitAmount: value })}
                error={errors.lines[index]?.unitAmount}
                inputMode="decimal"
              />
              <div style={{ paddingTop: 28 }}>
                {lines.length > 1 ? (
                  <button
                    type="button"
                    className="sz-icon-btn"
                    aria-label={t('invoice.oneOff.removeItem', { n: index + 1 })}
                    onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                  >
                    <Icon name="x" />
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <ActionButton
              variant="outline"
              size="sm"
              icon="plus"
              disabled={lines.length >= 50}
              onClick={() =>
                setLines((current) => [
                  ...current,
                  {
                    key: (current[current.length - 1]?.key ?? 0) + 1,
                    description: '',
                    quantity: '1',
                    unitAmount: '',
                  },
                ])
              }
            >
              {t('invoice.oneOff.addItem')}
            </ActionButton>
            <strong className="sz-num">
              {t('invoice.oneOff.total', { amount: formatKobo(total) })}
            </strong>
          </div>
        </fieldset>
        <FormError message={create.isError ? errorText(create.error) : null} />
      </div>
    </Dialog>
  );
}

// ---- Detail -----------------------------------------------------------------------------------

function sourceLabel(sourceType: string): string {
  const key = `invoice.source.${sourceType}` as MessageKey;
  const text = t(key);
  return text === key ? t('invoice.source.other') : text;
}

function InvoiceDrawer({ invoiceId, onClose }: { invoiceId: string; onClose: () => void }) {
  const { estateId, can } = useEstate();
  const [adjust, setAdjust] = useState<'credit' | 'waiver' | null>(null);
  const [decision, setDecision] = useState<{
    waiver: InvoiceDetail['waivers'][number];
    decision: 'approve' | 'reject';
  } | null>(null);
  const detail = useQuery({
    queryKey: ['estate', estateId, 'invoices', 'detail', invoiceId],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/invoices/{id}', {
          params: { path: { estateId, id: invoiceId } },
        }),
      ),
  });
  const invoice = detail.data;
  const open = invoice && invoice.balance > 0 && invoice.status !== 'cancelled';
  return (
    <Drawer title={invoice?.number ?? t('invoice.title')} onClose={onClose}>
      {detail.isError ? <Banner tone="danger">{errorText(detail.error)}</Banner> : null}
      {invoice ? (
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <StatusPill
              tone={invoiceTone(invoice.status)}
              label={invoiceStatusLabel(invoice.status)}
            />
            <strong>{invoice.description}</strong>
            {invoice.penaltyForInvoiceId ? (
              <StatusPill tone="warning" label={t('invoice.detail.penaltyFor')} />
            ) : null}
          </div>
          <DetailList
            items={[
              { label: t('invoice.detail.unit'), value: invoice.unitCode ?? '-' },
              {
                label: t('invoice.detail.payer'),
                value:
                  invoice.payerType === 'owner'
                    ? t('finance.payer.owner')
                    : t('finance.payer.occupant'),
              },
              { label: t('invoice.detail.issued'), value: formatDate(invoice.issueDate) },
              { label: t('invoice.detail.due'), value: formatDate(invoice.dueDate) },
            ]}
          />
          <section>
            <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>{t('invoice.detail.lines')}</h3>
            <DetailList
              items={invoice.lines.map((line) => ({
                label: `${line.description}${
                  line.quantity !== 1
                    ? ` (${t('invoice.detail.lineQty', {
                        quantity: line.quantity,
                        amount: formatKobo(line.unitAmount),
                      })})`
                    : ''
                }`,
                value: <span className="sz-num">{formatKobo(line.amount)}</span>,
              }))}
            />
          </section>
          <DetailList
            items={[
              { label: t('invoice.detail.subtotal'), value: formatKobo(invoice.total) },
              { label: t('invoice.detail.paid'), value: formatKobo(invoice.amountPaid) },
              ...(invoice.amountCredited
                ? [
                    {
                      label: t('invoice.detail.credited'),
                      value: formatKobo(invoice.amountCredited),
                    },
                  ]
                : []),
              ...(invoice.amountWaived
                ? [{ label: t('invoice.detail.waived'), value: formatKobo(invoice.amountWaived) }]
                : []),
              {
                label: t('invoice.detail.balance'),
                value: <strong className="sz-num">{formatKobo(invoice.balance)}</strong>,
              },
            ]}
          />
          {open ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {can('billing.run.approve') ? (
                <ActionButton variant="outline" onClick={() => setAdjust('credit')}>
                  {t('invoice.creditNote')}
                </ActionButton>
              ) : null}
              {can('billing.run.create') ? (
                <ActionButton variant="outline" onClick={() => setAdjust('waiver')}>
                  {t('invoice.waiver')}
                </ActionButton>
              ) : null}
            </div>
          ) : null}
          <section>
            <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>{t('invoice.detail.payments')}</h3>
            {invoice.allocations.length === 0 ? (
              <p className="sz-muted" style={{ margin: 0, fontSize: 14 }}>
                {t('invoice.detail.noPayments')}
              </p>
            ) : (
              <DetailList
                items={invoice.allocations.map((allocation) => ({
                  label: `${sourceLabel(allocation.sourceType)} · ${formatDateTime(allocation.createdAt)}`,
                  value: <span className="sz-num">{formatKobo(allocation.amount)}</span>,
                }))}
              />
            )}
          </section>
          {invoice.creditNotes.length > 0 ? (
            <section>
              <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>{t('invoice.detail.credits')}</h3>
              <DetailList
                items={invoice.creditNotes.map((note) => ({
                  label: `${note.reason} · ${formatDate(note.createdAt)}`,
                  value: <span className="sz-num">{formatKobo(note.amount)}</span>,
                }))}
              />
            </section>
          ) : null}
          {invoice.waivers.length > 0 ? (
            <section>
              <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>{t('invoice.detail.waivers')}</h3>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
                {invoice.waivers.map((waiver) => (
                  <li key={waiver.id} style={{ display: 'grid', gap: 4 }}>
                    <div
                      style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
                    >
                      <strong className="sz-num">{formatKobo(waiver.amount)}</strong>
                      <StatusPill
                        tone={decisionTone(waiver.status)}
                        label={t(`waiver.status.${waiver.status}` as MessageKey)}
                      />
                    </div>
                    <span style={{ fontSize: 14 }}>{waiver.reason}</span>
                    {waiver.status === 'pending' && can('billing.run.approve') ? (
                      <span style={{ display: 'flex', gap: 8 }}>
                        <ActionButton
                          size="sm"
                          onClick={() => setDecision({ waiver, decision: 'approve' })}
                        >
                          {t('waiver.approve')}
                        </ActionButton>
                        <ActionButton
                          size="sm"
                          variant="outline"
                          onClick={() => setDecision({ waiver, decision: 'reject' })}
                        >
                          {t('waiver.reject')}
                        </ActionButton>
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
      {invoice && adjust ? (
        <AdjustDialog kind={adjust} invoice={invoice} onClose={() => setAdjust(null)} />
      ) : null}
      {invoice && decision ? (
        <WaiverDecision
          waiver={{ ...decision.waiver, invoiceId: invoice.id }}
          decision={decision.decision}
          onClose={() => setDecision(null)}
        />
      ) : null}
    </Drawer>
  );
}

// ---- Screen -----------------------------------------------------------------------------------

function WaiverQueue({ onOpenInvoice }: { onOpenInvoice: (invoiceId: string) => void }) {
  const { estateId } = useEstate();
  const [decision, setDecision] = useState<{
    waiver: Waiver;
    decision: 'approve' | 'reject';
  } | null>(null);
  const waivers = useQuery({
    queryKey: ['estate', estateId, 'waivers', 'pending'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/waivers', {
          params: { path: { estateId }, query: { status: 'pending' } },
        }),
      ),
  });
  const columns: Column<Waiver>[] = [
    {
      key: 'invoice',
      header: t('waiver.col.invoice'),
      render: (row) => (
        <ActionButton variant="text" size="sm" onClick={() => onOpenInvoice(row.invoiceId)}>
          {t('waiver.openInvoice')}
        </ActionButton>
      ),
    },
    {
      key: 'amount',
      header: t('waiver.col.amount'),
      align: 'right',
      render: (row) => <span className="sz-num">{formatKobo(row.amount)}</span>,
    },
    { key: 'reason', header: t('waiver.col.reason'), render: (row) => row.reason },
    {
      key: 'requested',
      header: t('waiver.col.requested'),
      render: (row) => formatDateTime(row.createdAt),
    },
    {
      key: 'actions',
      header: t('common.actions'),
      align: 'right',
      render: (row) => (
        <span style={{ display: 'inline-flex', gap: 4 }}>
          <ActionButton size="sm" onClick={() => setDecision({ waiver: row, decision: 'approve' })}>
            {t('waiver.approve')}
          </ActionButton>
          <ActionButton
            size="sm"
            variant="outline"
            onClick={() => setDecision({ waiver: row, decision: 'reject' })}
          >
            {t('waiver.reject')}
          </ActionButton>
        </span>
      ),
    },
  ];
  return (
    <>
      <DataTable
        caption={t('invoice.tab.waivers')}
        columns={columns}
        rows={waivers.data}
        rowKey={(row) => row.id}
        loading={waivers.isPending}
        error={waivers.isError ? errorText(waivers.error) : null}
        onRetry={() => void waivers.refetch()}
        empty={{ icon: 'check', title: t('waiver.empty.title'), body: t('waiver.empty.body') }}
      />
      {decision ? (
        <WaiverDecision
          waiver={decision.waiver}
          decision={decision.decision}
          onClose={() => setDecision(null)}
        />
      ) : null}
    </>
  );
}

export function InvoicesScreen() {
  const { estateId, can } = useEstate();
  const [view, setView] = useState<View>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const canApprove = can('billing.run.approve');
  const status = view === 'all' || view === 'waivers' ? undefined : view;

  const list = usePaged<Invoice>(
    ['estate', estateId, 'invoices', 'list', status ?? 'all'],
    (cursor) =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/invoices', {
          params: { path: { estateId }, query: { status, limit: 50, cursor } },
        }),
      ),
    { enabled: view !== 'waivers' },
  );
  const pending = useQuery({
    queryKey: ['estate', estateId, 'waivers', 'pending'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/waivers', {
          params: { path: { estateId }, query: { status: 'pending' } },
        }),
      ),
    enabled: canApprove,
  });
  const pendingCount = pending.data?.length ?? 0;

  const columns: Column<Invoice>[] = [
    {
      key: 'number',
      header: t('invoice.col.number'),
      render: (row) => <strong className="sz-num">{row.number}</strong>,
    },
    { key: 'unit', header: t('invoice.col.unit'), render: (row) => row.unitCode ?? '-' },
    { key: 'description', header: t('invoice.col.description'), render: (row) => row.description },
    { key: 'due', header: t('invoice.col.due'), render: (row) => formatDate(row.dueDate) },
    {
      key: 'total',
      header: t('invoice.col.total'),
      align: 'right',
      render: (row) => <span className="sz-num">{formatKobo(row.total)}</span>,
    },
    {
      key: 'balance',
      header: t('invoice.col.balance'),
      align: 'right',
      render: (row) => <span className="sz-num">{formatKobo(row.balance)}</span>,
    },
    {
      key: 'status',
      header: t('invoice.col.status'),
      render: (row) => (
        <StatusPill tone={invoiceTone(row.status)} label={invoiceStatusLabel(row.status)} />
      ),
    },
  ];

  const tabs: { key: View; label: string }[] = STATUS_VIEWS.map((key) => ({
    key,
    label: t(`invoice.tab.${key}` as MessageKey),
  }));
  if (canApprove)
    tabs.push({
      key: 'waivers',
      label:
        pendingCount > 0
          ? t('invoice.tab.waiversCount', { count: pendingCount })
          : t('invoice.tab.waivers'),
    });

  return (
    <>
      <PageHeader
        title={t('invoice.title')}
        description={t('invoice.description')}
        actions={
          can('billing.run.create') ? (
            <ActionButton icon="plus" onClick={() => setCreating(true)}>
              {t('invoice.new')}
            </ActionButton>
          ) : null
        }
      />
      <Tabs label={t('invoice.title')} value={view} onChange={setView} tabs={tabs} />
      {view === 'waivers' ? (
        <WaiverQueue onOpenInvoice={setOpenId} />
      ) : (
        <DataTable
          caption={t('invoice.title')}
          columns={columns}
          rows={list.rows}
          rowKey={(row) => row.id}
          loading={list.loading}
          error={list.error ? errorText(list.error) : null}
          onRetry={list.refetch}
          onRowClick={(row) => setOpenId(row.id)}
          selectedKey={openId}
          hasMore={list.hasMore}
          loadingMore={list.loadingMore}
          onLoadMore={list.loadMore}
          empty={{
            icon: 'fileText',
            title: t('invoice.empty.title'),
            body: t('invoice.empty.body'),
          }}
        />
      )}
      {creating ? (
        <OneOffDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setOpenId(id);
          }}
        />
      ) : null}
      {openId ? <InvoiceDrawer invoiceId={openId} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}
