'use client';

import { type ApiData, unwrap } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  type Column,
  ConfirmDialog,
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
  type Tone,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useEstate } from '../../../lib/estate';
import { errorText } from '../../../lib/errors';
import { api } from '../../../lib/session';

type TemplateRow = ApiData<'/v1/estates/{estateId}/notification-templates', 'get'>[number];
type StateFilter = 'all' | 'customised' | 'customisable' | 'locked';

const PRIORITY_TONE: Record<TemplateRow['priority'], Tone> = {
  critical: 'danger',
  high: 'warning',
  normal: 'info',
  bulk: 'neutral',
};

function humanize(value: string): string {
  return value.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function EditTemplateDialog({ template, onClose }: { template: TemplateRow; onClose: () => void }) {
  const { estateId } = useEstate();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(template.customTitle ?? template.defaultTitle);
  const [body, setBody] = useState(template.customBody ?? template.defaultBody);
  const [sms, setSms] = useState(template.customSms ?? template.defaultSms ?? '');
  const supportsSms = template.channels.includes('sms');

  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.PUT('/v1/estates/{estateId}/notification-templates/{intent}', {
          params: { path: { estateId, intent: template.intent } },
          body: {
            title: title.trim(),
            body: body.trim(),
            sms: supportsSms ? sms.trim() || null : null,
          },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['estate', estateId, 'notification-templates'],
      });
      onClose();
    },
  });

  return (
    <Dialog
      wide
      title={t('mw.notifications.edit.title', { intent: template.intent })}
      onClose={onClose}
      onSubmit={() => {
        if (title.trim() && body.trim()) save.mutate();
      }}
      actions={
        <>
          <ActionButton variant="text" onClick={onClose}>
            {t('common.cancel')}
          </ActionButton>
          <ActionButton type="submit" busy={save.isPending}>
            {t('common.save')}
          </ActionButton>
        </>
      }
    >
      <div className="sz-form">
        <p className="sz-muted" style={{ margin: 0, fontSize: 13 }}>
          {template.placeholders.length > 0
            ? t('mw.notifications.edit.placeholders', {
                list: template.placeholders.map((p) => `{${p}}`).join(', '),
              })
            : t('mw.notifications.edit.noPlaceholders')}
        </p>
        <p className="sz-muted" style={{ margin: 0, fontSize: 12 }}>
          {t('mw.notifications.edit.defaultRef', {
            title: template.defaultTitle,
            body: template.defaultBody,
          })}
        </p>
        <InputField
          label={t('mw.notifications.edit.titleField')}
          value={title}
          onChange={setTitle}
          required
          maxLength={160}
        />
        <TextAreaField
          label={t('mw.notifications.edit.bodyField')}
          value={body}
          onChange={setBody}
          required
          rows={4}
          maxLength={1000}
        />
        {supportsSms ? (
          <TextAreaField
            label={t('mw.notifications.edit.smsField')}
            value={sms}
            onChange={setSms}
            rows={2}
            maxLength={320}
            helper={t('mw.notifications.edit.smsHelp', { count: sms.trim().length })}
          />
        ) : null}
        <FormError message={save.isError ? errorText(save.error) : null} />
      </div>
    </Dialog>
  );
}

