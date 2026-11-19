'use client';

import { type ApiRow, unwrap } from '@safezone/api-client';
import { formatDate, formatTime, type MessageKey, t } from '@safezone/i18n';
import {
  ActionButton,
  type Column,
  ConfirmDialog,
  DataTable,
  PageHeader,
  StatusPill,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useEstate } from '../../../lib/estate';
import { errorText } from '../../../lib/errors';
import { api } from '../../../lib/session';

type Guard = ApiRow<'/v1/estates/{estateId}/guards', 'get'>;

function roleText(role: string): string {
  const key = `role.${role}` as MessageKey;
  const text = t(key);
  return text === key ? role : text;
}

/**
 * Guards and their gate PINs (ADR-0017 point 2). Guards set their own PIN in the Security App; a
 * supervisor resets a locked or forgotten one, which also signs them out of any gate phone.
 */
export function GuardsScreen() {
  const { estateId } = useEstate();
  const queryClient = useQueryClient();
  const [resetting, setResetting] = useState<Guard | null>(null);
  const guards = useQuery({
    queryKey: ['estate', estateId, 'guards'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/guards', { params: { path: { estateId } } })),
  });
  const reset = useMutation({
    mutationFn: (guard: Guard) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/guards/{id}/pin-reset', {
          params: { path: { estateId, id: guard.userId } },
        }),
      ),
    onSuccess: () => {
      setResetting(null);
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'guards'] });
    },
  });

  const nameOf = (guard: Guard) => guard.fullName ?? t('guards.unnamed');

  const columns: Column<Guard>[] = [
    { key: 'name', header: t('guards.col.name'), render: (row) => <strong>{nameOf(row)}</strong> },
    { key: 'phone', header: t('guards.col.phone'), render: (row) => row.phone },
    {
      key: 'role',
      header: t('guards.col.role'),
      render: (row) => row.roles.map(roleText).join(', '),
    },
    {
      key: 'pin',
      header: t('guards.col.pin'),
      render: (row) =>
        row.locked ? (
          <StatusPill tone="danger" label={t('guards.pin.locked')} />
        ) : row.pinSet && row.pinSetAt ? (
          <StatusPill
            tone="success"
            label={t('guards.pin.set', { date: formatDate(row.pinSetAt) })}
          />
        ) : (
          <StatusPill tone="neutral" label={t('guards.pin.none')} />
        ),
    },
    {
      key: 'shift',
      header: t('guards.col.shift'),
      render: (row) =>
        row.openShift
          ? t('guards.shift.at', {
              gate: row.openShift.gateName ?? '',
              time: formatTime(row.openShift.startedAt),
            })
          : t('guards.shift.none'),
    },
    {
      key: 'actions',
      header: t('common.actions'),
      align: 'right',
      render: (row) =>
        row.pinSet ? (
          <ActionButton variant="text" size="sm" onClick={() => setResetting(row)}>
            {t('guards.resetPin')}
          </ActionButton>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader title={t('guards.title')} description={t('guards.description')} />
      <DataTable
        caption={t('guards.title')}
        columns={columns}
        rows={guards.data}
        rowKey={(row) => row.userId}
        loading={guards.isPending}
        error={guards.isError ? errorText(guards.error) : null}
        onRetry={() => void guards.refetch()}
        empty={{ icon: 'shield', title: t('guards.empty.title'), body: t('guards.empty.body') }}
      />
      {resetting ? (
        <ConfirmDialog
          title={t('guards.resetConfirm.title', { name: nameOf(resetting) })}
          body={t('guards.resetConfirm.body')}
          confirmLabel={t('guards.resetPin')}
          cancelLabel={t('guards.resetConfirm.keep')}
          destructive
          busy={reset.isPending}
          error={reset.isError ? errorText(reset.error) : null}
          onConfirm={() => reset.mutate(resetting)}
          onClose={() => setResetting(null)}
        />
      ) : null}
    </>
  );
}
