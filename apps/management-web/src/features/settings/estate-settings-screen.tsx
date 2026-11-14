'use client';

import { type ApiData, unwrap } from '@safezone/api-client';
import { type MessageKey, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  CheckboxField,
  ErrorState,
  FormError,
  InputField,
  PageHeader,
  Panel,
  SelectField,
  Skeleton,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useEstate } from '../../../lib/estate';
import { errorText } from '../../../lib/errors';
import { api } from '../../../lib/session';

type Estate = ApiData<'/v1/estates/{estateId}', 'get'>;
type Settings = ApiData<'/v1/estates/{estateId}/settings', 'get'>;
type Escalation = Settings['sos.escalation'][number];
type TenantApproval = Settings['tenant_approval'];

function SavedNote({ show }: { show: boolean }) {
  return show ? (
    <span role="status" className="sz-muted" style={{ fontSize: 14 }}>
      {t('settings.saved')}
    </span>
  ) : null;
}

function ProfileForm({ estate }: { estate: Estate }) {
  const { estateId } = useEstate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: estate.name,
    address: estate.address ?? '',
    state: estate.state ?? '',
    lga: estate.lga ?? '',
  });
  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.PATCH('/v1/estates/{estateId}', {
          params: { path: { estateId } },
          body: {
            name: form.name.trim(),
            address: form.address.trim() || undefined,
            state: form.state.trim() || undefined,
            lga: form.lga.trim() || undefined,
          },
        }),
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(['estate', estateId, 'profile'], data);
      void queryClient.invalidateQueries({ queryKey: ['me', 'memberships'] });
    },
  });
  const set = (key: keyof typeof form) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));
  return (
    <Panel title={t('settings.profile.title')}>
      <form
        className="sz-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (form.name.trim()) save.mutate();
        }}
      >
        <div className="sz-form-2">
          <InputField
            label={t('settings.profile.name')}
            value={form.name}
            onChange={set('name')}
            required
            error={form.name.trim() ? null : t('settings.profile.nameRequired')}
            maxLength={120}
          />
          <div className="sz-field">
            <span style={{ fontSize: 14, fontWeight: 500 }}>{t('settings.profile.code')}</span>
            <strong
              className="sz-num"
              style={{ minHeight: 40, display: 'flex', alignItems: 'center' }}
            >
              {estate.code}
            </strong>
            <small>{t('settings.profile.codeHelp')}</small>
          </div>
        </div>
        <InputField
          label={t('settings.profile.address')}
          value={form.address}
          onChange={set('address')}
          maxLength={240}
        />
        <div className="sz-form-2">
          <InputField
            label={t('settings.profile.state')}
            value={form.state}
            onChange={set('state')}
            maxLength={60}
          />
          <InputField
            label={t('settings.profile.lga')}
            value={form.lga}
            onChange={set('lga')}
            maxLength={60}
          />
        </div>
        <p className="sz-muted" style={{ margin: 0, fontSize: 13 }}>
          {t('settings.profile.fixed', { timezone: estate.timezone, currency: estate.currency })}
        </p>
        <FormError message={save.isError ? errorText(save.error) : null} />
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <ActionButton type="submit" busy={save.isPending}>
            {t('common.save')}
          </ActionButton>
          <SavedNote show={save.isSuccess} />
        </div>
      </form>
    </Panel>
  );
}

const ESCALATION_TARGETS: Escalation['target'][] = [
  'next_guard',
  'supervisor_and_managers',
  'emergency_contacts_voice',
];
const TENANT_APPROVAL: TenantApproval[] = [
  'owner_then_manager_override',
  'manager_only',
  'owner_only',
];

