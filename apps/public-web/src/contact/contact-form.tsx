'use client';

import { unwrap } from '@safezone/api-client';
import { type MessageKey, t } from '@safezone/i18n';
import { normalizeNigerianPhone, onboardingLeadSchema } from '@safezone/schemas';
import {
  ActionButton,
  Banner,
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

const PREFERRED_TIMES = ['any', 'morning', 'afternoon', 'evening'] as const;
type PreferredTime = (typeof PREFERRED_TIMES)[number];

/** Techguard-assisted onboarding lead form (public-web.md §6). */
export function ContactForm() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [estateName, setEstateName] = useState('');
  const [location, setLocation] = useState('');
  const [units, setUnits] = useState('');
  const [preferredTime, setPreferredTime] = useState<PreferredTime>('any');
  const [message, setMessage] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: (body: {
      name: string;
      phone: string;
      email?: string;
      estateName: string;
      location: string;
      unitsEstimate?: number;
      message?: string;
    }) => unwrap(api.POST('/v1/public/onboarding-leads', { body })),
  });

  if (send.isSuccess) {
    return (
      <Panel title={t('public.contact.form.sentTitle')}>
        <div style={{ display: 'grid', gap: 12 }}>
          <Banner tone="success">{t('public.contact.form.sent')}</Banner>
          <p className="sz-muted" style={{ margin: 0, fontSize: 14 }}>
            {t('public.contact.form.ref', { id: send.data.id })}
          </p>
          <p style={{ margin: 0 }}>
            {t('public.contact.form.orRegister')}{' '}
            <Link href="/register">{t('public.contact.form.registerLink')}</Link>.
          </p>
        </div>
      </Panel>
    );
  }

  function handleSubmit() {
    setValidationError(null);
    const normalizedPhone = normalizeNigerianPhone(phone.trim());
    if (!normalizedPhone) {
      setValidationError(t('public.contact.form.required'));
      return;
    }
    const parsedUnits = units.trim() ? Number(units) : undefined;
    const timeNote =
      preferredTime !== 'any'
        ? `${t('public.contact.form.preferredTime')}: ${t(`public.contact.form.time.${preferredTime}` as MessageKey)}`
        : '';
    const combinedMessage = [timeNote, message.trim()].filter(Boolean).join('\n\n');

    const payload = {
      name: name.trim(),
      phone: normalizedPhone,
      ...(email.trim() ? { email: email.trim() } : {}),
      estateName: estateName.trim(),
      location: location.trim(),
      ...(parsedUnits !== undefined && Number.isInteger(parsedUnits) && parsedUnits > 0
        ? { unitsEstimate: parsedUnits }
        : {}),
      ...(combinedMessage ? { message: combinedMessage.slice(0, 2000) } : {}),
    };
    const check = onboardingLeadSchema.safeParse(payload);
    if (!check.success) {
      setValidationError(t('public.contact.form.required'));
      return;
    }
    send.mutate(check.data);
  }

  return (
    <Panel title={t('public.contact.form.title')}>
      <form
        className="sz-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
      >
        <InputField
          label={t('public.contact.form.name')}
          value={name}
          onChange={setName}
          maxLength={120}
          required
        />
        <InputField
          label={t('public.contact.form.phone')}
          type="tel"
          value={phone}
          onChange={setPhone}
          maxLength={20}
          required
        />
        <InputField
          label={t('public.contact.form.email')}
          type="email"
          value={email}
          onChange={setEmail}
          maxLength={200}
        />
        <InputField
          label={t('public.contact.form.estateName')}
          value={estateName}
          onChange={setEstateName}
          maxLength={160}
          required
        />
        <InputField
          label={t('public.contact.form.location')}
          value={location}
          onChange={setLocation}
          maxLength={200}
          required
        />
        <InputField
          label={t('public.contact.form.units')}
          type="number"
          value={units}
          onChange={setUnits}
          min={1}
          max={100000}
        />
        <SelectField
          label={t('public.contact.form.preferredTime')}
          value={preferredTime}
          onChange={setPreferredTime}
          options={PREFERRED_TIMES.map((value) => ({
            value,
            label: t(`public.contact.form.time.${value}` as MessageKey),
          }))}
        />
        <TextAreaField
          label={t('public.contact.form.message')}
          value={message}
          onChange={setMessage}
          rows={4}
          maxLength={1800}
        />
        <FormError message={validationError ?? (send.isError ? errorText(send.error) : null)} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <ActionButton type="submit" busy={send.isPending}>
            {t('public.contact.form.submit')}
          </ActionButton>
          <span className="sz-muted" style={{ fontSize: 14 }}>
            {t('public.contact.form.orRegister')}{' '}
            <Link href="/register">{t('public.contact.form.registerLink')}</Link>
          </span>
        </div>
      </form>
    </Panel>
  );
}
