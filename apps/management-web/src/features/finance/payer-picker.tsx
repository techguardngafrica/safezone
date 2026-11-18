'use client';

import { type ApiRow, unwrapPage } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import { ActionButton, InputField } from '@safezone/web-ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useEstate } from '../../../lib/estate';
import { api } from '../../../lib/session';

type Resident = ApiRow<'/v1/estates/{estateId}/residents', 'get'>;
export interface Payer {
  userId: string;
  name: string;
  unitId: string;
  unitCode: string;
}

function useDebounced(value: string, ms = 300): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/** Search residents with an account and pick who pays (and which unit). */
export function PayerPicker({
  value,
  onChange,
  error,
}: {
  value: Payer | null;
  onChange: (payer: Payer | null) => void;
  error?: string | null;
}) {
  const { estateId } = useEstate();
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const results = useQuery({
    queryKey: ['estate', estateId, 'residents', 'picker', q],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/residents', {
          params: { path: { estateId }, query: { q, limit: 8 } },
        }),
      ),
    enabled: !value && q.length >= 2,
  });

  if (value)
    return (
      <div className="sz-field">
        <span style={{ fontSize: 14, fontWeight: 600 }}>{t('finance.payerPicker.label')}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span>
            <strong>{value.name}</strong> <span className="sz-muted">· {value.unitCode}</span>
          </span>
          <ActionButton variant="text" size="sm" onClick={() => onChange(null)}>
            {t('finance.payerPicker.change')}
          </ActionButton>
        </div>
      </div>
    );

  const people = (results.data?.items ?? []).filter(
    (row): row is Resident & { userId: string } => row.userId !== null,
  );
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <InputField
        type="search"
        label={t('finance.payerPicker.label')}
        placeholder={t('finance.payerPicker.placeholder')}
        helper={t('finance.payerPicker.helper')}
        value={search}
        onChange={setSearch}
        error={error}
        maxLength={60}
      />
      {q.length >= 2 && results.data ? (
        people.length === 0 ? (
          <p className="sz-muted" style={{ margin: 0, fontSize: 14 }}>
            {t('finance.payerPicker.none')}
          </p>
        ) : (
          <ul
            aria-label={t('finance.payerPicker.label')}
            style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}
          >
            {people.map((row) => (
              <li key={row.memberId}>
                <ActionButton
                  variant="outline"
                  size="sm"
                  style={{ width: '100%', justifyContent: 'flex-start' }}
                  onClick={() =>
                    onChange({
                      userId: row.userId,
                      name: row.fullName,
                      unitId: row.unit.id,
                      unitCode: row.unit.code,
                    })
                  }
                >
                  {row.fullName} · {row.unit.code}
                </ActionButton>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

/**
 * Names for payer ids in payment tables. The API returns ids only, so this reads the estate's first
 * 100 residents; anyone beyond that shows as "Resident" until a payer-name field is added to the API.
 */
export function useResidentNames(): (userId: string) => string {
  const { estateId, can } = useEstate();
  const directory = useQuery({
    queryKey: ['estate', estateId, 'residents', 'directory'],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/residents', {
          params: { path: { estateId }, query: { limit: 100 } },
        }),
      ),
    enabled: can('resident.read'),
    staleTime: 5 * 60_000,
  });
  const names = new Map<string, string>();
  for (const row of directory.data?.items ?? [])
    if (row.userId && !names.has(row.userId))
      names.set(row.userId, `${row.fullName} (${row.unit.code})`);
  return (userId) => names.get(userId) ?? t('finance.unknownPayer');
}
