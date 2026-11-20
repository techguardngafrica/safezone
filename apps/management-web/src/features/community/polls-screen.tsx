'use client';

import { type ApiRow, unwrap } from '@safezone/api-client';
import { formatDateTime, t } from '@safezone/i18n';
import {
  ActionButton,
  CheckboxField,
  type Column,
  DataTable,
  Dialog,
  Drawer,
  FormError,
  InputField,
  PageHeader,
  SelectField,
  StatusPill,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useEstate } from '../../../lib/estate';
import { errorText } from '../../../lib/errors';
import { api } from '../../../lib/session';

type Poll = ApiRow<'/v1/estates/{estateId}/polls', 'get'>;

export function PollsScreen() {
  const { estateId, can } = useEstate();
  const queryClient = useQueryClient();
  const canPublish = can('announcement.publish');

  const [creating, setCreating] = useState(false);
  const [question, setQuestion] = useState('');
  const [optionsText, setOptionsText] = useState('Yes\nNo');
  const [closesDate, setClosesDate] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [votePer, setVotePer] = useState<'user' | 'household'>('household');
  const [selected, setSelected] = useState<Poll | null>(null);

  const list = useQuery({
    queryKey: ['estate', estateId, 'polls'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/polls', { params: { path: { estateId } } })),
  });

  const voters = useQuery({
    queryKey: ['estate', estateId, 'polls', selected?.id, 'voters'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/polls/{id}/voters', {
          params: { path: { estateId, id: selected!.id } },
        }),
      ),
    enabled: Boolean(selected && !selected.anonymous && canPublish),
  });

  const create = useMutation({
    mutationFn: () => {
      const options = optionsText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      const closesAt = closesDate
        ? new Date(`${closesDate}T23:59:59.000+01:00`).toISOString()
        : new Date(Date.now() + 7 * 86_400_000).toISOString();
      return unwrap(
        api.POST('/v1/estates/{estateId}/polls', {
          params: { path: { estateId } },
          body: {
            question: question.trim(),
            options,
            closesAt,
            anonymous,
            votePer,
            audience: { type: 'estate' },
          },
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'polls'] });
      setCreating(false);
      setQuestion('');
    },
  });

  const columns: Column<Poll>[] = [
    {
      key: 'question',
      header: 'Question',
      render: (r) => (
        <button
          type="button"
          className="sz-btn sz-btn-text"
          style={{ padding: 0, fontWeight: 600 }}
          onClick={() => setSelected(r)}
        >
          {r.question}
        </button>
      ),
    },
    {
      key: 'votes',
      header: 'Votes',
      align: 'right',
      render: (r) => <span className="sz-num">{r.totalVotes}</span>,
    },
    {
      key: 'closes',
      header: 'Closes',
      render: (r) => <span className="sz-num">{formatDateTime(r.closesAt)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <StatusPill
          tone={r.status === 'closed' ? 'neutral' : 'success'}
          label={r.status === 'closed' ? 'Closed' : 'Open'}
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('polls.title')}
        description={t('polls.description')}
        actions={
          canPublish ? (
            <ActionButton
              icon="plus"
              onClick={() => {
                create.reset();
                setCreating(true);
              }}
            >
              {t('polls.create')}
            </ActionButton>
          ) : null
        }
      />

      <DataTable
        caption={t('polls.title')}
        columns={columns}
        rows={list.data ?? []}
        rowKey={(r) => r.id}
        loading={list.isPending}
        error={list.isError ? errorText(list.error) : null}
        onRetry={() => void list.refetch()}
        empty={{ icon: 'barChart', title: t('polls.title'), body: t('polls.empty') }}
      />

      {creating ? (
        <Dialog
          title={t('polls.create')}
          onClose={() => setCreating(false)}
          onSubmit={() => create.mutate()}
          actions={
            <>
              <ActionButton variant="outline" type="button" onClick={() => setCreating(false)}>
                {t('common.cancel')}
              </ActionButton>
              <ActionButton type="submit" disabled={!question.trim()} busy={create.isPending}>
                {t('polls.create')}
              </ActionButton>
            </>
          }
        >
          <FormError message={create.isError ? errorText(create.error) : null} />
          <div className="sz-form">
            <InputField label="Question" required value={question} onChange={setQuestion} />
            <div className="sz-field">
              <label htmlFor="poll-options">Options (one per line)</label>
              <textarea
                id="poll-options"
                className="sz-input"
                rows={4}
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
              />
            </div>
            <div className="sz-form-2">
              <InputField
                label="Close date"
                type="date"
                value={closesDate}
                onChange={setClosesDate}
              />
              <SelectField
                label="Vote rule"
                value={votePer}
                onChange={setVotePer}
                options={[
                  { value: 'household', label: 'One per household' },
                  { value: 'user', label: 'One per resident' },
                ]}
              />
            </div>
            <CheckboxField
              label="Anonymous votes (hide voter names)"
              checked={anonymous}
              onChange={setAnonymous}
            />
          </div>
        </Dialog>
      ) : null}

      {selected ? (
        <Drawer title={selected.question} onClose={() => setSelected(null)}>
          <div style={{ display: 'grid', gap: 16 }}>
            <div className="sz-muted" style={{ fontSize: 14 }}>
              Total votes: {selected.totalVotes} · Closes {formatDateTime(selected.closesAt)}
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              {selected.options.map((opt) => {
                const total = selected.totalVotes ?? 0;
                const votes = opt.votes ?? 0;
                const pct = total > 0 ? Math.round((votes / total) * 100) : 0;
                return (
                  <div key={opt.id} className="sz-card" style={{ padding: 12 }}>
                    <div
                      style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}
                    >
                      <span>{opt.label}</span>
                      <span className="sz-num">
                        {votes} ({pct}%)
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            {!selected.anonymous && canPublish ? (
              <div>
                <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Voters</h3>
                <DataTable
                  caption="Voters"
                  rows={voters.data ?? []}
                  rowKey={(r) => `${r.userId}-${r.votedAt}`}
                  loading={voters.isPending}
                  columns={[
                    { key: 'name', header: 'Resident', render: (r) => r.userId.slice(0, 8) },
                    {
                      key: 'opt',
                      header: 'Choice',
                      render: (r) =>
                        selected.options.find((o) => o.id === r.optionId)?.label ??
                        r.optionId.slice(0, 8),
                    },
                    {
                      key: 'at',
                      header: 'Voted at',
                      render: (r) => <span className="sz-num">{formatDateTime(r.votedAt)}</span>,
                    },
                  ]}
                  empty={{ icon: 'users', title: 'No votes yet', body: '' }}
                />
              </div>
            ) : null}
          </div>
        </Drawer>
      ) : null}
    </>
  );
}
