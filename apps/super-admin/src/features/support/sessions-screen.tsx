'use client';

import { unwrap, unwrapPage } from '@safezone/api-client';
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
  TextAreaField,
  Toolbar,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../../lib/session';
import { errorText } from '../../lib/errors';
import { formatWat, humanizeStatus, statusTone } from '../../lib/format';

type SessionStatus = '' | 'pending' | 'approved' | 'denied' | 'revoked' | 'expired';

export function SupportSessionsScreen() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<SessionStatus>('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [requestOpen, setRequestOpen] = useState(false);
  const [estateId, setEstateId] = useState('');
  const [reason, setReason] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('120');
  const [actionError, setActionError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['platform', 'support-sessions', status, cursor],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/platform/support-sessions', {
          params: {
            query: {
              ...(status ? { status } : {}),
              limit: 25,
              ...(cursor ? { cursor } : {}),
            },
          },
        }),
      ),
  });

  const requestAccess = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/platform/support-sessions', {
          body: {
            estateId: estateId.trim(),
            reason: reason.trim(),
            durationMinutes: Number(durationMinutes) || 120,
          },
        }),
      ),
    onSuccess: () => {
      setRequestOpen(false);
      setEstateId('');
      setReason('');
      setActionError(null);
      void qc.invalidateQueries({ queryKey: ['platform', 'support-sessions'] });
      void qc.invalidateQueries({ queryKey: ['platform', 'overview'] });
    },
    onError: (err) => setActionError(errorText(err)),
  });

  return (
    <>
      <PageHeader
        title={t('admin.sessions.title')}
        description={t('admin.sessions.description')}
        actions={
          <ActionButton
            icon="shield"
            onClick={() => {
              setActionError(null);
              setRequestOpen(true);
            }}
          >
            {t('admin.sessions.request')}
          </ActionButton>
        }
      />

      <Toolbar>
        <SelectField
          label="Status"
          value={status}
          onChange={(v) => {
            setStatus(v as SessionStatus);
            setCursor(undefined);
          }}
          options={[
            { value: '', label: 'All statuses' },
            { value: 'pending', label: 'Pending estate consent' },
            { value: 'approved', label: 'Approved' },
            { value: 'denied', label: 'Denied' },
            { value: 'revoked', label: 'Revoked' },
            { value: 'expired', label: 'Expired' },
          ]}
        />
      </Toolbar>

      {list.isError ? (
        <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />
      ) : (
        <DataTable
          caption="Support access sessions"
          loading={list.isPending}
          rows={list.data?.items ?? []}
          rowKey={(row) => row.id}
          empty={{ icon: 'shield', title: t('admin.sessions.empty') }}
          columns={[
            {
              key: 'estate',
              header: 'Estate',
              render: (row) => (
                <div>
                  <strong>{row.estateName ?? row.estateId.slice(0, 8)}</strong>
                  <div className="sz-muted" style={{ fontSize: 12 }}>
                    {row.reason}
                  </div>
                </div>
              ),
            },
            {
              key: 'agent',
              header: 'Agent',
              render: (row) => row.platformUserName ?? row.platformUserId.slice(0, 8),
            },
            {
              key: 'status',
              header: 'Status',
              render: (row) => (
                <StatusPill tone={statusTone(row.status)} label={humanizeStatus(row.status)} />
              ),
            },
            {
              key: 'duration',
              header: 'Window',
              render: (row) => `${row.durationMinutes} min`,
            },
            {
              key: 'expires',
              header: 'Expires',
              render: (row) => formatWat(row.expiresAt),
            },
            {
              key: 'requested',
              header: 'Requested',
              render: (row) => formatWat(row.requestedAt),
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

      {requestOpen ? (
        <Dialog
          title={t('admin.sessions.request')}
          onClose={() => setRequestOpen(false)}
          onSubmit={() => requestAccess.mutate()}
          actions={
            <>
              <ActionButton variant="outline" onClick={() => setRequestOpen(false)}>
                Cancel
              </ActionButton>
              <ActionButton
                type="submit"
                disabled={!estateId.trim() || reason.trim().length < 5 || requestAccess.isPending}
              >
                Send request
              </ActionButton>
            </>
          }
        >
          <FormError message={actionError} />
          <InputField label="Estate ID (UUID)" value={estateId} onChange={setEstateId} required />
          <SelectField
            label="Duration"
            value={durationMinutes}
            onChange={setDurationMinutes}
            options={[
              { value: '30', label: '30 minutes' },
              { value: '60', label: '1 hour' },
              { value: '120', label: '2 hours (default)' },
              { value: '240', label: '4 hours' },
            ]}
          />
          <TextAreaField
            label="Reason (shown to the estate administrator)"
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
