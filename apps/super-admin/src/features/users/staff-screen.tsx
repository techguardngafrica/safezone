'use client';

import { unwrap } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import { BUILT_IN_ROLES } from '@safezone/permissions';
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
  TextAreaField,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../../lib/session';
import { errorText } from '../../lib/errors';
import { humanizeStatus, statusTone } from '../../lib/format';

const PLATFORM_ROLES = BUILT_IN_ROLES.filter((r) => r.level === 'platform');

export function StaffScreen() {
  const qc = useQueryClient();
  const [assignOpen, setAssignOpen] = useState(false);
  const [userId, setUserId] = useState('');
  const [roleKey, setRoleKey] = useState('platform_support_agent');
  const [reason, setReason] = useState('');
  const [revokeTarget, setRevokeTarget] = useState<{ assignmentId: string; label: string } | null>(
    null,
  );
  const [revokeReason, setRevokeReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const staff = useQuery({
    queryKey: ['platform', 'staff'],
    queryFn: () => unwrap(api.GET('/v1/platform/staff')),
  });

  const assign = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/platform/staff/roles', {
          body: { userId: userId.trim(), roleKey, reason: reason.trim() },
        }),
      ),
    onSuccess: () => {
      setAssignOpen(false);
      setUserId('');
      setReason('');
      setActionError(null);
      void qc.invalidateQueries({ queryKey: ['platform', 'staff'] });
    },
    onError: (err) => setActionError(errorText(err)),
  });

  const revoke = useMutation({
    mutationFn: () =>
      unwrap(
        api.DELETE('/v1/platform/staff/roles/{assignmentId}', {
          params: { path: { assignmentId: revokeTarget!.assignmentId } },
          body: { reason: revokeReason.trim() },
        }),
      ),
    onSuccess: () => {
      setRevokeTarget(null);
      setRevokeReason('');
      setActionError(null);
      void qc.invalidateQueries({ queryKey: ['platform', 'staff'] });
    },
    onError: (err) => setActionError(errorText(err)),
  });

  return (
    <>
      <PageHeader
        title={t('admin.staff.title')}
        description={t('admin.staff.description')}
        actions={
          <ActionButton
            icon="userPlus"
            onClick={() => {
              setActionError(null);
              setAssignOpen(true);
            }}
          >
            {t('admin.staff.assign')}
          </ActionButton>
        }
      />

      {staff.isError ? (
        <ErrorState message={errorText(staff.error)} onRetry={() => void staff.refetch()} />
      ) : (
        <DataTable
          caption="Platform staff"
          loading={staff.isPending}
          rows={staff.data ?? []}
          rowKey={(row) => row.userId}
          empty={{ icon: 'key', title: t('admin.staff.empty') }}
          columns={[
            {
              key: 'user',
              header: 'Staff member',
              render: (row) => (
                <div>
                  <strong>{row.fullName ?? 'Unnamed staff'}</strong>
                  <div className="sz-muted" style={{ fontSize: 12 }}>
                    {row.phone}
                    {row.email ? ` / ${row.email}` : ''}
                  </div>
                </div>
              ),
            },
            {
              key: 'mfa',
              header: 'MFA',
              render: (row) => (
                <StatusPill
                  tone={row.mfaEnabled ? 'success' : 'warning'}
                  label={row.mfaEnabled ? 'Enabled' : 'Required'}
                />
              ),
            },
            {
              key: 'status',
              header: 'Account',
              render: (row) => (
                <StatusPill tone={statusTone(row.status)} label={humanizeStatus(row.status)} />
              ),
            },
            {
              key: 'roles',
              header: 'Platform roles',
              render: (row) => (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {row.roles.map((r) => (
                    <span
                      key={r.assignmentId}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    >
                      <StatusPill tone="info" label={r.roleName} />
                      <ActionButton
                        variant="text"
                        size="sm"
                        onClick={() => {
                          setActionError(null);
                          setRevokeReason('');
                          setRevokeTarget({
                            assignmentId: r.assignmentId,
                            label: `${r.roleName} from ${row.fullName ?? row.phone}`,
                          });
                        }}
                      >
                        Revoke
                      </ActionButton>
                    </span>
                  ))}
                </div>
              ),
            },
          ]}
        />
      )}

      {assignOpen ? (
        <Dialog
          title={t('admin.staff.assign')}
          onClose={() => setAssignOpen(false)}
          onSubmit={() => assign.mutate()}
          actions={
            <>
              <ActionButton variant="outline" onClick={() => setAssignOpen(false)}>
                Cancel
              </ActionButton>
              <ActionButton
                type="submit"
                disabled={!userId.trim() || reason.trim().length < 5 || assign.isPending}
              >
                Grant role
              </ActionButton>
            </>
          }
        >
          <FormError message={actionError} />
          <InputField
            label="User ID (UUID)"
            value={userId}
            onChange={setUserId}
            required
            placeholder="Find the user UUID from the User lookup page"
          />
          <SelectField
            label="Platform role"
            value={roleKey}
            onChange={setRoleKey}
            options={PLATFORM_ROLES.map((r) => ({ value: r.key, label: r.name }))}
          />
          <TextAreaField
            label="Audit reason"
            value={reason}
            onChange={setReason}
            required
            rows={3}
          />
        </Dialog>
      ) : null}

      {revokeTarget ? (
        <Dialog
          title={t('admin.staff.revoke')}
          onClose={() => setRevokeTarget(null)}
          onSubmit={() => revoke.mutate()}
          actions={
            <>
              <ActionButton variant="outline" onClick={() => setRevokeTarget(null)}>
                Cancel
              </ActionButton>
              <ActionButton
                type="submit"
                variant="danger"
                disabled={revokeReason.trim().length < 5 || revoke.isPending}
              >
                Revoke role
              </ActionButton>
            </>
          }
        >
          <p style={{ marginTop: 0 }}>Revoking: {revokeTarget.label}</p>
          <FormError message={actionError} />
          <TextAreaField
            label="Audit reason"
            value={revokeReason}
            onChange={setRevokeReason}
            required
            rows={3}
          />
        </Dialog>
      ) : null}
    </>
  );
}
