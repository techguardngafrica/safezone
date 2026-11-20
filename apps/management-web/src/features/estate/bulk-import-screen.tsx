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

  // A confirmed job runs in the worker: poll it until it completes or fails.
  const previewId = preview?.id ?? null;
  const pending = preview?.status === 'queued' || preview?.status === 'running';
  const progress = useQuery({
    queryKey: ['estate', estateId, 'imports', previewId],
    enabled: pending && previewId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'queued' || status === 'running' ? 2_000 : false;
    },
    queryFn: async () => {
      const job = await unwrap(
        api.GET('/v1/estates/{estateId}/imports/{id}', {
          params: { path: { estateId, id: previewId ?? '' } },
        }),
      );
      if (job.status === 'completed' || job.status === 'failed') {
        setPreview(job);
        void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'imports'] });
      }
      return job;
    },
  });
  const shown = pending && progress.data ? progress.data : preview;

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
          {row.createdCount} / {row.updatedCount} / {row.unchangedCount} / {row.failedCount}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('import.col.status'),
      render: (row) => (
        <StatusPill
          tone={STATUS_TONE[row.status]}
          label={t(`import.status.${row.status}` as MessageKey)}
        />
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

          {kind === 'opening_balances' ? (
            <Banner tone="info">{t('import.balancesHint')}</Banner>
          ) : null}

          {shown ? (
            <div style={{ display: 'grid', gap: 12, marginTop: 8 }}>
              <Banner tone={shown.errorRows > 0 || shown.failedCount > 0 ? 'warning' : 'success'}>
                {t('import.summary', {
                  filename: shown.filename,
                  total: shown.totalRows,
                  valid: shown.validRows,
                  errors: shown.errorRows,
                })}
              </Banner>
              {shown.status === 'queued' || shown.status === 'running' ? (
                <Banner tone="info">{t('import.inProgress')}</Banner>
              ) : null}
              {shown.status === 'completed' || shown.status === 'failed' ? (
                <Banner tone={shown.status === 'failed' ? 'danger' : 'success'}>
                  {t('import.result', {
                    created: shown.createdCount,
                    updated: shown.updatedCount,
                    unchanged: shown.unchangedCount,
                    failed: shown.failedCount,
                  })}
                </Banner>
              ) : null}

              {shown.errors.length > 0 ? (
                <DataTable
                  caption={t('import.errors', { count: shown.errors.length })}
                  rows={shown.errors.slice(0, 100)}
                  rowKey={(row) => `${row.row}-${row.field ?? 'row'}-${row.message}`}
                  columns={[
                    {
                      key: 'row',
                      header: t('import.error.row'),
                      render: (r) => <span className="sz-num">{r.row}</span>,
                    },
                    {
                      key: 'field',
                      header: t('import.error.field'),
                      render: (r) => r.field ?? '-',
                    },
                    {
                      key: 'message',
                      header: t('import.error.message'),
                      render: (r) => r.message,
                    },
                  ]}
                  empty={{ icon: 'check', title: t('import.error.none'), body: '' }}
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
