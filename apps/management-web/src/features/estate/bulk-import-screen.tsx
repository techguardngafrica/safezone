'use client';

import { type ApiData, type ApiRow, unwrap } from '@safezone/api-client';
import { type MessageKey, formatDateTime, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  type Column,
  DataTable,
  PageHeader,
  Panel,
  SelectField,
  StatusPill,
  type Tone,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useEstate } from '../../../lib/estate';
import { errorText } from '../../../lib/errors';
import { api } from '../../../lib/session';

type ImportJob = ApiRow<'/v1/estates/{estateId}/imports', 'get'>;
type ImportKind = ImportJob['kind'];

const KINDS: ImportKind[] = [
  'units',
  'owners',
  'residents',
  'households',
  'vehicles',
  'opening_balances',
];

const STATUS_TONE: Record<ImportJob['status'], Tone> = {
  dry_run: 'warning',
  queued: 'info',
  running: 'info',
  completed: 'success',
  failed: 'danger',
};

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function BulkImportScreen() {
  const { estateId } = useEstate();
  const queryClient = useQueryClient();

  const [kind, setKind] = useState<ImportKind>('units');
  const [filename, setFilename] = useState('');
  const [csvText, setCsvText] = useState('');
  const [preview, setPreview] = useState<ApiData<
    '/v1/estates/{estateId}/imports/dry-run',
    'post'
  > | null>(null);

  const jobs = useQuery({
    queryKey: ['estate', estateId, 'imports'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/imports', { params: { path: { estateId } } })),
  });

  const downloadTemplate = useMutation({
    mutationFn: (selectedKind: ImportKind) =>
      unwrap(
        api.GET('/v1/estates/{estateId}/imports/templates/{kind}', {
          params: { path: { estateId, kind: selectedKind } },
        }),
      ),
    onSuccess: (tpl) => downloadCsv(tpl.filename, tpl.csv),
  });

  const dryRun = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/imports/dry-run', {
          params: { path: { estateId } },
          body: { kind, filename: filename || `${kind}.csv`, csv: csvText },
        }),
      ),
    onSuccess: (job) => {
      setPreview(job);
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'imports'] });
    },
  });

  const confirm = useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/imports/{id}/confirm', {
          params: { path: { estateId, id } },
        }),
      ),
    onSuccess: (job) => {
      setPreview(job);
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'imports'] });
    },
  });

  const columns: Column<ImportJob>[] = [
    { key: 'file', header: t('import.col.filename'), render: (row) => row.filename },
    {
      key: 'kind',
      header: t('import.col.kind'),
      render: (row) => t(`import.kind.${row.kind}` as MessageKey),
    },
    {
      key: 'rows',
      header: t('import.col.rows'),
      render: (row) => (
        <span className="sz-num">
          {row.validRows} / {row.errorRows}
        </span>
      ),
    },
    {
      key: 'result',
      header: t('import.col.result'),
      render: (row) => (
        <span className="sz-num">
          {row.createdCount} / {row.updatedCount}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('import.col.status'),
      render: (row) => (
        <StatusPill tone={STATUS_TONE[row.status]} label={row.status.replace('_', ' ')} />
      ),
    },
    {
      key: 'createdAt',
      header: t('import.col.createdAt'),
      render: (row) => <span className="sz-num">{formatDateTime(row.createdAt)}</span>,
    },
  ];

  return (
    <>
      <PageHeader title={t('import.title')} description={t('import.description')} />

      <Panel
        title={t('import.title')}
        actions={
          <ActionButton
            variant="outline"
            size="sm"
            icon="download"
            busy={downloadTemplate.isPending}
            onClick={() => downloadTemplate.mutate(kind)}
          >
            {t('import.downloadTemplate')}
          </ActionButton>
        }
      >
        <div className="sz-form">
          {dryRun.isError ? <Banner tone="danger">{errorText(dryRun.error)}</Banner> : null}
          {confirm.isError ? <Banner tone="danger">{errorText(confirm.error)}</Banner> : null}

          <div className="sz-form-2">
            <SelectField
              label={t('import.kind')}
              value={kind}
              onChange={(value) => {
                setKind(value);
                setPreview(null);
              }}
              options={KINDS.map((item) => ({
                value: item,
                label: t(`import.kind.${item}` as MessageKey),
              }))}
            />
            <div className="sz-field">
              <label htmlFor="bulk-import-file">{t('import.file')}</label>
              <input
                id="bulk-import-file"
                className="sz-input"
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  setFilename(file.name);
                  void file.text().then((text) => {
                    setCsvText(text);
                    setPreview(null);
                  });
                }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <ActionButton
              icon="upload"
              disabled={!csvText.trim()}
              busy={dryRun.isPending}
              onClick={() => dryRun.mutate()}
            >
              {t('import.runDryRun')}
            </ActionButton>

            {preview && preview.status === 'dry_run' && preview.validRows > 0 ? (
              <ActionButton
                variant="secondary"
                icon="check"
                busy={confirm.isPending}
                onClick={() => confirm.mutate(preview.id)}
              >
                {t('import.confirm', { count: preview.validRows })}
              </ActionButton>
            ) : null}
          </div>

          {preview ? (
            <div style={{ display: 'grid', gap: 12, marginTop: 8 }}>
              <Banner tone={preview.errorRows > 0 ? 'warning' : 'success'}>
                {preview.filename}: {preview.totalRows} total, {preview.validRows} valid,{' '}
                {preview.errorRows} errors
                {preview.status === 'completed'
                  ? ` (${preview.createdCount} created, ${preview.updatedCount} updated)`
                  : ''}
              </Banner>

              {preview.errors.length > 0 ? (
                <DataTable
                  caption={t('import.errors', { count: preview.errors.length })}
                  rows={preview.errors.slice(0, 100)}
                  rowKey={(row) => `${row.row}-${row.field ?? 'row'}-${row.message}`}
                  columns={[
                    {
                      key: 'row',
                      header: 'Row',
                      render: (r) => <span className="sz-num">{r.row}</span>,
                    },
                    { key: 'field', header: 'Field', render: (r) => r.field ?? '-' },
                    { key: 'message', header: 'Error', render: (r) => r.message },
                  ]}
                  empty={{ icon: 'check', title: 'No errors', body: '' }}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      </Panel>

      <div style={{ marginTop: 24 }}>
        <DataTable
          caption={t('import.history')}
          columns={columns}
          rows={jobs.data ?? []}
          rowKey={(row) => row.id}
          loading={jobs.isPending}
          error={jobs.isError ? errorText(jobs.error) : null}
          onRetry={() => void jobs.refetch()}
          empty={{
            icon: 'upload',
            title: t('import.empty.title'),
            body: t('import.empty.body'),
          }}
        />
      </div>
    </>
  );
}
