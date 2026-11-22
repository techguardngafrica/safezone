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
  TextAreaField,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../../lib/session';
import { errorText } from '../../lib/errors';
import { formatWat, humanizeStatus, statusTone } from '../../lib/format';

export function BreachesScreen() {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<'low' | 'medium' | 'high' | 'critical'>('high');
  const [affectedEstates, setAffectedEstates] = useState('0');
  const [affectedCount, setAffectedCount] = useState('0');
  const [actionError, setActionError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['platform', 'breaches'],
    queryFn: () => unwrap(api.GET('/v1/platform/breaches')),
  });

  const create = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/platform/breaches', {
          body: {
            title: title.trim(),
            description: description.trim(),
            severity,
            affectedEstates: Number(affectedEstates) || 0,
            affectedCount: Number(affectedCount) || 0,
          },
        }),
      ),
    onSuccess: () => {
      setCreateOpen(false);
      setTitle('');
      setDescription('');
      setActionError(null);
      void qc.invalidateQueries({ queryKey: ['platform', 'breaches'] });
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
        status?: 'investigating' | 'contained' | 'notified' | 'closed';
        markNdpcNotified?: boolean;
        markSubjectsNotified?: boolean;
      };
    }) =>
      unwrap(
        api.PATCH('/v1/platform/breaches/{id}', {
          params: { path: { id } },
          body,
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['platform', 'breaches'] });
      void qc.invalidateQueries({ queryKey: ['platform', 'overview'] });
    },
  });

  return (
    <>
      <PageHeader
        title={t('admin.breaches.title')}
        description={t('admin.breaches.description')}
        actions={
          <ActionButton
            variant="danger"
            icon="alert"
            onClick={() => {
              setActionError(null);
              setCreateOpen(true);
            }}
          >
            {t('admin.breaches.new')}
          </ActionButton>
        }
      />

      {list.isError ? (
        <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />
      ) : (
        <DataTable
          caption="Security and privacy breach log"
          loading={list.isPending}
          rows={list.data ?? []}
          rowKey={(row) => row.id}
          empty={{ icon: 'shield', title: t('admin.breaches.empty') }}
          columns={[
            {
              key: 'title',
              header: 'Incident',
              render: (row) => (
                <div>
                  <strong>{row.title}</strong>
                  <div className="sz-muted" style={{ fontSize: 12 }}>
                    Estates: {row.affectedEstates} · Subjects: {row.affectedCount}
                  </div>
                </div>
              ),
            },
            {
              key: 'severity',
              header: 'Severity',
              render: (row) => (
                <StatusPill tone={statusTone(row.severity)} label={humanizeStatus(row.severity)} />
              ),
            },
            {
              key: 'status',
              header: 'Status',
              render: (row) => (
                <StatusPill tone={statusTone(row.status)} label={humanizeStatus(row.status)} />
              ),
            },
            { key: 'detected', header: 'Detected', render: (row) => formatWat(row.detectedAt) },
            {
              key: 'ndpc',
              header: 'NDPC notified',
              render: (row) => (row.ndpcNotifiedAt ? formatWat(row.ndpcNotifiedAt) : 'Not yet'),
            },
            {
              key: 'actions',
              header: '',
              render: (row) => (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {!row.ndpcNotifiedAt ? (
                    <ActionButton
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        update.mutate({
                          id: row.id,
                          body: { markNdpcNotified: true, status: 'notified' },
                        })
                      }
                    >
                      Mark NDPC notified
                    </ActionButton>
                  ) : null}
                  {row.status !== 'closed' ? (
                    <ActionButton
                      variant="outline"
                      size="sm"
                      onClick={() => update.mutate({ id: row.id, body: { status: 'closed' } })}
                    >
                      Close
                    </ActionButton>
                  ) : null}
                </div>
              ),
            },
          ]}
        />
      )}

      {createOpen ? (
        <Dialog
          title={t('admin.breaches.new')}
          onClose={() => setCreateOpen(false)}
          onSubmit={() => create.mutate()}
          actions={
            <>
              <ActionButton variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </ActionButton>
              <ActionButton
                type="submit"
                variant="danger"
                disabled={
                  title.trim().length < 3 || description.trim().length < 5 || create.isPending
                }
              >
                Log breach
              </ActionButton>
            </>
          }
        >
          <FormError message={actionError} />
          <InputField label="Title" value={title} onChange={setTitle} required />
          <SelectField
            label="Severity"
            value={severity}
            onChange={(v) => setSeverity(v as 'low' | 'medium' | 'high' | 'critical')}
            options={[
              { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' },
              { value: 'critical', label: 'Critical' },
            ]}
          />
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
            <InputField
              label="Affected estates"
              type="number"
              value={affectedEstates}
              onChange={setAffectedEstates}
            />
            <InputField
              label="Affected data subjects"
              type="number"
              value={affectedCount}
              onChange={setAffectedCount}
            />
          </div>
          <TextAreaField
            label="Description"
            value={description}
            onChange={setDescription}
            required
            rows={4}
          />
        </Dialog>
      ) : null}
    </>
  );
}
