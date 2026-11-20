'use client';

import { type ApiRow, unwrap } from '@safezone/api-client';
import { formatDateTime, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  type Column,
  ConfirmDialog,
  DataTable,
  PageHeader,
  StatusPill,
  type Tone,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useEstate } from '../../../lib/estate';
import { errorText } from '../../../lib/errors';
import { api } from '../../../lib/session';

type ExportRow = ApiRow<'/v1/estates/{estateId}/exports', 'get'>;

const STATUS_TONE: Record<string, Tone> = {
  queued: 'info',
  running: 'info',
  ready: 'success',
  failed: 'danger',
  expired: 'neutral',
};

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function DataExportScreen() {
  const { estateId } = useEstate();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const list = useQuery({
    queryKey: ['estate', estateId, 'exports'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/exports', { params: { path: { estateId } } })),
    refetchInterval: 10_000,
  });

  const requestExport = useMutation({
    mutationFn: () =>
      unwrap(api.POST('/v1/estates/{estateId}/exports', { params: { path: { estateId } } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'exports'] });
      setConfirming(false);
    },
  });

  const download = useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/exports/{id}/download', {
          params: { path: { estateId, id } },
        }),
      ),
    onSuccess: (res) => {
      window.open(res.url, '_blank', 'noopener,noreferrer');
    },
  });

  const columns: Column<ExportRow>[] = [
    {
      key: 'created',
      header: 'Requested',
      render: (r) => <span className="sz-num">{formatDateTime(r.createdAt)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <StatusPill tone={STATUS_TONE[r.status] ?? 'neutral'} label={r.status} />,
    },
    {
      key: 'size',
      header: 'Size',
      align: 'right',
      render: (r) => <span className="sz-num">{formatBytes(r.sizeBytes)}</span>,
    },
    {
      key: 'expires',
      header: 'Expires',
      render: (r) =>
        r.expiresAt ? (
          <span className="sz-num">{formatDateTime(r.expiresAt)}</span>
        ) : (
          <span className="sz-muted">-</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) =>
        r.status === 'ready' ? (
          <ActionButton
            variant="outline"
            size="sm"
            icon="download"
            busy={download.isPending && download.variables === r.id}
            onClick={() => download.mutate(r.id)}
          >
            {t('dataExport.download')}
          </ActionButton>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title={t('dataExport.title')}
        description={t('dataExport.description')}
        actions={
          <ActionButton
            icon="download"
            onClick={() => {
              requestExport.reset();
              setConfirming(true);
            }}
          >
            {t('dataExport.request')}
          </ActionButton>
        }
      />

      {download.isError ? <Banner tone="danger">{errorText(download.error)}</Banner> : null}

      <DataTable
        caption={t('dataExport.title')}
        columns={columns}
        rows={list.data ?? []}
        rowKey={(r) => r.id}
        loading={list.isPending}
        error={list.isError ? errorText(list.error) : null}
        onRetry={() => void list.refetch()}
        empty={{ icon: 'download', title: t('dataExport.title'), body: t('dataExport.empty') }}
      />

      {confirming ? (
        <ConfirmDialog
          title={t('dataExport.confirmTitle')}
          body={t('dataExport.confirmBody')}
          confirmLabel={t('dataExport.request')}
          busy={requestExport.isPending}
          error={requestExport.isError ? errorText(requestExport.error) : null}
          onClose={() => setConfirming(false)}
          onConfirm={() => requestExport.mutate()}
        />
      ) : null}
    </>
  );
}
