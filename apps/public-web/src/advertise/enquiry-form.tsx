'use client';

import { unwrap } from '@safezone/api-client';
import { type MessageKey, t } from '@safezone/i18n';
import {
  AD_CATEGORIES,
  AD_PLACEMENT_KEYS,
  type AdCategory,
  type AdPlacementKey,
} from '@safezone/schemas';
import {
  ActionButton,
  Banner,
  CheckboxField,
  FormError,
  InputField,
  Panel,
  SelectField,
  TextAreaField,
} from '@safezone/web-ui';
import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { errorText } from '../../lib/errors';
import { api } from '../../lib/session';

const BUDGETS = ['under_100k', '100k_500k', '500k_2m', '2m_10m', 'over_10m', 'not_sure'] as const;
type Budget = (typeof BUDGETS)[number];
/** Tobacco is not accepted (advertising.md rule 12), so it is not offered. */
const CATEGORIES = AD_CATEGORIES.filter((c) => c !== 'tobacco');

/** Advertising enquiry (public-web.md §7). Sent to Techguard; nothing is charged here. */
export function EnquiryForm() {
  const [type, setType] = useState<'individual' | 'organisation'>('organisation');
  const [contactName, setContactName] = useState('');
  const [orgName, setOrgName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [category, setCategory] = useState<AdCategory>('retail');
  const [objectives, setObjectives] = useState('');
  const [description, setDescription] = useState('');
  const [budgetRange, setBudgetRange] = useState<Budget>('not_sure');
  const [weeks, setWeeks] = useState('');
  const [audience, setAudience] = useState('');
  const [placements, setPlacements] = useState<AdPlacementKey[]>([]);
  const [consent, setConsent] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [copied, setCopied] = useState(false);

  const send = useMutation({
    mutationFn: () => {
      const durationWeeks = Number(weeks);
      return unwrap(
        api.POST('/v1/public/ad-enquiries', {
          body: {
            advertiserType: type,
            contactName: contactName.trim(),
            ...(type === 'organisation' && orgName.trim() ? { orgName: orgName.trim() } : {}),
            phone: phone.trim(),
            email: email.trim(),
            category,
            objectives: objectives.trim(),
            description: description.trim(),
            budgetRange,
            ...(Number.isInteger(durationWeeks) && durationWeeks >= 1 && durationWeeks <= 52
              ? { durationWeeks }
              : {}),
            ...(audience.trim() ? { audience: audience.trim() } : {}),
            placements,
            consent: true,
          },
        }),
      );
    },
  });

  if (send.isSuccess) {
    const statusPath = `/advertise/status/${send.data.trackingToken}`;
    const fullUrl =
      typeof window !== 'undefined' ? `${window.location.origin}${statusPath}` : statusPath;
    return (
      <Panel title={t('public.advertise.form.title')}>
        <div style={{ display: 'grid', gap: 12 }}>
          <Banner tone="success">{t('public.advertise.form.sent')}</Banner>
          <p style={{ margin: 0 }}>{t('public.advertise.form.trackHelp')}</p>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <Link
              href={statusPath}
              className="sz-btn sz-btn-primary"
              style={{ textDecoration: 'none' }}
            >
              {t('public.advertise.form.trackLink')}
            </Link>
            <ActionButton
              variant="outline"
              size="sm"
              onClick={() => {
                if (typeof navigator !== 'undefined' && navigator.clipboard) {
                  void navigator.clipboard.writeText(fullUrl);
                  setCopied(true);
                }
              }}
            >
              {copied ? t('public.advertise.form.copied') : t('public.advertise.form.copyLink')}
            </ActionButton>
          </div>
        </div>
      </Panel>
    );
  }

  const valid =
    contactName.trim().length >= 2 &&
    phone.trim().length >= 7 &&
    /\S+@\S+\.\S+/.test(email) &&
    objectives.trim().length >= 3 &&
    description.trim().length >= 10 &&
    consent;

  return (
    <Panel title={t('public.advertise.form.title')}>
      <form
        className="sz-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setInvalid(!valid);
          if (valid) send.mutate();
        }}
      >
        <SelectField
          label={t('public.advertise.form.who')}
          value={type}
          onChange={setType}
          options={[
            { value: 'organisation', label: t('public.advertise.form.organisation') },
            { value: 'individual', label: t('public.advertise.form.individual') },
          ]}
        />
        <InputField
          label={t('public.advertise.form.name')}
          value={contactName}
          onChange={setContactName}
          maxLength={120}
          required
        />
        {type === 'organisation' ? (
          <InputField
            label={t('public.advertise.form.org')}
            value={orgName}
            onChange={setOrgName}
            maxLength={160}
          />
        ) : null}
        <InputField
          label={t('public.advertise.form.phone')}
          type="tel"
          value={phone}
          onChange={setPhone}
          maxLength={20}
          required
        />
        <InputField
          label={t('public.advertise.form.email')}
          type="email"
          value={email}
          onChange={setEmail}
          maxLength={200}
          required
        />
        <SelectField
          label={t('public.advertise.form.category')}
          value={category}
          onChange={setCategory}
          options={CATEGORIES.map((value) => ({
            value,
            label: t(`ads.category.${value}` as MessageKey),
          }))}
        />
        <InputField
          label={t('public.advertise.form.objectives')}
          value={objectives}
          onChange={setObjectives}
          maxLength={500}
          required
        />
        <TextAreaField
          label={t('public.advertise.form.description')}
          value={description}
          onChange={setDescription}
          rows={4}
          maxLength={4000}
          required
        />
        <SelectField
          label={t('public.advertise.form.budget')}
          value={budgetRange}
          onChange={setBudgetRange}
          options={BUDGETS.map((value) => ({
            value,
            label: t(`public.advertise.budget.${value}` as MessageKey),
          }))}
        />
        <InputField
          label={t('public.advertise.form.weeks')}
          type="number"
          value={weeks}
          onChange={setWeeks}
          min={1}
          max={52}
        />
        <InputField
          label={t('public.advertise.form.audience')}
          value={audience}
          onChange={setAudience}
          maxLength={1000}
        />
        <fieldset className="sz-field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 600, marginBottom: 8 }}>
            {t('public.advertise.form.placements')}
          </legend>
          {AD_PLACEMENT_KEYS.map((key) => (
            <CheckboxField
              key={key}
              label={t(`ads.placement.${key}` as MessageKey)}
              checked={placements.includes(key)}
              onChange={(on) =>
                setPlacements((current) =>
                  on ? [...current, key] : current.filter((p) => p !== key),
                )
              }
            />
          ))}
        </fieldset>
        <CheckboxField
          label={
            <>
              {t('public.advertise.form.consent')}{' '}
              <Link href="/legal/ad-policy">{t('public.legal.adPolicy')}</Link>,{' '}
              <Link href="/legal/privacy">{t('public.legal.privacy')}</Link>
            </>
          }
          checked={consent}
          onChange={setConsent}
        />
        <FormError
          message={
            invalid
              ? t('public.advertise.form.required')
              : send.isError
                ? errorText(send.error)
                : null
          }
        />
        <div>
          <ActionButton type="submit" busy={send.isPending}>
            {t('public.advertise.form.submit')}
          </ActionButton>
        </div>
      </form>
    </Panel>
  );
}
