'use client';

import { type ApiRow, unwrap } from '@safezone/api-client';
import { formatKobo, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  CheckboxField,
  type Column,
  ConfirmDialog,
  DataTable,
  Drawer,
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

type Move = ApiRow<'/v1/estates/{estateId}/moves', 'get'>;

export function MovesScreen() {
  const { estateId, can } = useEstate();
  const queryClient = useQueryClient();
  const canApprove = can('resident.approve');

  const [status, setStatus] = useState<'' | 'scheduled' | 'completed' | 'cancelled'>('scheduled');
  const [selected, setSelected] = useState<Move | null>(null);
  const [completing, setCompleting] = useState<Move | null>(null);
  const [cancelling, setCancelling] = useState<Move | null>(null);

  const list = useQuery({
    queryKey: ['estate', estateId, 'moves', status],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/moves', {
          params: { path: { estateId }, query: { status: status || undefined } },
        }),
      ),
  });

  const saveChecklist = useMutation({
    mutationFn: ({ id, items }: { id: string; items: { item: string; done: boolean }[] }) =>
      unwrap(
        api.PUT('/v1/estates/{estateId}/moves/{id}/checklist', {
          params: { path: { estateId, id } },
          body: { items },
        }),
      ),
    onSuccess: (updated) => {
      setSelected(updated);
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'moves'] });
    },
  });

  const complete = useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/moves/{id}/complete', {
          params: { path: { estateId, id } },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'moves'] });
      setCompleting(null);
      setSelected(null);
    },
  });

  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/moves/{id}/cancel', {
          params: { path: { estateId, id } },
          body: { reason },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'moves'] });
      setCancelling(null);
      setSelected(null);
    },
  });

  const columns: Column<Move>[] = [
    {
      key: 'unit',
      header: t('mw.moves.unit'),
      render: (r) => (
        <button
          type="button"
          className="sz-btn sz-btn-text"
          style={{ padding: 0, fontWeight: 600 }}
          onClick={() => setSelected(r)}
        >
          {r.unitCode}
        </button>
      ),
    },
    {
      key: 'type',
      header: t('mw.moves.type'),
      render: (r) => (
        <StatusPill
          tone={r.type === 'move_in' ? 'info' : 'warning'}
          label={r.type === 'move_in' ? 'Move-in' : t('mw.moves.moveOut')}
        />
      ),
    },
    {
      key: 'date',
      header: t('mw.moves.scheduledDate'),
      render: (r) => <span className="sz-num">{r.scheduledOn}</span>,
    },
    {
      key: 'balance',
      header: t('mw.moves.balanceAtScheduling'),
      align: 'right',
      render: (r) => <span className="sz-num">{formatKobo(r.outstandingBalance)}</span>,
    },
    {
      key: 'status',
      header: t('mw.moves.status'),
      render: (r) => (
        <StatusPill
          tone={
            r.status === 'completed' ? 'success' : r.status === 'scheduled' ? 'info' : 'neutral'
          }
          label={r.status}
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader title={t('moves.title')} description={t('moves.description')} />

      <Toolbar>
        <SelectField
          label={t('mw.moves.status')}
          value={status}
          onChange={setStatus}
          options={[
            { value: '', label: t('mw.moves.allStatuses') },
            { value: 'scheduled', label: t('mw.moves.scheduled') },
            { value: 'completed', label: t('mw.moves.completed') },
            { value: 'cancelled', label: t('mw.moves.cancelled') },
          ]}
        />
      </Toolbar>

      <DataTable
        caption={t('moves.title')}
        columns={columns}
        rows={list.data ?? []}
        rowKey={(r) => r.id}
        loading={list.isPending}
        error={list.isError ? errorText(list.error) : null}
        onRetry={() => void list.refetch()}
        empty={{ icon: 'home', title: t('moves.title'), body: t('moves.empty') }}
      />

      {selected ? (
        <Drawer
          title={`${selected.unitCode} (${selected.type === 'move_in' ? 'Move-in' : t('mw.moves.moveOut')})`}
          onClose={() => setSelected(null)}
        >
          <div style={{ display: 'grid', gap: 16 }}>
            {selected.outstandingBalance > 0 ? (
              <Banner tone="warning">
                Outstanding unit balance: {formatKobo(selected.outstandingBalance)}
              </Banner>
            ) : null}
            {saveChecklist.isError ? (
              <Banner tone="danger">{errorText(saveChecklist.error)}</Banner>
            ) : null}

            <div>
              <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>{t('mw.moves.checklist')}</h3>
              {selected.checklist.length === 0 ? (
                <p className="sz-muted" style={{ margin: 0, fontSize: 14 }}>
                  {t('mw.moves.noChecklistItems')}
                </p>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {selected.checklist.map((entry, index) => (
                    <CheckboxField
                      key={entry.item}
                      label={entry.item}
                      checked={entry.done}
                      onChange={(checked) => {
                        if (!canApprove || selected.status !== 'scheduled') return;
                        const next = selected.checklist.map((item, idx) =>
                          idx === index ? { ...item, done: checked } : item,
                        );
                        saveChecklist.mutate({ id: selected.id, items: next });
                      }}
                    />
                  ))}
                </div>
              )}
            </div>

            {canApprove && selected.status === 'scheduled' ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <ActionButton
                  onClick={() => {
                    complete.reset();
                    setCompleting(selected);
                  }}
                >
                  {t('moves.complete')}
                </ActionButton>
                <ActionButton
                  variant="danger"
                  onClick={() => {
                    cancel.reset();
                    setCancelling(selected);
                  }}
                >
                  {t('moves.cancel')}
                </ActionButton>
              </div>
            ) : null}
          </div>
        </Drawer>
      ) : null}

      {completing ? (
        <ConfirmDialog
          title={t('moves.complete')}
          body={
            completing.type === 'move_out'
              ? t('mw.moves.completingThisMoveOutWill')
              : t('mw.moves.markThisMoveInAs')
          }
          confirmLabel={t('moves.complete')}
          destructive={completing.type === 'move_out'}
          busy={complete.isPending}
          error={complete.isError ? errorText(complete.error) : null}
          onClose={() => setCompleting(null)}
          onConfirm={() => complete.mutate(completing.id)}
        />
      ) : null}

      {cancelling ? (
        <ConfirmDialog
          title={t('moves.cancel')}
          body={t('mw.moves.cancelThisScheduledMove')}
          confirmLabel={t('moves.cancel')}
          destructive
          reason={{ label: t('mw.moves.reason'), required: true }}
          busy={cancel.isPending}
          error={cancel.isError ? errorText(cancel.error) : null}
          onClose={() => setCancelling(null)}
          onConfirm={(reason) => cancel.mutate({ id: cancelling.id, reason: reason ?? '' })}
        />
      ) : null}
    </>
  );
}
