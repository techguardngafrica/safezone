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
import { useState } from 'react';
import { api } from '../../../lib/session';
import { errorText } from '../../lib/errors';
import { formatWat, humanizeStatus } from '../../lib/format';

export function RetentionScreen() {
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [dataType, setDataType] = useState('');
  const [retentionDays, setRetentionDays] = useState('365');
  const [basis, setBasis] = useState('');
  const [action, setAction] = useState<'delete' | 'anonymise' | 'archive'>('anonymise');
  const [actionError, setActionError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['platform', 'retention-rules'],
    queryFn: () => unwrap(api.GET('/v1/platform/retention-rules')),
  });

  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.PUT('/v1/platform/retention-rules', {
          body: {
            dataType: dataType.trim(),
            retentionDays: Number(retentionDays) || 365,
            basis: basis.trim(),
            action,
          },
        }),
      ),
    onSuccess: () => {
      setEditOpen(false);
      setDataType('');
      setBasis('');
      setActionError(null);
      void qc.invalidateQueries({ queryKey: ['platform', 'retention-rules'] });
    },
    onError: (err) => setActionError(errorText(err)),
  });

  return (
    <>
      <PageHeader
        title={t('admin.retention.title')}
        description={t('admin.retention.description')}
        actions={
          <ActionButton
            icon="clock"
            onClick={() => {
              setActionError(null);
              setDataType('');
              setRetentionDays('365');
              setBasis('');
              setAction('anonymise');
              setEditOpen(true);
            }}
          >
            {t('admin.retention.new')}
          </ActionButton>
        }
      />

      {list.isError ? (
        <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />
      ) : (
        <DataTable
          caption="Data retention rules"
          loading={list.isPending}
          rows={list.data ?? []}
          rowKey={(row) => row.dataType}
          empty={{ icon: 'clock', title: t('admin.retention.empty') }}
          columns={[
            {
              key: 'type',
              header: 'Data category',
              render: (row) => <strong>{row.dataType}</strong>,
            },
            { key: 'days', header: 'Retention', render: (row) => `${row.retentionDays} days` },
            { key: 'basis', header: 'Legal basis', render: (row) => row.basis },
            {
              key: 'action',
              header: 'At expiry',
              render: (row) => <StatusPill tone="info" label={humanizeStatus(row.action)} />,
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
                    setDataType(row.dataType);
                    setRetentionDays(String(row.retentionDays));
                    setBasis(row.basis);
                    setAction(row.action);
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
          title={t('admin.retention.new')}
          onClose={() => setEditOpen(false)}
          onSubmit={() => save.mutate()}
          actions={
            <>
              <ActionButton variant="outline" onClick={() => setEditOpen(false)}>
                Cancel
              </ActionButton>
              <ActionButton
                type="submit"
                disabled={!dataType.trim() || basis.trim().length < 3 || save.isPending}
              >
                Save rule
              </ActionButton>
            </>
          }
        >
          <FormError message={actionError} />
          <InputField
            label="Data category"
            value={dataType}
            onChange={setDataType}
            required
            placeholder="e.g. visitor_gate_logs"
          />
          <InputField
            label="Retention period (days)"
            type="number"
            value={retentionDays}
            onChange={setRetentionDays}
            required
          />
          <InputField
            label="Legal / operational basis"
            value={basis}
            onChange={setBasis}
            required
            placeholder="e.g. Estate security & NDPA legitimate interest"
          />
          <SelectField
            label="Action at expiry"
            value={action}
            onChange={(v) => setAction(v as 'delete' | 'anonymise' | 'archive')}
            options={[
              { value: 'anonymise', label: 'Anonymise' },
              { value: 'delete', label: 'Delete' },
              { value: 'archive', label: 'Archive' },
            ]}
          />
        </Dialog>
      ) : null}
    </>
  );
}
