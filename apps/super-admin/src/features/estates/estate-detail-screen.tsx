'use client';

import { unwrap } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import { type FeatureKey, featureKeySchema } from '@safezone/schemas';
import {
  ActionButton,
  Banner,
  DataTable,
  DetailList,
  Dialog,
  ErrorState,
  FormError,
  InputField,
  PageHeader,
  Panel,
  SelectField,
  Skeleton,
  StatusPill,
  TextAreaField,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../lib/session';
import { errorText } from '../../lib/errors';
import { formatWat, humanizeStatus, statusTone } from '../../lib/format';
import { usePlatform } from '../../lib/platform';

export function EstateDetailScreen({ estateId }: { estateId: string }) {
  const qc = useQueryClient();
  const { can } = usePlatform();

  const [lifecycleAction, setLifecycleAction] = useState<
    'suspend' | 'reactivate' | 'deactivate' | null
  >(null);
  const [lifecycleReason, setLifecycleReason] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'estate_administrator' | 'estate_manager'>(
    'estate_administrator',
  );
  const [entitlementEdit, setEntitlementEdit] = useState<{
    module: FeatureKey;
    enabled: boolean;
  } | null>(null);
  const [entitlementReason, setEntitlementReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const estate = useQuery({
    queryKey: ['platform', 'estate', estateId],
    queryFn: () =>
      unwrap(api.GET('/v1/platform/estates/{id}', { params: { path: { id: estateId } } })),
  });

  const invitations = useQuery({
    queryKey: ['platform', 'estate', estateId, 'invitations'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/platform/estates/{id}/invitations', { params: { path: { id: estateId } } }),
      ),
  });

  const entitlements = useQuery({
    queryKey: ['platform', 'estate', estateId, 'entitlements'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/platform/estates/{id}/entitlements', { params: { path: { id: estateId } } }),
      ),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['platform', 'estate', estateId] });
    void qc.invalidateQueries({ queryKey: ['platform', 'estates'] });
    void qc.invalidateQueries({ queryKey: ['platform', 'overview'] });
  };

  const changeLifecycle = useMutation({
    mutationFn: async () => {
      if (lifecycleAction === 'suspend') {
        return unwrap(
          api.POST('/v1/platform/estates/{id}/suspend', {
            params: { path: { id: estateId } },
            body: { reason: lifecycleReason },
          }),
        );
      }
      if (lifecycleAction === 'reactivate') {
        return unwrap(
          api.POST('/v1/platform/estates/{id}/reactivate', {
            params: { path: { id: estateId } },
            body: { reason: lifecycleReason },
          }),
        );
      }
      return unwrap(
        api.POST('/v1/platform/estates/{id}/deactivate', {
          params: { path: { id: estateId } },
          body: { reason: lifecycleReason },
        }),
      );
    },
    onSuccess: () => {
      setLifecycleAction(null);
      setLifecycleReason('');
      setActionError(null);
      invalidate();
    },
    onError: (err) => setActionError(errorText(err)),
  });

  const sendInvite = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/platform/estates/{id}/invitations', {
          params: { path: { id: estateId } },
          body: {
            phone: invitePhone.trim(),
            ...(inviteEmail.trim() ? { email: inviteEmail.trim() } : {}),
            roleKey: inviteRole,
          },
        }),
      ),
    onSuccess: () => {
      setInviteOpen(false);
      setInvitePhone('');
      setInviteEmail('');
      setActionError(null);
      void qc.invalidateQueries({ queryKey: ['platform', 'estate', estateId, 'invitations'] });
    },
    onError: (err) => setActionError(errorText(err)),
  });

  const revokeInvite = useMutation({
    mutationFn: (invitationId: string) =>
      unwrap(
        api.POST('/v1/platform/estates/{id}/invitations/{invitationId}/revoke', {
          params: { path: { id: estateId, invitationId } },
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['platform', 'estate', estateId, 'invitations'] });
    },
    onError: (err) => setActionError(errorText(err)),
  });

  const saveEntitlement = useMutation({
    mutationFn: (edit: { module: FeatureKey; enabled: boolean }) =>
      unwrap(
        api.PUT('/v1/platform/estates/{id}/entitlements/{module}', {
          params: { path: { id: estateId, module: edit.module } },
          body: { enabled: edit.enabled, reason: entitlementReason },
        }),
      ),
    onSuccess: () => {
      setEntitlementEdit(null);
      setEntitlementReason('');
      setActionError(null);
      void qc.invalidateQueries({ queryKey: ['platform', 'estate', estateId, 'entitlements'] });
    },
    onError: (err) => setActionError(errorText(err)),
  });

  if (estate.isPending) {
    return (
      <>
        <PageHeader title="Estate" />
        <Skeleton height={160} />
      </>
    );
  }
  if (estate.isError) {
    return (
      <>
        <PageHeader title="Estate" />
        <ErrorState message={errorText(estate.error)} onRetry={() => void estate.refetch()} />
      </>
    );
  }

  const e = estate.data;
  const canApprove = can('platform.estate.approve');

  return (
    <>
      <PageHeader
        title={e.name}
        breadcrumbs={<Link href="/estates">{t('admin.estates.title')}</Link>}
        actions={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {e.status !== 'deactivated' ? (
              <ActionButton
                variant="outline"
                icon="userPlus"
                onClick={() => {
                  setActionError(null);
                  setInviteOpen(true);
                }}
              >
                {t('admin.estates.inviteAdmin')}
              </ActionButton>
            ) : null}
            {canApprove && (e.status === 'active' || e.status === 'approved') ? (
              <ActionButton
                variant="outline"
                onClick={() => {
                  setActionError(null);
                  setLifecycleReason('');
                  setLifecycleAction('suspend');
                }}
              >
                {t('admin.estates.suspend')}
              </ActionButton>
            ) : null}
            {canApprove && e.status === 'suspended' ? (
              <ActionButton
                onClick={() => {
                  setActionError(null);
                  setLifecycleReason('');
                  setLifecycleAction('reactivate');
                }}
              >
                {t('admin.estates.reactivate')}
              </ActionButton>
            ) : null}
            {canApprove && e.status !== 'deactivated' ? (
              <ActionButton
                variant="danger"
                onClick={() => {
                  setActionError(null);
                  setLifecycleReason('');
                  setLifecycleAction('deactivate');
                }}
              >
                {t('admin.estates.deactivate')}
              </ActionButton>
            ) : null}
          </div>
        }
      />

      {e.status === 'suspended' ? (
        <div style={{ marginBottom: 16 }}>
          <Banner tone="warning">
            <strong>Estate suspended:</strong>{' '}
            {e.suspensionReason ?? t('admin.estates.suspendWarning')}
          </Banner>
        </div>
      ) : null}

      <Panel title="Estate profile">
        <DetailList
          items={[
            {
              label: 'Status',
              value: <StatusPill tone={statusTone(e.status)} label={humanizeStatus(e.status)} />,
            },
            { label: 'Join code', value: <code>{e.code}</code> },
            { label: 'Address', value: e.address },
            { label: 'State / LGA', value: `${e.state} / ${e.lga}` },
            { label: 'Created', value: formatWat(e.createdAt) },
            { label: 'Approved', value: formatWat(e.approvedAt) },
            { label: 'Activated', value: formatWat(e.activatedAt) },
          ]}
        />
      </Panel>

      <div style={{ marginTop: 16 }}>
        <Panel title={t('admin.estates.invitations')}>
          <DataTable
            caption="Administrator invitations"
            loading={invitations.isPending}
            rows={invitations.data ?? []}
            rowKey={(row) => row.id}
            empty={{ title: 'No administrator invitations yet.' }}
            columns={[
              { key: 'phone', header: 'Phone', render: (row) => row.phone },
              { key: 'email', header: 'Email', render: (row) => row.email ?? '-' },
              { key: 'role', header: 'Role', render: (row) => humanizeStatus(row.roleKey) },
              {
                key: 'status',
                header: 'Status',
                render: (row) => (
                  <StatusPill tone={statusTone(row.status)} label={humanizeStatus(row.status)} />
                ),
              },
              { key: 'expires', header: 'Expires', render: (row) => formatWat(row.expiresAt) },
              {
                key: 'action',
                header: '',
                render: (row) =>
                  row.status === 'pending' ? (
                    <ActionButton
                      variant="danger"
                      size="sm"
                      onClick={() => revokeInvite.mutate(row.id)}
                    >
                      Revoke
                    </ActionButton>
                  ) : null,
              },
            ]}
          />
        </Panel>
      </div>

      <div style={{ marginTop: 16 }}>
        <Panel title={t('admin.estates.entitlements')}>
          <DataTable
            caption="Estate module entitlements"
            loading={entitlements.isPending}
            rows={entitlements.data ?? []}
            rowKey={(row) => row.module}
            empty={{ title: 'No module entitlements found.' }}
            columns={[
              { key: 'module', header: 'Module', render: (row) => <strong>{row.module}</strong> },
              {
                key: 'enabled',
                header: 'State',
                render: (row) => (
                  <StatusPill
                    tone={row.enabled ? 'success' : 'neutral'}
                    label={row.enabled ? 'Enabled' : 'Disabled'}
                  />
                ),
              },
              { key: 'source', header: 'Source', render: (row) => humanizeStatus(row.source) },
              {
                key: 'action',
                header: '',
                render: (row) => {
                  // Only catalogued feature keys can be overridden (the API rejects anything else).
                  const parsed = featureKeySchema.safeParse(row.module);
                  if (!canApprove || !parsed.success) return null;
                  const featureKey = parsed.data;
                  return (
                    <ActionButton
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setActionError(null);
                        setEntitlementReason('');
                        setEntitlementEdit({ module: featureKey, enabled: !row.enabled });
                      }}
                    >
                      {row.enabled ? 'Disable' : 'Enable'}
                    </ActionButton>
                  );
                },
              },
            ]}
          />
        </Panel>
      </div>

      {lifecycleAction ? (
        <Dialog
          title={
            lifecycleAction === 'suspend'
              ? t('admin.estates.suspend')
              : lifecycleAction === 'reactivate'
                ? t('admin.estates.reactivate')
                : t('admin.estates.deactivate')
          }
          onClose={() => setLifecycleAction(null)}
          onSubmit={() => changeLifecycle.mutate()}
          actions={
            <>
              <ActionButton variant="outline" onClick={() => setLifecycleAction(null)}>
                Cancel
              </ActionButton>
              <ActionButton
                type="submit"
                variant={lifecycleAction === 'deactivate' ? 'danger' : 'primary'}
                disabled={lifecycleReason.trim().length < 5 || changeLifecycle.isPending}
              >
                Confirm
              </ActionButton>
            </>
          }
        >
          {lifecycleAction === 'suspend' ? (
            <Banner tone="warning">{t('admin.estates.suspendWarning')}</Banner>
          ) : null}
          {lifecycleAction === 'deactivate' ? (
            <Banner tone="danger">{t('admin.estates.deactivateWarning')}</Banner>
          ) : null}
          <FormError message={actionError} />
          <TextAreaField
            label="Audit reason"
            value={lifecycleReason}
            onChange={setLifecycleReason}
            required
            rows={3}
          />
        </Dialog>
      ) : null}

      {inviteOpen ? (
        <Dialog
          title={t('admin.estates.inviteAdmin')}
          onClose={() => setInviteOpen(false)}
          onSubmit={() => sendInvite.mutate()}
          actions={
            <>
              <ActionButton variant="outline" onClick={() => setInviteOpen(false)}>
                Cancel
              </ActionButton>
              <ActionButton type="submit" disabled={!invitePhone.trim() || sendInvite.isPending}>
                Send invitation
              </ActionButton>
            </>
          }
        >
          <FormError message={actionError} />
          <InputField
            label="Phone (E.164)"
            value={invitePhone}
            onChange={setInvitePhone}
            required
            placeholder="+2348012345678"
          />
          <InputField
            label="Email (optional)"
            type="email"
            value={inviteEmail}
            onChange={setInviteEmail}
          />
          <SelectField
            label="Role"
            value={inviteRole}
            onChange={(v) => setInviteRole(v as 'estate_administrator' | 'estate_manager')}
            options={[
              { value: 'estate_administrator', label: 'Estate Administrator' },
              { value: 'estate_manager', label: 'Estate Manager' },
            ]}
          />
        </Dialog>
      ) : null}

      {entitlementEdit ? (
        <Dialog
          title={`${entitlementEdit.enabled ? 'Enable' : 'Disable'} ${entitlementEdit.module}`}
          onClose={() => setEntitlementEdit(null)}
          onSubmit={() => saveEntitlement.mutate(entitlementEdit)}
          actions={
            <>
              <ActionButton variant="outline" onClick={() => setEntitlementEdit(null)}>
                Cancel
              </ActionButton>
              <ActionButton
                type="submit"
                disabled={entitlementReason.trim().length < 5 || saveEntitlement.isPending}
              >
                Save override
              </ActionButton>
            </>
          }
        >
          <FormError message={actionError} />
          <TextAreaField
            label={t('admin.estates.entitlementReason')}
            value={entitlementReason}
            onChange={setEntitlementReason}
            required
            rows={3}
          />
        </Dialog>
      ) : null}
    </>
  );
}
