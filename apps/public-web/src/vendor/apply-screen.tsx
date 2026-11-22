'use client';

import { unwrap } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  CheckboxField,
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
import { useState } from 'react';
import { errorText, formErrors } from '../../lib/errors';
import { api } from '../../lib/session';

type VendorType = 'individual' | 'company';
type Field = 'name' | 'cacNumber' | 'description' | 'contactEmail' | 'categoryIds' | 'serviceAreas';

/** Vendor application (marketplace.md §2.1): the applicant becomes the Vendor Owner. */
export function ApplyScreen() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [type, setType] = useState<VendorType>('individual');
  const [cacNumber, setCacNumber] = useState('');
  const [description, setDescription] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [states, setStates] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});

  const categories = useQuery({
    queryKey: ['marketplace', 'categories'],
    queryFn: () => unwrap(api.GET('/v1/marketplace/categories')),
  });

  const submit = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/vendor-applications', {
          body: {
            name: name.trim(),
            type,
            ...(type === 'company' ? { cacNumber: cacNumber.trim() } : {}),
            description: description.trim(),
            contactEmail: contactEmail.trim(),
            categoryIds,
            serviceAreas: areaList(states).map((state) => ({ state })),
            documentFileIds: [],
          },
        }),
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['me', 'vendors'] }),
    onError: (error) =>
      setErrors(
        formErrors<Field>(error, {
          name: 'name',
          cacNumber: 'cacNumber',
          description: 'description',
          contactEmail: 'contactEmail',
          categoryIds: 'categoryIds',
          serviceAreas: 'serviceAreas',
        }).fields,
      ),
  });

  function validate(): boolean {
    const next: Partial<Record<Field, string>> = {};
    if (name.trim().length < 2) next.name = t('vendor.apply.nameRequired');
    if (categoryIds.length === 0) next.categoryIds = t('vendor.apply.categoriesRequired');
    if (areaList(states).length === 0) next.serviceAreas = t('vendor.apply.areasRequired');
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function toggleCategory(id: string, on: boolean) {
    setCategoryIds((current) =>
      on ? [...current, id].slice(0, 10) : current.filter((c) => c !== id),
    );
  }

  return (
    <>
      <PageHeader title={t('vendor.apply.title')} description={t('vendor.apply.description')} />
      <Panel>
        <form
          className="sz-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (validate()) submit.mutate();
          }}
          noValidate
        >
          <InputField
            label={t('vendor.apply.name')}
            value={name}
            onChange={setName}
            error={errors.name}
            maxLength={120}
            required
            autoFocus
          />
          <SelectField
            label={t('vendor.apply.type')}
            value={type}
            onChange={setType}
            options={[
              { value: 'individual', label: t('vendor.apply.type.individual') },
              { value: 'company', label: t('vendor.apply.type.company') },
            ]}
          />
          {type === 'company' ? (
            <InputField
              label={t('vendor.apply.cac')}
              helper={t('vendor.apply.cacHelper')}
              value={cacNumber}
              onChange={setCacNumber}
              error={errors.cacNumber}
              maxLength={20}
              required
            />
          ) : null}
          <TextAreaField
            label={t('vendor.apply.descriptionField')}
            helper={t('vendor.apply.descriptionHelper')}
            value={description}
            onChange={setDescription}
            error={errors.description}
            rows={4}
            maxLength={2000}
            required
          />
          <InputField
            label={t('vendor.apply.email')}
            type="email"
            value={contactEmail}
            onChange={setContactEmail}
            error={errors.contactEmail}
            maxLength={200}
            required
          />
          <fieldset className="sz-field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={{ fontWeight: 600, marginBottom: 8 }}>
              {t('vendor.apply.categories')}
            </legend>
            <small>{t('vendor.apply.categoriesHelper')}</small>
            {categories.isPending ? <Skeleton height={80} /> : null}
            {categories.isError ? (
              <ErrorState
                message={errorText(categories.error)}
                onRetry={() => void categories.refetch()}
              />
            ) : null}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: 4,
              }}
            >
              {categories.data?.map((category) => (
                <CheckboxField
                  key={category.id}
                  label={category.name}
                  checked={categoryIds.includes(category.id)}
                  onChange={(on) => toggleCategory(category.id, on)}
                />
              ))}
            </div>
            <FormError message={errors.categoryIds} />
          </fieldset>
          <InputField
            label={t('vendor.apply.areas')}
            helper={t('vendor.apply.areasHelper')}
            value={states}
            onChange={setStates}
            error={errors.serviceAreas}
            maxLength={400}
            required
          />
          <FormError
            message={
              submit.isError && Object.keys(errors).length === 0 ? errorText(submit.error) : null
            }
          />
          <div>
            <ActionButton type="submit" busy={submit.isPending}>
              {t('vendor.apply.submit')}
            </ActionButton>
          </div>
        </form>
      </Panel>
    </>
  );
}

function areaList(input: string): string[] {
  return [
    ...new Set(
      input
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length >= 2),
    ),
  ].slice(0, 50);
}
