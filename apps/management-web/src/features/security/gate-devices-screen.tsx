'use client';

import { type ApiRow, unwrap } from '@safezone/api-client';
import { formatDateTime, t } from '@safezone/i18n';
import {
  ActionButton,
  type Column,
  ConfirmDialog,
  DataTable,
  FormError,
  PageHeader,
  StatusPill,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useEstate } from '../../../lib/estate';
import { errorText } from '../../../lib/errors';
import { api } from '../../../lib/session';

type Device = ApiRow<'/v1/estates/{estateId}/gate-devices', 'get'>;

/**
 * Shared gate phones (ADR-0017). Registration happens on the phone itself (Security App, Gate settings);
 * here supervisors see the fleet and deregister a lost or stolen phone, which signs its guards out.
 */
export function GateDevicesScreen() {
  const { estateId } = useEstate();
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState<Device | null>(null);
  const devices = useQuery({
    queryKey: ['estate', estateId, 'gate-devices'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/gate-devices', { params: { path: { estateId } } })),
  });
  const deregister = useMutation({
    mutationFn: (device: Device) =>
      unwrap(
        api.DELETE('/v1/estates/{estateId}/gate-devices/{id}', {
          params: { path: { estateId, id: device.id } },
        }),
      ),
    onSuccess: () => {
      setRemoving(null);
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'gate-devices'] });
    },
  });

  const columns: Column<Device>[] = [
    { key: 'name', header: t('devices.col.name'), render: (row) => <strong>{row.name}</strong> },
    { key: 'gate', header: t('devices.col.gate'), render: (row) => row.gateName ?? '' },
    {
      key: 'status',
      header: t('devices.col.status'),
      render: (row) => (
        <StatusPill
          tone={row.status === 'active' ? 'success' : 'neutral'}
          label={t(`devices.status.${row.status}`)}
        />
      ),
    },
    {
      key: 'lastSeen',
      header: t('devices.col.lastSeen'),
      render: (row) => (row.lastSeenAt ? formatDateTime(row.lastSeenAt) : t('devices.never')),
    },
    {
      key: 'registered',
      header: t('devices.col.registered'),
      render: (row) => formatDateTime(row.createdAt),
    },
    {
      key: 'actions',
      header: t('common.actions'),
      align: 'right',
      render: (row) =>
        row.status === 'active' ? (
          <ActionButton variant="text" size="sm" onClick={() => setRemoving(row)}>
            {t('devices.deregister')}
          </ActionButton>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader title={t('devices.title')} description={t('devices.description')} />
      <DataTable
        caption={t('devices.title')}
        columns={columns}
        rows={devices.data}
        rowKey={(row) => row.id}
        loading={devices.isPending}
        error={devices.isError ? errorText(devices.error) : null}
        onRetry={() => void devices.refetch()}
        empty={{
          icon: 'smartphone',
          title: t('devices.empty.title'),
          body: t('devices.empty.body'),
        }}
      />
      {removing ? (
        <ConfirmDialog
          title={t('devices.deregisterConfirm.title', { name: removing.name })}
          body={t('devices.deregisterConfirm.body')}
          confirmLabel={t('devices.deregister')}
          cancelLabel={t('devices.deregisterConfirm.keep')}
          destructive
          busy={deregister.isPending}
          error={deregister.isError ? errorText(deregister.error) : null}
          onConfirm={() => deregister.mutate(removing)}
          onClose={() => setRemoving(null)}
        />
      ) : null}
      {deregister.isError && !removing ? <FormError message={errorText(deregister.error)} /> : null}
    </>
  );
}
