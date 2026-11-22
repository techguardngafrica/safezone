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

type DsrStatus = '' | 'received' | 'identity_verified' | 'in_progress' | 'completed' | 'rejected';

export function DsrScreen() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<DsrStatus>('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [createOpen, setCreateOpen] = useState(false);
  const [subjectName, setSubjectName] = useState('');
  const [subjectContact, setSubjectContact] = useState('');
  const [type, setType] = useState<'access' | 'correction' | 'deletion' | 'export' | 'objection'>(
    'access',
  );
  const [notes, setNotes] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['platform', 'dsr', status, cursor],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/platform/dsr', {
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

  const create = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/platform/dsr', {
          body: {
            subjectName: subjectName.trim(),
            subjectContact: subjectContact.trim(),
            type,
            ...(notes.trim() ? { notes: notes.trim() } : {}),
          },
        }),
      ),
    onSuccess: () => {
      setCreateOpen(false);
      setSubjectName('');
      setSubjectContact('');
      setNotes('');
      setActionError(null);
      void qc.invalidateQueries({ queryKey: ['platform', 'dsr'] });
      void qc.invalidateQueries({ queryKey: ['platform', 'overview'] });
    },
    onError: (err) => setActionError(errorText(err)),
  });

  const update = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: {
        status?: 'received' | 'identity_verified' | 'in_progress' | 'completed' | 'rejected';
        markIdentityChecked?: boolean;
      };
    }) =>
      unwrap(
        api.PATCH('/v1/platform/dsr/{id}', {
          params: { path: { id } },
          body,
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['platform', 'dsr'] });
      void qc.invalidateQueries({ queryKey: ['platform', 'overview'] });
    },
  });

  return (
    <>
      <PageHeader
        title={t('admin.dsr.title')}
        description={t('admin.dsr.description')}
        actions={
          <ActionButton
            icon="fileCheck"
            onClick={() => {
              setActionError(null);
              setCreateOpen(true);
            }}
          >
            {t('admin.dsr.new')}
          </ActionButton>
        }
      />

      <Toolbar>
        <SelectField
          label="Status"
          value={status}
          onChange={(v) => {
            setStatus(v as DsrStatus);
            setCursor(undefined);
          }}
          options={[
            { value: '', label: 'All statuses' },
            { value: 'received', label: 'Received' },
            { value: 'identity_verified', label: 'Identity verified' },
            { value: 'in_progress', label: 'In progress' },
            { value: 'completed', label: 'Completed' },
            { value: 'rejected', label: 'Rejected' },
          ]}
        />
      </Toolbar>

      {list.isError ? (
        <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />
      ) : (
        <DataTable
          caption="Data subject requests"
          loading={list.isPending}
          rows={list.data?.items ?? []}
          rowKey={(row) => row.id}
          empty={{ icon: 'fileCheck', title: t('admin.dsr.empty') }}
          columns={[
            {
              key: 'subject',
              header: 'Data subject',
              render: (row) => (
                <div>
                  <strong>{row.subjectName}</strong>
                  <div className="sz-muted" style={{ fontSize: 12 }}>
                    {row.subjectContact}
                  </div>
                </div>
              ),
            },
            { key: 'type', header: 'Type', render: (row) => humanizeStatus(row.type) },
            {
              key: 'status',
              header: 'Status',
              render: (row) => (
                <StatusPill tone={statusTone(row.status)} label={humanizeStatus(row.status)} />
              ),
            },
            {
              key: 'due',
              header: '30-day deadline',
              render: (row) => formatWat(row.dueAt),
            },
            {
              key: 'actions',
              header: '',
              render: (row) => (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {!row.identityCheckedAt &&
                  row.status !== 'completed' &&
                  row.status !== 'rejected' ? (
                    <ActionButton
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        update.mutate({ id: row.id, body: { markIdentityChecked: true } })
                      }
                    >
                      Verify ID
                    </ActionButton>
                  ) : null}
                  {row.status !== 'completed' && row.status !== 'rejected' ? (
                    <ActionButton
                      size="sm"
                      onClick={() => update.mutate({ id: row.id, body: { status: 'completed' } })}
                    >
                      Complete
                    </ActionButton>
                  ) : null}
                </div>
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

      {createOpen ? (
        <Dialog
          title={t('admin.dsr.new')}
          onClose={() => setCreateOpen(false)}
          onSubmit={() => create.mutate()}
          actions={
            <>
              <ActionButton variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </ActionButton>
              <ActionButton
                type="submit"
                disabled={!subjectName.trim() || !subjectContact.trim() || create.isPending}
              >
                Log request
              </ActionButton>
            </>
          }
        >
          <FormError message={actionError} />
          <InputField label="Subject name" value={subjectName} onChange={setSubjectName} required />
          <InputField
            label="Subject contact (phone or email)"
            value={subjectContact}
            onChange={setSubjectContact}
            required
          />
          <SelectField
            label="Request type"
            value={type}
            onChange={(v) =>
              setType(v as 'access' | 'correction' | 'deletion' | 'export' | 'objection')
            }
            options={[
              { value: 'access', label: 'Access' },
              { value: 'export', label: 'Data portability / export' },
              { value: 'correction', label: 'Correction' },
              { value: 'deletion', label: 'Deletion / erasure' },
              { value: 'objection', label: 'Objection' },
            ]}
          />
          <TextAreaField label="Notes (optional)" value={notes} onChange={setNotes} rows={3} />
        </Dialog>
      ) : null}
    </>
  );
}