/** Estate notification templates and wording overrides (management-web.md §6.13, notifications.md §7). */
export function NotificationTemplatesScreen() {
  const { estateId } = useEstate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [editing, setEditing] = useState<TemplateRow | null>(null);
  const [resetting, setResetting] = useState<TemplateRow | null>(null);

  const query = useQuery({
    queryKey: ['estate', estateId, 'notification-templates'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/notification-templates', {
          params: { path: { estateId } },
        }),
      ),
  });

  const resetMutation = useMutation({
    mutationFn: (intent: string) =>
      unwrap(
        api.DELETE('/v1/estates/{estateId}/notification-templates/{intent}', {
          params: { path: { estateId, intent } },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['estate', estateId, 'notification-templates'],
      });
      setResetting(null);
    },
  });

  const categories = useMemo(() => {
    const set = new Set((query.data ?? []).map((item) => item.category));
    return [...set].sort();
  }, [query.data]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (query.data ?? []).filter((item) => {
      const isCustomised = item.customTitle !== null;
      if (category && item.category !== category) return false;
      if (stateFilter === 'customised' && !isCustomised) return false;
      if (stateFilter === 'customisable' && !item.customisable) return false;
      if (stateFilter === 'locked' && item.customisable) return false;
      if (!needle) return true;
      const activeTitle = (item.customTitle ?? item.defaultTitle).toLowerCase();
      const activeBody = (item.customBody ?? item.defaultBody).toLowerCase();
      return (
        item.intent.toLowerCase().includes(needle) ||
        activeTitle.includes(needle) ||
        activeBody.includes(needle)
      );
    });
  }, [query.data, search, category, stateFilter]);

  const columns: Column<TemplateRow>[] = [
    {
      key: 'intent',
      header: t('mw.notifications.col.intent'),
      render: (row) => (
        <div>
          <code>{row.intent}</code>
          <div className="sz-muted" style={{ fontSize: 12 }}>
            {humanize(row.category)}
          </div>
        </div>
      ),
    },
    {
      key: 'priority',
      header: t('mw.notifications.col.priority'),
      render: (row) => (
        <StatusPill tone={PRIORITY_TONE[row.priority]} label={humanize(row.priority)} />
      ),
    },
    {
      key: 'channels',
      header: t('mw.notifications.col.channels'),
      render: (row) => (
        <div>
          {row.channels.join(', ')}
          {row.smsOnlyWithoutPush ? (
            <div className="sz-muted" style={{ fontSize: 12 }}>
              {t('mw.notifications.smsFallback')}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'copy',
      header: t('mw.notifications.col.copy'),
      render: (row) => {
        const title = row.customTitle ?? row.defaultTitle;
        const body = row.customBody ?? row.defaultBody;
        const sms = row.customSms ?? row.defaultSms;
        return (
          <div>
            <strong>{title}</strong>
            <div className="sz-muted" style={{ fontSize: 12 }}>
              {body}
            </div>
            {sms ? (
              <div className="sz-muted" style={{ fontSize: 12 }}>
                SMS: {sms}
              </div>
            ) : null}
          </div>
        );
      },
    },
    {
      key: 'status',
      header: t('mw.notifications.col.status'),
      render: (row) =>
        row.customTitle !== null ? (
          <StatusPill tone="info" label={t('mw.notifications.status.customised')} />
        ) : row.customisable ? (
          <StatusPill tone="neutral" label={t('mw.notifications.status.default')} />
        ) : (
          <StatusPill tone="warning" label={t('mw.notifications.status.locked')} />
        ),
    },
    {
      key: 'actions',
      header: t('mw.notifications.col.actions'),
      render: (row) =>
        row.customisable ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <ActionButton size="sm" variant="outline" onClick={() => setEditing(row)}>
              {t('mw.notifications.action.edit')}
            </ActionButton>
            {row.customTitle !== null ? (
              <ActionButton size="sm" variant="text" onClick={() => setResetting(row)}>
                {t('mw.notifications.action.reset')}
              </ActionButton>
            ) : null}
          </div>
        ) : (
          <span className="sz-muted">-</span>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('mw.notifications.title')}
        description={t('mw.notifications.description')}
      />
      <Toolbar>
        <InputField
          label={t('mw.notifications.filter.search')}
          value={search}
          onChange={setSearch}
        />
        <SelectField
          label={t('mw.notifications.filter.category')}
          value={category}
          onChange={setCategory}
          options={[
            { value: '', label: t('mw.notifications.filter.allCategories') },
            ...categories.map((c) => ({ value: c, label: humanize(c) })),
          ]}
        />
        <SelectField<StateFilter>
          label={t('mw.notifications.filter.state')}
          value={stateFilter}
          onChange={setStateFilter}
          options={[
            { value: 'all', label: t('mw.notifications.filter.allStates') },
            { value: 'customised', label: t('mw.notifications.filter.customised') },
            { value: 'customisable', label: t('mw.notifications.filter.customisable') },
            { value: 'locked', label: t('mw.notifications.filter.locked') },
          ]}
        />
      </Toolbar>

      <FormError message={resetMutation.isError ? errorText(resetMutation.error) : null} />

      {query.isError ? (
        <ErrorState message={errorText(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <DataTable
          caption={t('mw.notifications.title')}
          loading={query.isPending}
          rows={rows}
          rowKey={(row) => row.intent}
          columns={columns}
          empty={{
            icon: 'messageSquare',
            title: t('mw.notifications.title'),
            body: t('mw.notifications.empty'),
          }}
        />
      )}

      {editing ? <EditTemplateDialog template={editing} onClose={() => setEditing(null)} /> : null}

      {resetting ? (
        <ConfirmDialog
          title={t('mw.notifications.reset.title')}
          body={t('mw.notifications.reset.body', { intent: resetting.intent })}
          confirmLabel={t('mw.notifications.reset.confirm')}
          destructive
          busy={resetMutation.isPending}
          onClose={() => setResetting(null)}
          onConfirm={() => resetMutation.mutate(resetting.intent)}
        />
      ) : null}
    </>
  );
}
