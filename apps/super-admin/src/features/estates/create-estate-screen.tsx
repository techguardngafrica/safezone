'use client';

import { unwrap } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  FormError,
  InputField,
  PageHeader,
  Panel,
  SelectField,
} from '@safezone/web-ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api } from '../../../lib/session';
import { errorText } from '../../lib/errors';

export function CreateEstateScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();

  const leadId = searchParams.get('leadId') || undefined;
  const [name, setName] = useState(searchParams.get('name') ?? '');
  const [type, setType] = useState<'gated_houses' | 'apartment_complex' | 'mixed'>('gated_houses');
  const [address, setAddress] = useState('');
  const [state, setState] = useState('Lagos');
  const [lga, setLga] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/platform/estates', {
          body: {
            name: name.trim(),
            type,
            address: address.trim(),
            state: state.trim(),
            lga: lga.trim(),
            ...(leadId ? { leadId } : {}),
          },
        }),
      ),
    onSuccess: (estate) => {
      void qc.invalidateQueries({ queryKey: ['platform', 'estates'] });
      void qc.invalidateQueries({ queryKey: ['platform', 'leads'] });
      void qc.invalidateQueries({ queryKey: ['platform', 'overview'] });
      router.push(`/estates/${estate.id}`);
    },
    onError: (err) => setError(errorText(err)),
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    create.mutate();
  };

  return (
    <>
      <PageHeader
        title={t('admin.estates.createTitle')}
        description={t('admin.estates.createDescription')}
        breadcrumbs={<Link href="/estates">{t('admin.estates.title')}</Link>}
      />
      <div style={{ maxWidth: 640 }}>
        <Panel>
          <form
            onSubmit={handleSubmit}
            style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
          >
            <FormError message={error} />
            <InputField
              label="Estate name"
              value={name}
              onChange={setName}
              required
              placeholder="e.g. Victoria Garden City"
            />
            <SelectField
              label="Estate type"
              value={type}
              onChange={(v) => setType(v as 'gated_houses' | 'apartment_complex' | 'mixed')}
              options={[
                { value: 'gated_houses', label: 'Gated houses' },
                { value: 'apartment_complex', label: 'Apartment complex' },
                { value: 'mixed', label: 'Mixed' },
              ]}
            />
            <InputField
              label="Street address"
              value={address}
              onChange={setAddress}
              required
              placeholder="Full physical address"
            />
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
              <InputField label="State" value={state} onChange={setState} required />
              <InputField
                label="LGA"
                value={lga}
                onChange={setLga}
                required
                placeholder="e.g. Eti-Osa"
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <ActionButton type="submit" disabled={create.isPending}>
                Create estate
              </ActionButton>
              <ActionButton variant="outline" onClick={() => router.back()}>
                Cancel
              </ActionButton>
            </div>
          </form>
        </Panel>
      </div>
    </>
  );
}
