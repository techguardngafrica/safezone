'use client';

import { unwrap } from '@safezone/api-client';
import { type MessageKey, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  DetailList,
  ErrorState,
  FormError,
  InputField,
  PageHeader,
  Panel,
  SelectField,
  Skeleton,
  TextAreaField,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { errorText } from '../../lib/errors';
import { api } from '../../lib/session';
import { useVendor } from './vendor-context';

function PayoutPanel({
  current,
}: {
  current: { ready: boolean; bankName: string | null; accountLast4: string | null };
}) {
  const { vendorId } = useVendor();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(!current.ready);
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [done, setDone] = useState(false);
  const banks = useQuery({
    queryKey: ['payments', 'banks'],
    enabled: editing,
    queryFn: () => unwrap(api.GET('/v1/payments/banks')),
  });
  const link = useMutation({
    mutationFn: () =>
      unwrap(
        api.PUT('/v1/vendors/{vendorId}/payout-account', {
          params: { path: { vendorId } },
          body: { bankCode, accountNumber: accountNumber.trim() },
        }),
      ),
    onSuccess: () => {
      setDone(true);
      setEditing(false);
      setAccountNumber('');
      void queryClient.invalidateQueries({ queryKey: ['vendor', vendorId] });
    },
  });
  const validAccount = /^\d{10}$/.test(accountNumber.trim());
  return (
    <Panel
      title={t('vendor.payout.title')}
      actions={
        current.ready && !editing ? (
          <ActionButton variant="outline" size="sm" onClick={() => setEditing(true)}>
            {t('vendor.payout.change')}
          </ActionButton>
        ) : null
      }
    >
      {done ? <Banner tone="success">{t('vendor.payout.linked')}</Banner> : null}
      {current.ready && current.bankName && current.accountLast4 ? (
        <p>{t('vendor.payout.current', { bank: current.bankName, last4: current.accountLast4 })}</p>
      ) : (
        <Banner tone="warning">{t('vendor.payout.none')}</Banner>
      )}
      {editing ? (
        <form
          className="sz-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (bankCode && validAccount) link.mutate();
          }}
        >
          {banks.isError ? (
            <ErrorState message={errorText(banks.error)} onRetry={() => void banks.refetch()} />
          ) : (
            <SelectField
              label={t('vendor.payout.bank')}
              value={bankCode}
              onChange={setBankCode}
              options={[
                { value: '', label: t('vendor.payout.chooseBank') },
                ...(banks.data ?? []).map((bank) => ({ value: bank.code, label: bank.name })),
              ]}
            />
          )}
          <InputField
            label={t('vendor.payout.account')}
            helper={t('vendor.payout.accountHelper')}
            value={accountNumber}
            onChange={(value) => setAccountNumber(value.replace(/\D/g, '').slice(0, 10))}
            inputMode="numeric"
            maxLength={10}
          />
          <FormError message={link.isError ? errorText(link.error) : null} />
          <div>
            <ActionButton type="submit" busy={link.isPending} disabled={!bankCode || !validAccount}>
              {t('vendor.payout.link')}
            </ActionButton>
          </div>
        </form>
      ) : null}
    </Panel>
  );
}

/** Profile and payout (public-web.md §8: Profile, Payouts). */
export function ProfileScreen() {
  const { vendorId } = useVendor();
  const queryClient = useQueryClient();
  const profile = useQuery({
    queryKey: ['vendor', vendorId, 'profile'],
    queryFn: () => unwrap(api.GET('/v1/vendors/{vendorId}', { params: { path: { vendorId } } })),
  });
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [states, setStates] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!profile.data) return;
    setName(profile.data.name);
    setDescription(profile.data.description);
    setContactEmail(profile.data.contactEmail);
    setStates(
      profile.data.serviceAreas
        .map((area) => area.state)
        .filter((s): s is string => Boolean(s))
        .join(', '),
    );
  }, [profile.data]);
  const save = useMutation({
    mutationFn: () => {
      const areas = [
        ...new Set(
          states
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length >= 2),
        ),
      ];
      return unwrap(
        api.PATCH('/v1/vendors/{vendorId}', {
          params: { path: { vendorId } },
          body: {
            name: name.trim(),
            description: description.trim(),
            contactEmail: contactEmail.trim(),
            ...(areas.length > 0 ? { serviceAreas: areas.map((state) => ({ state })) } : {}),
          },
        }),
      );
    },
    onSuccess: () => {
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ['vendor', vendorId] });
      void queryClient.invalidateQueries({ queryKey: ['me', 'vendors'] });
    },
  });

  if (profile.isPending) return <Skeleton height={240} />;
  if (profile.isError)
    return <ErrorState message={errorText(profile.error)} onRetry={() => void profile.refetch()} />;
  const vendor = profile.data;
  const locked = vendor.status === 'rejected';

  return (
    <>
      <PageHeader title={t('vendor.profile.title')} description={t('vendor.profile.description')} />
      <div style={{ display: 'grid', gap: 16 }}>
        <Panel title={t('vendor.profile.details')}>
          <DetailList
            items={[
              {
                label: t('vendor.profile.type'),
                value: t(`vendor.apply.type.${vendor.type}` as MessageKey),
              },
              {
                label: t('vendor.profile.tier'),
                value: t(`vendor.profile.tier.${vendor.verificationTier}` as MessageKey),
              },
              ...(vendor.cacNumber
                ? [{ label: t('vendor.profile.cac'), value: vendor.cacNumber }]
                : []),
            ]}
          />
          <form
            className="sz-form"
            onSubmit={(event) => {
              event.preventDefault();
              setSaved(false);
              save.mutate();
            }}
          >
            <InputField
              label={t('vendor.apply.name')}
              value={name}
              onChange={setName}
              maxLength={120}
            />
            <TextAreaField
              label={t('vendor.apply.descriptionField')}
              value={description}
              onChange={setDescription}
              rows={4}
              maxLength={2000}
            />
            <InputField
              label={t('vendor.apply.email')}
              type="email"
              value={contactEmail}
              onChange={setContactEmail}
              maxLength={200}
            />
            <InputField
              label={t('vendor.profile.areas')}
              helper={t('vendor.apply.areasHelper')}
              value={states}
              onChange={setStates}
              maxLength={400}
            />
            {saved ? <Banner tone="success">{t('vendor.profile.saved')}</Banner> : null}
            <FormError message={save.isError ? errorText(save.error) : null} />
            <div>
              <ActionButton type="submit" busy={save.isPending} disabled={locked}>
                {t('common.save')}
              </ActionButton>
            </div>
          </form>
        </Panel>
        {locked ? null : <PayoutPanel current={vendor.payout} />}
      </div>
    </>
  );
}
