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
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../../lib/session';
import { errorText } from '../../lib/errors';
import { formatWat } from '../../lib/format';

type AppName =
  | 'resident-mobile'
  | 'management-web'
  | 'management-mobile'
  | 'security-mobile'
  | 'super-admin'
  | 'public-web';
type PlatformName = 'android' | 'ios' | 'web';

export function VersionsScreen() {
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [app, setApp] = useState<AppName>('resident-mobile');
  const [platform, setPlatform] = useState<PlatformName>('android');
  const [minVersion, setMinVersion] = useState('1.0.0');
  const [recommendedVersion, setRecommendedVersion] = useState('1.0.0');
  const [message, setMessage] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['platform', 'app-versions'],
    queryFn: () => unwrap(api.GET('/v1/platform/app-versions')),
  });

  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.PUT('/v1/platform/app-versions/{app}/{platform}', {
          params: { path: { app, platform } },
          body: {
            minVersion: minVersion.trim(),
            recommendedVersion: recommendedVersion.trim(),
            message: message.trim() || null,
          },
        }),
      ),
    onSuccess: () => {
      setEditOpen(false);
      setActionError(null);
      void qc.invalidateQueries({ queryKey: ['platform', 'app-versions'] });
    },
    onError: (err) => setActionError(errorText(err)),
  });

  return (
    <>
      <PageHeader
        title={t('admin.versions.title')}
        description={t('admin.versions.description')}
        actions={
          <ActionButton
            icon="smartphone"
            onClick={() => {
              setActionError(null);
              setEditOpen(true);
            }}
          >
            {t('admin.versions.new')}
          </ActionButton>
        }
      />

      {list.isError ? (
        <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />
      ) : (
        <DataTable
          caption="App version policies"
          loading={list.isPending}
          rows={list.data ?? []}
          rowKey={(row) => `${row.app}:${row.platform}`}
          empty={{ icon: 'smartphone', title: t('admin.versions.empty') }}
          columns={[
            { key: 'app', header: 'App', render: (row) => <strong>{row.app}</strong> },
            { key: 'platform', header: 'Platform', render: (row) => row.platform },
            {
              key: 'min',
              header: 'Minimum (forced)',
              render: (row) => <code>{row.minVersion}</code>,
            },
            {
              key: 'rec',
              header: 'Recommended (soft)',
              render: (row) => <code>{row.recommendedVersion}</code>,
            },
            { key: 'msg', header: 'Message', render: (row) => row.message ?? '-' },
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
                    setApp(row.app);
                    setPlatform(row.platform);
                    setMinVersion(row.minVersion);
                    setRecommendedVersion(row.recommendedVersion);
                    setMessage(row.message ?? '');
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
          title={t('admin.versions.new')}
          onClose={() => setEditOpen(false)}
          onSubmit={() => save.mutate()}
          actions={
            <>
              <ActionButton variant="outline" onClick={() => setEditOpen(false)}>
                Cancel
              </ActionButton>
              <ActionButton type="submit" disabled={save.isPending}>
                Save policy
              </ActionButton>
            </>
          }
        >
          <FormError message={actionError} />
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
            <SelectField
              label="App"
              value={app}
              onChange={(v) => setApp(v as AppName)}
              options={[
                { value: 'resident-mobile', label: 'Resident Mobile' },
                { value: 'security-mobile', label: 'Security Mobile' },
                { value: 'management-mobile', label: 'Management Mobile' },
                { value: 'management-web', label: 'Management Web' },
                { value: 'public-web', label: 'Public Web' },
                { value: 'super-admin', label: 'Super Admin' },
              ]}
            />
            <SelectField
              label="Platform"
              value={platform}
              onChange={(v) => setPlatform(v as PlatformName)}
              options={[
                { value: 'android', label: 'Android' },
                { value: 'ios', label: 'iOS' },
                { value: 'web', label: 'Web' },
              ]}
            />
          </div>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
            <InputField
              label="Minimum version"
              value={minVersion}
              onChange={setMinVersion}
              required
              placeholder="1.0.0"
            />
            <InputField
              label="Recommended version"
              value={recommendedVersion}
              onChange={setRecommendedVersion}
              required
              placeholder="1.2.0"
            />
          </div>
          <InputField
            label="Update prompt message (optional)"
            value={message}
            onChange={setMessage}
          />
        </Dialog>
      ) : null}
    </>
  );
}
