'use client';

import { type ApiRow, unwrap } from '@safezone/api-client';
import { formatDateTime, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  type Column,
  ConfirmDialog,
  DataTable,
  Dialog,
  Drawer,
  FormError,
  InputField,
  PageHeader,
  SelectField,
  StatusPill,
  Toolbar,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useEstate } from '../../../lib/estate';
import { errorText } from '../../../lib/errors';
import { api } from '../../../lib/session';

type Doc = ApiRow<'/v1/estates/{estateId}/documents', 'get'>;

export function DocumentsScreen() {
  const { estateId, can } = useEstate();
  const queryClient = useQueryClient();
  const canManage = can('document.manage');

  const [folderId, setFolderId] = useState('');
  const [search, setSearch] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [selected, setSelected] = useState<Doc | null>(null);
  const [archiving, setArchiving] = useState<Doc | null>(null);

  const folders = useQuery({
    queryKey: ['estate', estateId, 'document-folders'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/document-folders', { params: { path: { estateId } } }),
      ),
  });

  const docs = useQuery({
    queryKey: ['estate', estateId, 'documents', folderId, search],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/documents', {
          params: {
            path: { estateId },
            query: { folderId: folderId || undefined, q: search.trim() || undefined },
          },
        }),
      ),
  });

  const accessLog = useQuery({
    queryKey: ['estate', estateId, 'documents', selected?.id, 'access-log'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/documents/{id}/access-log', {
          params: { path: { estateId, id: selected!.id } },
        }),
      ),
    enabled: Boolean(selected && canManage),
  });

  const createFolder = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/document-folders', {
          params: { path: { estateId } },
          body: { name: folderName.trim() },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'document-folders'] });
      setCreatingFolder(false);
      setFolderName('');
    },
  });

  const download = useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/documents/{id}/download', {
          params: { path: { estateId, id } },
        }),
      ),
    onSuccess: (res) => {
      window.open(res.url, '_blank', 'noopener,noreferrer');
    },
  });

  const archive = useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/documents/{id}/archive', {
          params: { path: { estateId, id } },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'documents'] });
      setArchiving(null);
      setSelected(null);
    },
  });

  const columns: Column<Doc>[] = [
    {
      key: 'title',
      header: t('mw.documents.document'),
      render: (r) => (
        <button
          type="button"
          className="sz-btn sz-btn-text"
          style={{ padding: 0, fontWeight: 600 }}
          onClick={() => setSelected(r)}
        >
          {r.title}
        </button>
      ),
    },
    {
      key: 'cat',
      header: t('mw.documents.category'),
      render: (r) => r.category.replace(/_/g, ' '),
    },
    {
      key: 'ver',
      header: t('mw.documents.version'),
      align: 'right',
      render: (r) => <span className="sz-num">v{r.currentVersion}</span>,
    },
    {
      key: 'expires',
      header: t('mw.documents.expires'),
      render: (r) => (r.expiresOn ? <span className="sz-num">{r.expiresOn}</span> : '-'),
    },
    {
      key: 'status',
      header: t('mw.documents.status'),
      render: (r) => (
        <StatusPill tone={r.status === 'active' ? 'success' : 'neutral'} label={r.status} />
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <ActionButton
            variant="outline"
            size="sm"
            icon="download"
            busy={download.isPending && download.variables === r.id}
            onClick={() => download.mutate(r.id)}
          >
            {t('documents.download')}
          </ActionButton>
          {canManage && r.status === 'active' ? (
            <ActionButton
              variant="danger"
              size="sm"
              onClick={() => {
                archive.reset();
                setArchiving(r);
              }}
            >
              {t('documents.archive')}
            </ActionButton>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('documents.title')}
        description={t('documents.description')}
        actions={
          canManage ? (
            <ActionButton
              icon="folder"
              onClick={() => {
                createFolder.reset();
                setCreatingFolder(true);
              }}
            >
              {t('documents.createFolder')}
            </ActionButton>
          ) : null
        }
      />

      {download.isError ? <Banner tone="danger">{errorText(download.error)}</Banner> : null}

      <Toolbar>
        <InputField
          label={t('common.search')}
          placeholder={t('mw.documents.searchDocumentTitle')}
          value={search}
          onChange={setSearch}
        />
        <SelectField
          label={t('mw.documents.folder')}
          value={folderId}
          onChange={setFolderId}
          options={[
            { value: '', label: t('mw.documents.allFolders') },
            ...(folders.data ?? []).map((f) => ({ value: f.id, label: f.name })),
          ]}
        />
      </Toolbar>

      <DataTable
        caption={t('documents.title')}
        columns={columns}
        rows={docs.data ?? []}
        rowKey={(r) => r.id}
        loading={docs.isPending}
        error={docs.isError ? errorText(docs.error) : null}
        onRetry={() => void docs.refetch()}
        empty={{ icon: 'folder', title: t('documents.title'), body: t('documents.empty') }}
      />

      {creatingFolder ? (
        <Dialog
          title={t('documents.createFolder')}
          onClose={() => setCreatingFolder(false)}
          onSubmit={() => createFolder.mutate()}
          actions={
            <>
              <ActionButton
                variant="outline"
                type="button"
                onClick={() => setCreatingFolder(false)}
              >
                {t('common.cancel')}
              </ActionButton>
              <ActionButton
                type="submit"
                disabled={!folderName.trim()}
                busy={createFolder.isPending}
              >
                {t('common.save')}
              </ActionButton>
            </>
          }
        >
          <FormError message={createFolder.isError ? errorText(createFolder.error) : null} />
          <div className="sz-form">
            <InputField
              label={t('mw.documents.folderName')}
              required
              value={folderName}
              onChange={setFolderName}
            />
          </div>
        </Dialog>
      ) : null}

      {selected ? (
        <Drawer title={selected.title} onClose={() => setSelected(null)}>
          <div style={{ display: 'grid', gap: 16 }}>
            {selected.description ? <p style={{ margin: 0 }}>{selected.description}</p> : null}
            <div>
              <ActionButton
                variant="outline"
                size="sm"
                icon="download"
                busy={download.isPending}
                onClick={() => download.mutate(selected.id)}
              >
                {t('documents.download')} (v{selected.currentVersion})
              </ActionButton>
            </div>
            {canManage ? (
              <div>
                <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>{t('mw.documents.accessLog')}</h3>
                <DataTable
                  caption={t('mw.documents.documentAccessLog')}
                  rows={accessLog.data ?? []}
                  rowKey={(r) => `${r.userId}-${r.at}-${r.action}`}
                  loading={accessLog.isPending}
                  columns={[
                    { key: 'action', header: t('mw.documents.action'), render: (r) => r.action },
                    {
                      key: 'user',
                      header: t('mw.documents.user'),
                      render: (r) => r.userId.slice(0, 8),
                    },
                    {
                      key: 'at',
                      header: t('mw.documents.time'),
                      render: (r) => <span className="sz-num">{formatDateTime(r.at)}</span>,
                    },
                  ]}
                  empty={{
                    icon: 'history',
                    title: t('mw.documents.noAccessRecordedYet'),
                    body: '',
                  }}
                />
              </div>
            ) : null}
          </div>
        </Drawer>
      ) : null}

      {archiving ? (
        <ConfirmDialog
          title={t('documents.archive')}
          body={t('mw.documents.archiveThisDocumentItWill')}
          confirmLabel={t('documents.archive')}
          destructive
          busy={archive.isPending}
          error={archive.isError ? errorText(archive.error) : null}
          onClose={() => setArchiving(null)}
          onConfirm={() => archive.mutate(archiving.id)}
        />
      ) : null}
    </>
  );
}