function PoliciesForm({ settings }: { settings: Settings }) {
  const { estateId } = useEstate();
  const queryClient = useQueryClient();
  const [tenantApproval, setTenantApproval] = useState(settings.tenant_approval);
  const [maxPassDays, setMaxPassDays] = useState(String(settings['visitor.max_pass_days']));
  const [walkinTimeout, setWalkinTimeout] = useState(
    String(settings['visitor.walkin_timeout_seconds']),
  );
  const [requirePhoto, setRequirePhoto] = useState(settings['visitor.require_photo']);
  const [staffApproval, setStaffApproval] = useState(
    settings['staff_pass.requires_manager_approval'],
  );
  const [guardPhone, setGuardPhone] = useState(settings['guards.can_see_resident_phone']);
  const [countdown, setCountdown] = useState(String(settings['sos.cancel_countdown_seconds']));
  const [escalation, setEscalation] = useState<Escalation[]>(settings['sos.escalation']);

  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.PATCH('/v1/estates/{estateId}/settings', {
          params: { path: { estateId } },
          body: {
            tenant_approval: tenantApproval,
            'visitor.max_pass_days': Number(maxPassDays),
            'visitor.walkin_timeout_seconds': Number(walkinTimeout),
            'visitor.require_photo': requirePhoto,
            'staff_pass.requires_manager_approval': staffApproval,
            'guards.can_see_resident_phone': guardPhone,
            'sos.cancel_countdown_seconds': Number(countdown),
            'sos.escalation': escalation,
          },
        }),
      ),
    onSuccess: (data) => queryClient.setQueryData(['estate', estateId, 'settings'], data),
  });

  const updateStep = (index: number, patch: Partial<Escalation>) =>
    setEscalation((steps) => steps.map((step, i) => (i === index ? { ...step, ...patch } : step)));

  return (
    <Panel title={t('settings.policies.title')}>
      <form
        className="sz-form"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <h3 style={{ margin: 0, fontSize: 16 }}>{t('settings.policies.residents')}</h3>
        <SelectField
          label={t('settings.policies.tenantApproval')}
          value={tenantApproval}
          onChange={setTenantApproval}
          options={TENANT_APPROVAL.map((value) => ({
            value,
            label: t(`settings.tenantApproval.${value}` as MessageKey),
          }))}
        />

        <h3 style={{ margin: '8px 0 0', fontSize: 16 }}>{t('settings.policies.visitors')}</h3>
        <div className="sz-form-2">
          <InputField
            label={t('settings.policies.maxPassDays')}
            type="number"
            inputMode="numeric"
            min={1}
            value={maxPassDays}
            onChange={setMaxPassDays}
          />
          <InputField
            label={t('settings.policies.walkinTimeout')}
            type="number"
            inputMode="numeric"
            min={30}
            value={walkinTimeout}
            onChange={setWalkinTimeout}
            helper={t('settings.policies.walkinTimeoutHelp')}
          />
        </div>
        <CheckboxField
          label={t('settings.policies.requirePhoto')}
          checked={requirePhoto}
          onChange={setRequirePhoto}
        />
        <CheckboxField
          label={t('settings.policies.staffApproval')}
          checked={staffApproval}
          onChange={setStaffApproval}
        />
        <CheckboxField
          label={t('settings.policies.guardPhone')}
          checked={guardPhone}
          onChange={setGuardPhone}
          helper={t('settings.policies.guardPhoneHelp')}
        />

        <h3 style={{ margin: '8px 0 0', fontSize: 16 }}>{t('settings.policies.sos')}</h3>
        <div style={{ maxWidth: 260 }}>
          <InputField
            label={t('settings.policies.countdown')}
            type="number"
            inputMode="numeric"
            min={0}
            max={30}
            value={countdown}
            onChange={setCountdown}
            helper={t('settings.policies.countdownHelp')}
          />
        </div>
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 12 }}>
          <legend style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>
            {t('settings.policies.escalation')}
          </legend>
          {escalation.map((step, index) => (
            <div
              key={index}
              style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}
            >
              <div style={{ width: 160 }}>
                <InputField
                  label={t('settings.policies.escalationAfter')}
                  type="number"
                  inputMode="numeric"
                  min={10}
                  value={String(step.afterSeconds)}
                  onChange={(value) => updateStep(index, { afterSeconds: Number(value) })}
                />
              </div>
              <div style={{ width: 280 }}>
                <SelectField
                  label={t('settings.policies.escalationTarget')}
                  value={step.target}
                  onChange={(value) => updateStep(index, { target: value })}
                  options={ESCALATION_TARGETS.map((value) => ({
                    value,
                    label: t(`settings.escalationTarget.${value}` as MessageKey),
                  }))}
                />
              </div>
              <ActionButton
                variant="text"
                onClick={() => setEscalation((steps) => steps.filter((_, i) => i !== index))}
              >
                {t('settings.policies.escalationRemove')}
              </ActionButton>
            </div>
          ))}
          <div>
            <ActionButton
              variant="outline"
              size="sm"
              icon="plus"
              onClick={() =>
                setEscalation((steps) => [
                  ...steps,
                  {
                    afterSeconds: (steps[steps.length - 1]?.afterSeconds ?? 0) + 60,
                    target: 'supervisor_and_managers',
                  },
                ])
              }
            >
              {t('settings.policies.escalationAdd')}
            </ActionButton>
          </div>
        </fieldset>
        <FormError message={save.isError ? errorText(save.error) : null} />
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <ActionButton type="submit" busy={save.isPending}>
            {t('common.save')}
          </ActionButton>
          <SavedNote show={save.isSuccess} />
        </div>
      </form>
    </Panel>
  );
}

export function EstateSettingsScreen() {
  const { estateId } = useEstate();
  const estate = useQuery({
    queryKey: ['estate', estateId, 'profile'],
    queryFn: () => unwrap(api.GET('/v1/estates/{estateId}', { params: { path: { estateId } } })),
  });
  const settings = useQuery({
    queryKey: ['estate', estateId, 'settings'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/settings', { params: { path: { estateId } } })),
  });
  return (
    <>
      <PageHeader title={t('settings.title')} description={t('settings.description')} />
      <Banner tone="info">{t('settings.setupHint')}</Banner>
      <div style={{ display: 'grid', gap: 24, maxWidth: 960 }}>
        {estate.isPending ? <Skeleton height={240} /> : null}
        {estate.isError ? (
          <ErrorState message={errorText(estate.error)} onRetry={() => void estate.refetch()} />
        ) : null}
        {estate.data ? <ProfileForm key={estate.data.version} estate={estate.data} /> : null}
        {settings.isPending ? <Skeleton height={320} /> : null}
        {settings.isError ? (
          <ErrorState message={errorText(settings.error)} onRetry={() => void settings.refetch()} />
        ) : null}
        {settings.data ? <PoliciesForm settings={settings.data} /> : null}
      </div>
    </>
  );
}
