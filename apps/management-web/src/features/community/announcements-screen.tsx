'use client';

import { type ApiRow, unwrap, unwrapPage } from '@safezone/api-client';
import { type MessageKey, formatDateTime, t } from '@safezone/i18n';
import {
  ActionButton,
  type Column,
  DataTable,
  Dialog,
  Drawer,
  FormError,
  InputField,
  PageHeader,
  SelectField,
  StatusPill,
  TextAreaField,
} from '@safezone/web-ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useEstate } from '../../../lib/estate';
import { errorText } from '../../../lib/errors';
import { usePaged } from '../../../lib/paged';
import { api } from '../../../lib/session';

type Announcement = ApiRow<'/v1/estates/{estateId}/announcements', 'get'>;
type Category = Announcement['category'];
type Priority = Announcement['priority'];
const CATEGORIES: Category[] = ['general', 'security', 'maintenance', 'event', 'billing'];

function Composer({ onClose }: { onClose: () => void }) {
  const { estateId } = useEstate();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState<Category>('general');
  const [priority, setPriority] = useState<Priority>('normal');
  const [errors, setErrors] = useState<{ title?: string; body?: string }>({});
  const publish = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/announcements', {
          params: { path: { estateId } },
          body: {
            title: title.trim(),
            body: body.trim(),
            category,
            priority,
            audience: { type: 'estate' },
          },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'announcements'] });
      onClose();
    },
  });
  return (
    <Dialog
      wide
      title={t('announcement.compose.title')}
      onClose={onClose}
      onSubmit={() => {
        const next = {
          title: title.trim() ? undefined : t('announcement.form.titleRequired'),
          body: body.trim() ? undefined : t('announcement.form.bodyRequired'),
        };
        setErrors(next);
        if (!next.title && !next.body) publish.mutate();
      }}
      actions={
        <>
          <ActionButton variant="text" onClick={onClose}>
            {t('common.cancel')}
          </ActionButton>
          <ActionButton type="submit" busy={publish.isPending}>
            {t('announcement.compose.publish')}
          </ActionButton>
        </>
      }
    >
      <div className="sz-form">
        <InputField
          label={t('announcement.form.title')}
          value={title}
          onChange={setTitle}
          error={errors.title}
          maxLength={120}
          autoFocus
        />
        <TextAreaField
          label={t('announcement.form.body')}
          value={body}
          onChange={setBody}
          error={errors.body}
          rows={6}
          maxLength={5000}
        />
        <div className="sz-form-2">
          <SelectField
            label={t('announcement.form.category')}
            value={category}
            onChange={setCategory}
            options={CATEGORIES.map((value) => ({
              value,
              label: t(`announcement.category.${value}` as MessageKey),
            }))}
          />
          <SelectField
            label={t('announcement.form.priority')}
            value={priority}
            onChange={setPriority}
            helper={t('announcement.form.priorityHelp')}
            options={[
              { value: 'normal', label: t('announcement.priority.normal') },
              { value: 'important', label: t('announcement.priority.important') },
            ]}
          />
        </div>
        <p className="sz-muted" style={{ margin: 0, fontSize: 13 }}>
          {t('announcement.form.audienceEstate')}
        </p>
        <FormError message={publish.isError ? errorText(publish.error) : null} />
      </div>
    </Dialog>
  );
}

export function AnnouncementsScreen() {
  const { estateId } = useEstate();
  const [composing, setComposing] = useState(false);
  const [open, setOpen] = useState<Announcement | null>(null);
  const list = usePaged<Announcement>(['estate', estateId, 'announcements', 'all'], (cursor) =>
    unwrapPage(
      api.GET('/v1/estates/{estateId}/announcements', {
        params: { path: { estateId }, query: { all: 'true', limit: 25, cursor } },
      }),
    ),
  );
  const columns: Column<Announcement>[] = [
    {
      key: 'title',
      header: t('announcement.col.title'),
      render: (row) => (
        <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong>{row.title}</strong>
          {row.priority === 'important' ? (
            <StatusPill tone="warning" label={t('announcement.priority.important')} />
          ) : null}
        </span>
      ),
    },
    {
      key: 'category',
      header: t('announcement.col.category'),
      render: (row) => t(`announcement.category.${row.category}` as MessageKey),
    },
    {
      key: 'audience',
      header: t('announcement.col.audience'),
      render: (row) => t(`announcement.audience.${row.audienceType}` as MessageKey),
    },
    {
      key: 'recipients',
      header: t('announcement.col.recipients'),
      align: 'right',
      render: (row) => (row.recipients ?? '-').toString(),
    },
    {
      key: 'published',
      header: t('announcement.col.published'),
      align: 'right',
      render: (row) => formatDateTime(row.publishedAt),
    },
  ];
  return (
    <>
      <PageHeader
        title={t('announcement.title')}
        description={t('announcement.description')}
        actions={
          <ActionButton icon="plus" onClick={() => setComposing(true)}>
            {t('announcement.compose.title')}
          </ActionButton>
        }
      />
      <DataTable
        caption={t('announcement.title')}
        columns={columns}
        rows={list.rows}
        rowKey={(row) => row.id}
        loading={list.loading}
        error={list.error ? errorText(list.error) : null}
        onRetry={list.refetch}
        onRowClick={setOpen}
        selectedKey={open?.id}
        hasMore={list.hasMore}
        loadingMore={list.loadingMore}
        onLoadMore={list.loadMore}
        empty={{
          icon: 'megaphone',
          title: t('announcement.empty.title'),
          body: t('announcement.empty.body'),
        }}
      />
      {composing ? <Composer onClose={() => setComposing(false)} /> : null}
      {open ? (
        <Drawer title={open.title} onClose={() => setOpen(null)}>
          <p className="sz-muted" style={{ marginTop: 0, fontSize: 14 }}>
            {formatDateTime(open.publishedAt)} ·{' '}
            {t(`announcement.category.${open.category}` as MessageKey)}
          </p>
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 15 }}>{open.body}</div>
        </Drawer>
      ) : null}
    </>
  );
}
