'use client';

import { unwrap } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  DataTable,
  Dialog,
  ErrorState,
  FormError,
  InputField,
  PageHeader,
  SelectField,
  StatusPill,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api } from '../../../lib/session';
import { errorText } from '../../lib/errors';
import { formatWat, humanizeStatus } from '../../lib/format';
import { usePlatform } from '../../lib/platform';

type Scope = 'default' | 'category' | 'vendor';

/** Marketplace commission rules (super-admin.md §6.5). */
export function CommissionsScreen() {
  const qc = useQueryClient();
  const { can } = usePlatform();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope>('default');
  const [scopeId, setScopeId] = useState('');
  const [bps, setBps] = useState('1000');

  const categories = useQuery({
    queryKey: ['marketplace', 'categories'],
    queryFn: () => unwrap(api.GET('/v1/marketplace/categories')),
    staleTime: 10 * 60_000,
  });
  const categoryNames = useMemo(
    () => new Map((categories.data ?? []).map((c) => [c.id, c.name])),
    [categories.data],
  );

  const rules = useQuery({
    queryKey: ['platform', 'commission-rules'],
    queryFn: () => unwrap(api.GET('/v1/platform/commission-rules')),
  });

  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/platform/commission-rules', {
          body: {
            scope,
            ...(scope !== 'default' ? { scopeId: scopeId.trim() } : {}),
            bps: Number(bps),
          },
        }),
      ),
    onSuccess: () => {
      setOpen(false);
      setScope('default');
      setScopeId('');
      setBps('1000');
      void qc.invalidateQueries({ queryKey: ['platform', 'commission-rules'] });
    },
  });

  const bpsNum = Number(bps);
  const canSubmit =
    Number.isInteger(bpsNum) &&
    bpsNum >= 0 &&
    bpsNum <= 3000 &&
    (scope === 'default' || scopeId.trim().length > 0);

  return (
    <>
      <PageHeader
        title={t('admin.vendors.commissions.title')}
        description={t('admin.vendors.commissions.description')}
        actions={
          can('platform.config') ? (
            <ActionButton
              icon="plus"
              onClick={() => {
                save.reset();
                setOpen(true);
              }}
            >
              {t('admin.vendors.commissions.new')}
            </ActionButton>
          ) : null
        }
      />

      {rules.isError ? (
        <ErrorState message={errorText(rules.error)} onRetry={() => void rules.refetch()} />
      ) : (
        <DataTable
          caption={t('admin.vendors.commissions.title')}
          loading={rules.isPending}
          rows={rules.data ?? []}
          rowKey={(row) => row.id}
          empty={{ icon: 'sliders', title: t('admin.vendors.commissions.empty') }}
          columns={[
            {
              key: 'scope',
              header: t('admin.vendors.commissions.scope'),
              render: (row) => (
                <StatusPill
                  tone={row.scope === 'default' ? 'info' : 'neutral'}
                  label={humanizeStatus(row.scope)}
                />
              ),
            },
            {
              key: 'target',
              header: t('admin.vendors.commissions.target'),
              render: (row) => {
                if (row.scope === 'default') return 'Platform default';
                if (row.scope === 'category' && row.scopeId) {
                  return categoryNames.get(row.scopeId) ?? row.scopeId;
                }
                return row.scopeId ?? '-';
              },
            },
            {
              key: 'rate',
              header: t('admin.vendors.commissions.rate'),
              align: 'right',
              render: (row) => `${(row.bps / 100).toFixed(2)}% (${row.bps} bps)`,
            },
            {
              key: 'validFrom',
              header: t('admin.vendors.commissions.validFrom'),
              render: (row) => formatWat(row.validFrom),
            },
          ]}
        />
      )}

      {open ? (
        <Dialog
          title={t('admin.vendors.commissions.new')}
          onClose={() => setOpen(false)}
          onSubmit={() => save.mutate()}
          actions={
            <>
              <ActionButton variant="text" onClick={() => setOpen(false)}>
                {t('common.cancel')}
              </ActionButton>
              <ActionButton type="submit" busy={save.isPending} disabled={!canSubmit}>
                {t('common.save')}
              </ActionButton>
            </>
          }
        >
          <div className="sz-form">
            <SelectField
              label={t('admin.vendors.commissions.scope')}
              value={scope}
              onChange={(value) => {
                setScope(value);
                setScopeId('');
              }}
              options={[
                { value: 'default', label: 'Default' },
                { value: 'category', label: 'Category' },
                { value: 'vendor', label: 'Vendor' },
              ]}
            />
            {scope === 'category' ? (
              <SelectField
                label={t('admin.vendors.commissions.category')}
                value={scopeId}
                onChange={setScopeId}
                options={[
                  { value: '', label: 'Select category' },
                  ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name })),
                ]}
              />
            ) : null}
            {scope === 'vendor' ? (
              <InputField
                label={t('admin.vendors.commissions.vendorId')}
                value={scopeId}
                onChange={setScopeId}
                maxLength={36}
              />
            ) : null}
            <InputField
              label={t('admin.vendors.commissions.bps')}
              type="number"
              value={bps}
              onChange={setBps}
            />
            <FormError message={save.isError ? errorText(save.error) : null} />
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
