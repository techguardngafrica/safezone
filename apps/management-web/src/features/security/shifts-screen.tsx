'use client';

import { type ApiRow, unwrap, unwrapPage } from '@safezone/api-client';
import { formatDateTime, t } from '@safezone/i18n';
import {
  ActionButton,
  type Column,
  ConfirmDialog,
  DataTable,
  PageHeader,
  SelectField,
  StatusPill,
  Toolbar,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useEstate } from '../../../lib/estate';
import { errorText } from '../../../lib/errors';
import { usePaged } from '../../../lib/paged';
import { api } from '../../../lib/session';
import { useGates } from '../../../lib/use-gates';

type ShiftSession = ApiRow<'/v1/estates/{estateId}/shift-sessions', 'get'>;

export function ShiftsScreen() {
  const { estateId } = useEstate();
  const queryClient = useQueryClient();
  const { gates, gateName } = useGates();

  const [gateId, setGateId] = useState('');
  const [guardId, setGuardId] = useState('');
  const [openFilter, setOpenFilter] = useState<'all' | 'open'>('all');
  const [ending, setEnding] = useState<ShiftSession | null>(null);

  const guards = useQuery({
    queryKey: ['estate', estateId, 'guards'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/guards', { params: { path: { estateId } } })),
  });

  const list = usePaged<ShiftSession>(
    ['estate', estateId, 'shift-sessions', gateId, guardId, openFilter],
    (cursor) =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/shift-sessions', {
          params: {
            path: { estateId },
            query: {
              gateId: gateId || undefined,
              userId: guardId || undefined,
              open: openFilter === 'open' ? 'true' : undefined,
              limit: 50,
              cursor,
            },
          },
        }),
      ),
  );

  const endShift = useMutation({
    mutationFn: ({ id, handoverNote }: { id: string; handoverNote: string }) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/shift-sessions/{id}/end', {
          params: { path: { estateId, id } },
          body: { handoverNote },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'shift-sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'guards'] });
      setEnding(null);
    },
  });

  const guardName = (userId: string) => {
    const found = (guards.data ?? []).find((item) => item.userId === userId);
    return found?.fullName ?? found?.phone ?? `${userId.slice(0, 8)}...`;
  };

  const columns: Column<ShiftSession>[] = [
    {
      key: 'guard',
      header: t('shift.col.guard'),
      render: (row) => guardName(row.userId),
    },
    {
      key: 'gate',
      header: t('shift.col.gate'),
      render: (row) => row.gateName ?? gateName(row.gateId),
    },
    {
      key: 'started',
      header: t('shift.col.started'),
      render: (row) => <span className="sz-num">{formatDateTime(row.startedAt)}</span>,
    },
    {
      key: 'ended',
      header: t('shift.col.ended'),
      render: (row) =>
        row.endedAt ? (
          <span className="sz-num">{formatDateTime(row.endedAt)}</span>
        ) : (
          <span className="sz-muted">-</span>
        ),
    },
    {
      key: 'status',
      header: t('shift.col.status'),
      render: (row) => (
        <StatusPill
          tone={row.endedAt ? 'neutral' : 'success'}
          icon={row.endedAt ? 'check' : 'clock'}
          label={row.endedAt ? t('shift.status.ended') : t('shift.status.open')}
        />
      ),
    },
    {
      key: 'handover',
      header: t('shift.col.handover'),
      render: (row) => row.handoverNote ?? <span className="sz-muted">-</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) =>
        row.endedAt ? null : (
          <ActionButton
            variant="outline"
            size="sm"
            onClick={() => {
              endShift.reset();
              setEnding(row);
            }}
          >
            {t('shift.end.action')}
          </ActionButton>
        ),
    },
  ];

  return (
    <>
      <PageHeader title={t('shift.title')} description={t('shift.description')} />

      <Toolbar>
        <SelectField
          label={t('shift.filter.gate')}
          value={gateId}
          onChange={setGateId}
          options={[
            { value: '', label: t('visitorLog.filter.allGates') },
            ...gates.map((gate) => ({ value: gate.id, label: gate.name })),
          ]}
        />
        <SelectField
          label={t('shift.filter.guard')}
          value={guardId}
          onChange={setGuardId}
          options={[
            { value: '', label: t('shift.filter.allGuards') },
            ...(guards.data ?? []).map((guard) => ({
              value: guard.userId,
              label: guard.fullName ?? guard.phone,
            })),
          ]}
        />
        <SelectField
          label={t('shift.filter.status')}
          value={openFilter}
          onChange={setOpenFilter}
          options={[
            { value: 'all', label: t('shift.filter.all') },
            { value: 'open', label: t('shift.filter.openOnly') },
          ]}
        />
      </Toolbar>

      <DataTable
        caption={t('shift.title')}
        columns={columns}
        rows={list.rows}
        rowKey={(row) => row.id}
        loading={list.loading}
        error={list.error ? errorText(list.error) : null}
        onRetry={() => void list.refetch()}
        hasMore={list.hasMore}
        loadingMore={list.loadingMore}
        onLoadMore={list.loadMore}
        empty={{
          icon: 'clock',
          title: t('shift.empty.title'),
          body: t('shift.empty.body'),
        }}
      />

      {ending ? (
        <ConfirmDialog
          title={t('shift.end.title')}
          body={t('shift.end.body')}
          confirmLabel={t('shift.end.action')}
          destructive
          reason={{ label: t('shift.end.noteLabel'), required: true }}
          busy={endShift.isPending}
          error={endShift.isError ? errorText(endShift.error) : null}
          onClose={() => setEnding(null)}
          onConfirm={(note) =>
            endShift.mutate({ id: ending.id, handoverNote: note ?? 'Ended by supervisor' })
          }
        />
      ) : null}
    </>
  );
}
