'use client';

import { unwrap, unwrapPage } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  DataTable,
  DetailList,
  Dialog,
  Drawer,
  ErrorState,
  FormError,
  InputField,
  PageHeader,
  SelectField,
  Skeleton,
  StatusPill,
  TextAreaField,
  Toolbar,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../../lib/session';
import { errorText } from '../../lib/errors';
import { formatWat, humanizeStatus, statusTone } from '../../lib/format';

type UserActionKind = 'lock' | 'unlock' | 'revoke_sessions' | 'reset_mfa';

export function UsersScreen() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | 'active' | 'locked' | 'deactivated'>('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionModal, setActionModal] = useState<UserActionKind | null>(null);
  const [reason, setReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['platform', 'users', q, status, cursor],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/platform/users', {
          params: {
            query: {
              ...(q.trim() ? { q: q.trim() } : {}),
              ...(status ? { status } : {}),
              limit: 25,
              ...(cursor ? { cursor } : {}),
            },
          },
        }),
      ),
  });

  const detail = useQuery({
    queryKey: ['platform', 'user', selectedId],
    queryFn: () =>
      unwrap(api.GET('/v1/platform/users/{id}', { params: { path: { id: selectedId! } } })),
    enabled: Boolean(selectedId),
  });

  const runAction = useMutation({
    mutationFn: async () => {
      if (!selectedId || !actionModal) return;
      if (actionModal === 'lock') {
        return unwrap(
          api.POST('/v1/platform/users/{id}/lock', {
            params: { path: { id: selectedId } },
            body: { reason },
          }),
        );
      }
      if (actionModal === 'unlock') {
        return unwrap(
          api.POST('/v1/platform/users/{id}/unlock', {
            params: { path: { id: selectedId } },
            body: { reason },
          }),
        );
      }
      if (actionModal === 'revoke_sessions') {
        return unwrap(
          api.POST('/v1/platform/users/{id}/revoke-sessions', {
            params: { path: { id: selectedId } },
            body: { reason },
          }),
        );
      }
      return unwrap(
        api.POST('/v1/platform/users/{id}/reset-mfa', {
          params: { path: { id: selectedId } },
          body: { reason },
        }),
      );
    },
    onSuccess: () => {
      setActionModal(null);
      setReason('');
      setActionError(null);
      void qc.invalidateQueries({ queryKey: ['platform', 'users'] });
      void qc.invalidateQueries({ queryKey: ['platform', 'user', selectedId] });
      void qc.invalidateQueries({ queryKey: ['platform', 'overview'] });
    },
    onError: (err) => setActionError(errorText(err)),
  });

  return (
    <>
      <PageHeader title={t('admin.users.title')} description={t('admin.users.description')} />
      <Toolbar>
        <InputField
          label="Search"
          value={q}
          onChange={(v) => {
            setQ(v);
            setCursor(undefined);
          }}
          placeholder="Phone, email, name or UUID"
        />
        <SelectField
          label="Status"
          value={status}
          onChange={(v) => {
            setStatus(v as '' | 'active' | 'locked' | 'deactivated');
            setCursor(undefined);
          }}
          options={[
            { value: '', label: 'All statuses' },
            { value: 'active', label: 'Active' },
            { value: 'locked', label: 'Locked' },
          ]}
        />
      </Toolbar>

      {list.isError ? (
        <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />
      ) : (
        <DataTable
          caption="Platform users"
          loading={list.isPending}
          rows={list.data?.items ?? []}
          rowKey={(row) => row.id}
          empty={{ icon: 'users', title: t('admin.users.empty') }}
          columns={[
            {
              key: 'name',
              header: 'User',
              render: (row) => (
                <div>
                  <strong>{row.fullName ?? 'Unnamed user'}</strong>
                  <div className="sz-muted" style={{ fontSize: 12 }}>
                    {row.phone}
                    {row.email ? ` / ${row.email}` : ''}
                  </div>
                </div>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              render: (row) => (
                <StatusPill tone={statusTone(row.status)} label={humanizeStatus(row.status)} />
              ),
            },
            {
              key: 'mfa',
              header: 'MFA',
              render: (row) => (
                <StatusPill
                  tone={row.mfaEnabled ? 'success' : 'neutral'}
                  label={row.mfaEnabled ? 'Enabled' : 'Off'}
                />
              ),
            },
            { key: 'estates', header: 'Estates', render: (row) => row.estateCount },
            {
              key: 'created',
              header: 'Joined',
              render: (row) => formatWat(row.createdAt),
            },
            {
              key: 'action',
              header: '',
              render: (row) => (
                <ActionButton variant="outline" size="sm" onClick={() => setSelectedId(row.id)}>
                  Inspect
                </ActionButton>
              ),
            },
          ]}
        />
      )}

      {list.data?.nextCursor ? (
        <div style={{ marginTop: 16 }}>
          <ActionButton
            variant="outline"
            onClick={() => setCursor(list.data?.nextCursor ?? undefined)}
          >
            Load next page
          </ActionButton>
        </div>
      ) : null}

      {selectedId ? (
        <Drawer title="User account" onClose={() => setSelectedId(null)}>
          {detail.isPending ? (
            <Skeleton height={160} />
          ) : detail.isError ? (
            <ErrorState message={errorText(detail.error)} onRetry={() => void detail.refetch()} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <DetailList
                items={[
                  { label: 'User ID', value: <code>{detail.data.id}</code> },
                  { label: 'Full name', value: detail.data.fullName ?? '-' },
                  { label: 'Phone', value: detail.data.phone },
                  { label: 'Email', value: detail.data.email ?? '-' },
                  {
                    label: 'Status',
                    value: (
                      <StatusPill
                        tone={statusTone(detail.data.status)}
                        label={humanizeStatus(detail.data.status)}
                      />
                    ),
                  },
                  { label: 'MFA', value: detail.data.mfaEnabled ? 'Enabled' : 'Not enrolled' },
                  { label: 'Active sessions', value: detail.data.activeSessionCount },
                  {
                    label: 'Platform roles',
                    value:
                      detail.data.platformRoles.length > 0
                        ? detail.data.platformRoles.join(', ')
                        : 'None',
                  },
                ]}
              />

              <div>
                <h3 style={{ marginTop: 0, marginBottom: 8, fontSize: 15 }}>Estate memberships</h3>
                {detail.data.memberships.length === 0 ? (
                  <p className="sz-muted">No estate memberships.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {detail.data.memberships.map((m) => (
                      <div
                        key={m.estateId}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: 14,
                          padding: '6px 0',
                          borderBottom: '1px solid var(--sz-border-subtle)',
                        }}
                      >
                        <span>
                          <strong>{m.estateName}</strong> ({m.roles.join(', ') || 'member'})
                        </span>
                        <StatusPill tone={statusTone(m.status)} label={humanizeStatus(m.status)} />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {detail.data.status === 'locked' ? (
                  <ActionButton
                    onClick={() => {
                      setActionError(null);
                      setReason('');
                      setActionModal('unlock');
                    }}
                  >
                    {t('admin.users.unlock')}
                  </ActionButton>
                ) : (
                  <ActionButton
                    variant="danger"
                    onClick={() => {
                      setActionError(null);
                      setReason('');
                      setActionModal('lock');
                    }}
                  >
                    {t('admin.users.lock')}
                  </ActionButton>
                )}
                <ActionButton
                  variant="outline"
                  onClick={() => {
                    setActionError(null);
                    setReason('');
                    setActionModal('revoke_sessions');
                  }}
                >
                  {t('admin.users.revokeSessions')}
                </ActionButton>
                {detail.data.mfaEnabled ? (
                  <ActionButton
                    variant="outline"
                    onClick={() => {
                      setActionError(null);
                      setReason('');
                      setActionModal('reset_mfa');
                    }}
                  >
                    {t('admin.users.resetMfa')}
                  </ActionButton>
                ) : null}
              </div>
            </div>
          )}
        </Drawer>
      ) : null}

      {actionModal ? (
        <Dialog
          title={
            actionModal === 'lock'
              ? t('admin.users.lock')
              : actionModal === 'unlock'
                ? t('admin.users.unlock')
                : actionModal === 'revoke_sessions'
                  ? t('admin.users.revokeSessions')
                  : t('admin.users.resetMfa')
          }
          onClose={() => setActionModal(null)}
          onSubmit={() => runAction.mutate()}
          actions={
            <>
              <ActionButton variant="outline" onClick={() => setActionModal(null)}>
                Cancel
              </ActionButton>
              <ActionButton
                type="submit"
                variant={
                  actionModal === 'lock' || actionModal === 'reset_mfa' ? 'danger' : 'primary'
                }
                disabled={reason.trim().length < 5 || runAction.isPending}
              >
                Confirm
              </ActionButton>
            </>
          }
        >
          <FormError message={actionError} />
          <TextAreaField
            label="Audit reason"
            value={reason}
            onChange={setReason}
            required
            rows={3}
          />
        </Dialog>
      ) : null}
    </>
  );
}
