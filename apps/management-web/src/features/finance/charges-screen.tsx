'use client';

import { unwrap } from '@safezone/api-client';
import { formatDate, type MessageKey, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  type Column,
  ConfirmDialog,
  DataTable,
  Dialog,
  FormError,
  InputField,
  PageHeader,
  SelectField,
  Tabs,
  TextAreaField,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useEstate } from '../../../lib/estate';
import { errorText, formErrors } from '../../../lib/errors';
import { api } from '../../../lib/session';
import {
  CHARGE_FIELD_PATHS,
  type ChargeDraft,
  type ChargeField,
  checkChargeDraft,
  draftFromCharge,
  newChargeDraft,
  type PenaltyKind,
  type RuleKind,
} from './charge-form';
import {
  amountRuleText,
  CHARGE_TYPES,
  type Charge,
  FREQUENCIES,
  todayWatDate,
  UNIT_TYPES,
} from './finance-labels';

const RULE_KINDS: RuleKind[] = ['fixed', 'per_unit_type', 'per_bedroom', 'per_sqm'];
const label = (key: string) => t(key as MessageKey);

function ChargeDialog({ editing, onClose }: { editing: Charge | null; onClose: () => void }) {
  const { estateId } = useEstate();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ChargeDraft>(() =>
    editing ? draftFromCharge(editing) : newChargeDraft(todayWatDate()),
  );
  const [errors, setErrors] = useState<Partial<Record<ChargeField, string>>>({});
  const [other, setOther] = useState<string[]>([]);
  const metered = editing?.amountRule.kind === 'metered';

  const set =
    <K extends keyof ChargeDraft>(key: K, field?: ChargeField) =>
    (value: ChargeDraft[K]) => {
      setDraft((current) => ({ ...current, [key]: value }));
      if (field && errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
    };

  const save = useMutation({
    mutationFn: (checked: Exclude<ReturnType<typeof checkChargeDraft>, { ok: false }>['value']) => {
      const description = draft.description.trim();
      if (editing)
        return unwrap(
          api.PATCH('/v1/estates/{estateId}/charges/{id}', {
            params: { path: { estateId, id: editing.id } },
            headers: { 'If-Match': `"${editing.version}"` },
            body: {
              name: draft.name.trim(),
              description: description || null,
              ...(metered ? {} : { amountRule: checked.amountRule }),
              endsOn: draft.endsOn || null,
              penaltyRule: checked.penaltyRule,
            },
          }),
        );
      return unwrap(
        api.POST('/v1/estates/{estateId}/charges', {
          params: { path: { estateId } },
          body: {
            type: draft.type,
            name: draft.name.trim(),
            description: description || undefined,
            amountRule: checked.amountRule,
            frequency: draft.frequency,
            payer: draft.payer,
            startsOn: draft.startsOn,
            endsOn: draft.endsOn || undefined,
            penaltyRule: checked.penaltyRule ?? undefined,
          },
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'charges'] });
      onClose();
    },
    onError: (error) => {
      const server = formErrors(error, CHARGE_FIELD_PATHS);
      setErrors(server.fields);
      setOther(server.other);
    },
  });

  const submit = () => {
    setOther([]);
    const checked = checkChargeDraft(
      metered ? { ...draft, ruleKind: 'fixed', amount: draft.amount || '1' } : draft,
    );
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    save.mutate(checked.value);
  };

  const amountLabel =
    draft.ruleKind === 'per_bedroom'
      ? t('charge.form.amountPerBedroom')
      : draft.ruleKind === 'per_sqm'
        ? t('charge.form.amountPerSqm')
        : t('charge.form.amountFixed');

  return (
    <Dialog
      wide
      title={editing ? t('charge.edit') : t('charge.new')}
      onClose={onClose}
      onSubmit={submit}
      actions={
        <>
          <ActionButton variant="text" onClick={onClose}>
            {t('common.cancel')}
          </ActionButton>
          <ActionButton type="submit" busy={save.isPending}>
            {editing ? t('common.save') : t('charge.form.create')}
          </ActionButton>
        </>
      }
    >
      <div className="sz-form">
        <div className="sz-form-2">
          <InputField
            label={t('charge.form.name')}
            value={draft.name}
            onChange={set('name', 'name')}
            error={errors.name}
            maxLength={120}
            autoFocus
          />
          {editing ? null : (
            <SelectField
              label={t('charge.form.type')}
              value={draft.type}
              onChange={set('type')}
              options={CHARGE_TYPES.map((value) => ({
                value,
                label: label(`charge.type.${value}`),
              }))}
            />
          )}
        </div>
        <TextAreaField
          label={t('charge.form.description')}
          value={draft.description}
          onChange={set('description')}
          rows={2}
          maxLength={500}
        />
        {editing ? (
          <p className="sz-muted" style={{ margin: 0, fontSize: 13 }}>
            {t('charge.form.lockedHelp')} {t('charge.form.issuedHelp')}
          </p>
        ) : (
          <div className="sz-form-2">
            <SelectField
              label={t('charge.form.frequency')}
              value={draft.frequency}
              onChange={set('frequency')}
              options={FREQUENCIES.map((value) => ({
                value,
                label: label(`charge.frequency.${value}`),
              }))}
            />
            <SelectField
              label={t('charge.form.payer')}
              value={draft.payer}
              onChange={set('payer')}
              options={[
                { value: 'occupant', label: t('finance.payer.occupant') },
                { value: 'owner', label: t('finance.payer.owner') },
              ]}
            />
          </div>
        )}

        {metered ? null : (
          <>
            <SelectField
              label={t('charge.form.rule')}
              value={draft.ruleKind}
              onChange={set('ruleKind')}
              options={RULE_KINDS.map((value) => ({
                value,
                label: label(`charge.rule.${value}`),
              }))}
            />
            {draft.ruleKind === 'per_unit_type' ? (
              <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="sz-muted" style={{ fontSize: 13, marginBottom: 8 }}>
                  {t('charge.form.perTypeHelp')}
                </legend>
                <div className="sz-form-2">
                  {UNIT_TYPES.map((type) => (
                    <InputField
                      key={type}
                      label={t('charge.form.amountForType', { type: label(`unitType.${type}`) })}
                      value={draft.perType[type]}
                      inputMode="decimal"
                      onChange={(value) =>
                        set('perType', 'perType')({ ...draft.perType, [type]: value })
                      }
                    />
                  ))}
                </div>
                <FormError message={errors.perType} />
              </fieldset>
            ) : (
              <div className="sz-form-2">
                <InputField
                  label={amountLabel}
                  value={draft.amount}
                  onChange={set('amount', 'amount')}
                  error={errors.amount}
                  inputMode="decimal"
                  placeholder="15000"
                />
                {draft.ruleKind === 'per_bedroom' ? (
                  <InputField
                    label={t('charge.form.minimumBedrooms')}
                    value={draft.minimumBedrooms}
                    onChange={set('minimumBedrooms', 'minimumBedrooms')}
                    error={errors.minimumBedrooms}
                    inputMode="numeric"
                  />
                ) : null}
              </div>
            )}
          </>
        )}

        <div className="sz-form-2">
          {editing ? null : (
            <InputField
              type="date"
              label={t('charge.form.startsOn')}
              value={draft.startsOn}
              onChange={set('startsOn', 'startsOn')}
              error={errors.startsOn}
            />
          )}
          <InputField
            type="date"
            label={t('charge.form.endsOn')}
            value={draft.endsOn}
            onChange={set('endsOn', 'endsOn')}
            error={errors.endsOn}
            min={draft.startsOn}
          />
        </div>

        <SelectField<PenaltyKind>
          label={t('charge.form.penalty')}
          helper={t('charge.form.penaltyHelp')}
          value={draft.penaltyKind}
          onChange={set('penaltyKind')}
          options={[
            { value: 'none', label: t('charge.penalty.none') },
            { value: 'fixed', label: t('charge.penalty.fixed') },
            { value: 'percent', label: t('charge.penalty.percent') },
          ]}
        />
        {draft.penaltyKind === 'fixed' ? (
          <InputField
            label={t('charge.form.penaltyAmount')}
            value={draft.penaltyAmount}
            onChange={set('penaltyAmount', 'penaltyAmount')}
            error={errors.penaltyAmount}
            inputMode="decimal"
          />
        ) : null}
        {draft.penaltyKind === 'percent' ? (
          <div className="sz-form-2">
            <InputField
              label={t('charge.form.penaltyPercent')}
              value={draft.penaltyPercent}
              onChange={set('penaltyPercent', 'penaltyPercent')}
              error={errors.penaltyPercent}
              inputMode="decimal"
              placeholder="5"
            />
            <InputField
              label={t('charge.form.penaltyCap')}
              value={draft.penaltyCap}
              onChange={set('penaltyCap', 'penaltyCap')}
              error={errors.penaltyCap}
              inputMode="decimal"
            />
          </div>
        ) : null}
        {other.map((message) => (
          <FormError key={message} message={message} />
        ))}
        <FormError
          message={
            save.isError && Object.keys(errors).length === 0 && other.length === 0
              ? errorText(save.error)
              : null
          }
        />
      </div>
    </Dialog>
  );
}

export function ChargesScreen() {
  const { estateId, can } = useEstate();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const [dialog, setDialog] = useState<{ editing: Charge | null } | null>(null);
  const [archiving, setArchiving] = useState<Charge | null>(null);
  const canManage = can('charge.manage');

  const charges = useQuery({
    queryKey: ['estate', estateId, 'charges', status],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/charges', {
          params: { path: { estateId }, query: { status } },
        }),
      ),
  });

  const setChargeStatus = useMutation({
    mutationFn: ({ charge, next }: { charge: Charge; next: 'active' | 'archived' }) =>
      unwrap(
        api.PATCH('/v1/estates/{estateId}/charges/{id}', {
          params: { path: { estateId, id: charge.id } },
          headers: { 'If-Match': `"${charge.version}"` },
          body: { status: next },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'charges'] });
      setArchiving(null);
    },
  });

  const columns: Column<Charge>[] = [
    {
      key: 'name',
      header: t('charge.col.name'),
      render: (row) => (
        <span style={{ display: 'grid' }}>
          <strong>{row.name}</strong>
          {row.description ? (
            <span className="sz-muted" style={{ fontSize: 13 }}>
              {row.description}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'type',
      header: t('charge.col.type'),
      render: (row) => label(`charge.type.${row.type}`),
    },
    {
      key: 'amount',
      header: t('charge.col.amount'),
      align: 'right',
      render: (row) => <span className="sz-num">{amountRuleText(row.amountRule)}</span>,
    },
    {
      key: 'frequency',
      header: t('charge.col.frequency'),
      render: (row) => label(`charge.frequency.${row.frequency}`),
    },
    {
      key: 'payer',
      header: t('charge.col.payer'),
      render: (row) =>
        row.payer === 'owner' ? t('finance.payer.owner') : t('finance.payer.occupant'),
    },
    {
      key: 'from',
      header: t('charge.col.from'),
      render: (row) => formatDate(row.startsOn),
    },
  ];
  if (canManage)
    columns.push({
      key: 'actions',
      header: t('common.actions'),
      align: 'right',
      render: (row) =>
        row.status === 'active' ? (
          <span style={{ display: 'inline-flex', gap: 4 }}>
            <ActionButton variant="text" size="sm" onClick={() => setDialog({ editing: row })}>
              {t('common.edit')}
            </ActionButton>
            <ActionButton variant="text" size="sm" onClick={() => setArchiving(row)}>
              {t('charge.archive')}
            </ActionButton>
          </span>
        ) : (
          <ActionButton
            variant="text"
            size="sm"
            busy={setChargeStatus.isPending && setChargeStatus.variables?.charge.id === row.id}
            onClick={() => setChargeStatus.mutate({ charge: row, next: 'active' })}
          >
            {t('charge.restore')}
          </ActionButton>
        ),
    });

  return (
    <>
      <PageHeader
        title={t('charge.title')}
        description={t('charge.description')}
        actions={
          canManage ? (
            <ActionButton icon="plus" onClick={() => setDialog({ editing: null })}>
              {t('charge.new')}
            </ActionButton>
          ) : null
        }
      />
      <Tabs
        label={t('charge.title')}
        value={status}
        onChange={setStatus}
        tabs={[
          { key: 'active', label: t('charge.tab.active') },
          { key: 'archived', label: t('charge.tab.archived') },
        ]}
      />
      {setChargeStatus.isError && !archiving ? (
        <Banner tone="danger">{errorText(setChargeStatus.error)}</Banner>
      ) : null}
      <DataTable
        caption={t('charge.title')}
        columns={columns}
        rows={charges.data}
        rowKey={(row) => row.id}
        loading={charges.isPending}
        error={charges.isError ? errorText(charges.error) : null}
        onRetry={() => void charges.refetch()}
        empty={
          status === 'active'
            ? { icon: 'receipt', title: t('charge.empty.title'), body: t('charge.empty.body') }
            : { icon: 'receipt', title: t('charge.emptyArchived.title') }
        }
      />
      {dialog ? <ChargeDialog editing={dialog.editing} onClose={() => setDialog(null)} /> : null}
      {archiving ? (
        <ConfirmDialog
          title={t('charge.archive.title', { name: archiving.name })}
          body={t('charge.archive.body')}
          confirmLabel={t('charge.archive')}
          destructive
          busy={setChargeStatus.isPending}
          error={setChargeStatus.isError ? errorText(setChargeStatus.error) : null}
          onConfirm={() => setChargeStatus.mutate({ charge: archiving, next: 'archived' })}
          onClose={() => {
            setChargeStatus.reset();
            setArchiving(null);
          }}
        />
      ) : null}
    </>
  );
}
