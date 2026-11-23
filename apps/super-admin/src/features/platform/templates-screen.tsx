'use client';

import { unwrap } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import {
  DataTable,
  ErrorState,
  InputField,
  PageHeader,
  SelectField,
  StatusPill,
  Toolbar,
} from '@safezone/web-ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api } from '../../../lib/session';
import { errorText } from '../../lib/errors';
import { humanizeStatus, statusTone } from '../../lib/format';

/** Platform notification template catalogue (super-admin.md §6.9). */
export function TemplatesScreen() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');

  const query = useQuery({
    queryKey: ['platform', 'notification-templates'],
    queryFn: () => unwrap(api.GET('/v1/platform/notification-templates')),
  });

  const categories = useMemo(() => {
    const set = new Set((query.data ?? []).map((item) => item.category));
    return [...set].sort();
  }, [query.data]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (query.data ?? []).filter((item) => {
      if (category && item.category !== category) return false;
      if (!needle) return true;
      return (
        item.intent.toLowerCase().includes(needle) ||
        item.titleText.toLowerCase().includes(needle) ||
        item.bodyText.toLowerCase().includes(needle)
      );
    });
  }, [query.data, search, category]);

  return (
    <>
      <PageHeader
        title={t('admin.platform.templates.title')}
        description={t('admin.platform.templates.description')}
      />
      <Toolbar>
        <InputField
          label={t('admin.platform.templates.search')}
          value={search}
          onChange={setSearch}
        />
        <SelectField
          label={t('admin.platform.templates.category')}
          value={category}
          onChange={setCategory}
          options={[
            { value: '', label: t('admin.platform.templates.allCategories') },
            ...categories.map((c) => ({ value: c, label: humanizeStatus(c) })),
          ]}
        />
      </Toolbar>

      {query.isError ? (
        <ErrorState message={errorText(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <DataTable
          caption={t('admin.platform.templates.title')}
          loading={query.isPending}
          rows={rows}
          rowKey={(row) => row.intent}
          empty={{ icon: 'inbox', title: t('admin.platform.templates.empty') }}
          columns={[
            {
              key: 'intent',
              header: t('admin.platform.templates.intent'),
              render: (row) => (
                <div>
                  <code>{row.intent}</code>
                  <div className="sz-muted" style={{ fontSize: 12 }}>
                    {humanizeStatus(row.category)}
                    {row.mandatory ? ` · ${t('admin.platform.templates.mandatory')}` : ''}
                  </div>
                </div>
              ),
            },
            {
              key: 'priority',
              header: t('admin.platform.templates.priority'),
              render: (row) => (
                <StatusPill tone={statusTone(row.priority)} label={humanizeStatus(row.priority)} />
              ),
            },
            {
              key: 'channels',
              header: t('admin.platform.templates.channels'),
              render: (row) => (
                <div>
                  {row.channels.join(', ')}
                  {row.smsOnlyWithoutPush ? (
                    <div className="sz-muted" style={{ fontSize: 12 }}>
                      SMS fallback only
                    </div>
                  ) : null}
                </div>
              ),
            },
            {
              key: 'copy',
              header: t('admin.platform.templates.copy'),
              render: (row) => (
                <div>
                  <strong>{row.titleText}</strong>
                  <div className="sz-muted" style={{ fontSize: 12 }}>
                    {row.bodyText}
                  </div>
                  {row.smsText ? (
                    <div className="sz-muted" style={{ fontSize: 12 }}>
                      SMS: {row.smsText}
                    </div>
                  ) : null}
                </div>
              ),
            },
          ]}
        />
      )}
    </>
  );
}
