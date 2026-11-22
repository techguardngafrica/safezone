'use client';

import { unwrap } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  CheckboxField,
  DataTable,
  Dialog,
  ErrorState,
  FormError,
  InputField,
  PageHeader,
  StatusPill,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../../lib/session';
import { errorText } from '../../lib/errors';
import { formatWat } from '../../lib/format';

export function FlagsScreen() {
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [key, setKey] = useState('');
  const [description, setDescription] = useState('');
  const [defaultEnabled, setDefaultEnabled] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const [percent, setPercent] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['platform', 'flags'],
    queryFn: () => unwrap(api.GET('/v1/platform/feature-flags')),
  });

  const save = useMutation({
    mutationFn: () => {
      const pct = percent.trim() === '' ? undefined : Number(percent);
      return unwrap(
        api.PUT('/v1/platform/feature-flags/{key}', {
          params: { path: { key: key.trim() } },
          body: {
            description: description.trim(),
            defaultEnabled,
            isPublic,
            rules: pct !== undefined && !Number.isNaN(pct) ? { percent: pct } : {},
          },
        }),
      );
    },
    onSuccess: () => {
      setEditOpen(false);
      setActionError(null);
      void qc.invalidateQueries({ queryKey: ['platform', 'flags'] });
    },
    onError: (err) => setActionError(errorText(err)),
  });

  return (
    <>
      <PageHeader
        title={t('admin.flags.title')}
        description={t('admin.flags.description')}
        actions={
          <ActionButton
            icon="flag"
            onClick={() => {
              setActionError(null);
              setKey('');
              setDescription('');
              setDefaultEnabled(false);
              setIsPublic(false);
              setPercent('');
              setEditOpen(true);
            }}
          >
            {t('admin.flags.new')}
          </ActionButton>
        }
      />

      {list.isError ? (
        <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />
      ) : (
        <DataTable
          caption="Feature flags"
          loading={list.isPending}
          rows={list.data ?? []}
          rowKey={(row) => row.key}
          empty={{ icon: 'flag', title: t('admin.flags.empty') }}
          columns={[
            {
              key: 'key',
              header: 'Flag key',
              render: (row) => (
                <div>
                  <code>{row.key}</code>
                  <div className="sz-muted" style={{ fontSize: 12 }}>
                    {row.description}
                  </div>
                </div>
              ),
            },
            {
              key: 'default',
              header: 'Default',
              render: (row) => (
                <StatusPill
                  tone={row.defaultEnabled ? 'success' : 'neutral'}
                  label={row.defaultEnabled ? 'Enabled' : 'Disabled'}
                />
              ),
            },
            {
              key: 'public',
              header: 'Scope',
              render: (row) => (row.isPublic ? 'Public (pre-auth)' : 'Authenticated'),
            },
            {
              key: 'rules',
              header: 'Rollout',
              render: (row) =>
                row.rules.percent !== undefined ? `${row.rules.percent}%` : 'Default only',
            },
            { key: 'updated', header: 'Updated', render: (row) => formatWat(row.updatedAt) },
            {
              key: 'edit',
              header: '',
              render: (row) => (
                <ActionButton
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setActionError(null);
                    setKey(row.key);
                    setDescription(row.description);
                    setDefaultEnabled(row.defaultEnabled);
                    setIsPublic(row.isPublic);
                    setPercent(row.rules.percent !== undefined ? String(row.rules.percent) : '');
                    setEditOpen(true);
                  }}
                >
                  Edit
                </ActionButton>
              ),
            },
          ]}
        />
      )}

      {editOpen ? (
        <Dialog
          title={t('admin.flags.new')}
          onClose={() => setEditOpen(false)}
          onSubmit={() => save.mutate()}
          actions={
            <>
              <ActionButton variant="outline" onClick={() => setEditOpen(false)}>
                Cancel
              </ActionButton>
              <ActionButton
                type="submit"
                disabled={key.trim().length < 3 || description.trim().length < 3 || save.isPending}
              >
                Save flag
              </ActionButton>
            </>
          }
        >
          <FormError message={actionError} />
          <InputField
            label="Flag key (lower_snake_case)"
            value={key}
            onChange={setKey}
            required
            placeholder="e.g. prepaid_tokens_v2"
          />
          <InputField label="Description" value={description} onChange={setDescription} required />
          <CheckboxField
            label="Enabled by default"
            checked={defaultEnabled}
            onChange={setDefaultEnabled}
          />
          <CheckboxField
            label="Expose before sign-in (public app-config)"
            checked={isPublic}
            onChange={setIsPublic}
          />
          <InputField
            label="Percentage rollout (0 to 100, optional)"
            type="number"
            value={percent}
            onChange={setPercent}
          />
        </Dialog>
      ) : null}
    </>
  );
}
