'use client';

import { type ApiRow, unwrap } from '@safezone/api-client';
import { formatDate, type MessageKey, t } from '@safezone/i18n';
import {
  ActionButton,
  type Column,
  ConfirmDialog,
  DataTable,
  Dialog,
  FormError,
  InputField,
  PageHeader,
  SelectField,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorText } from '../../lib/errors';
import { api } from '../../lib/session';
import { useVendor } from './vendor-context';

type Member = ApiRow<'/v1/vendors/{vendorId}/members', 'get'>;
type AssignableRole = 'vendor_administrator' | 'vendor_employee' | 'vendor_service_personnel';
const ROLES: AssignableRole[] = [
  'vendor_administrator',
  'vendor_employee',
  'vendor_service_personnel',
];
const roleOptions = ROLES.map((value) => ({
  value,
  label: t(`vendor.role.${value}` as MessageKey),
}));

function AddMemberDialog({ onClose }: { onClose: () => void }) {
  const { vendorId } = useVendor();
  const queryClient = useQueryClient();
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<AssignableRole>('vendor_employee');
  const add = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/vendors/{vendorId}/members', {
          params: { path: { vendorId } },
          body: { phone: phone.trim(), role },
        }),
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(['vendor', vendorId, 'members'], data);
      onClose();
    },
  });
  return (
    <Dialog
      title={t('vendor.team.add')}
      onClose={onClose}
      onSubmit={() => {
        if (phone.trim()) add.mutate();
      }}
      actions={
        <>
          <ActionButton variant="text" onClick={onClose}>
            {t('common.cancel')}
          </ActionButton>
          <ActionButton type="submit" busy={add.isPending} disabled={!phone.trim()}>
            {t('vendor.team.add')}
          </ActionButton>
        </>
      }
    >
      <div className="sz-form">
        <InputField
          label={t('vendor.team.phone')}
          type="tel"
          value={phone}
          onChange={setPhone}
          inputMode="tel"
          maxLength={20}
          autoFocus
        />
        <SelectField
          label={t('vendor.team.role')}
          value={role}
          onChange={setRole}
          options={roleOptions}
        />
        <FormError message={add.isError ? errorText(add.error) : null} />
      </div>
    </Dialog>
  );
}

/** Team (public-web.md §8: Staff). The owner's row cannot be changed. */
export function TeamScreen() {
  const { vendorId } = useVendor();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);
  const key = ['vendor', vendorId, 'members'];
  const members = useQuery({
    queryKey: key,
    queryFn: () =>
      unwrap(api.GET('/v1/vendors/{vendorId}/members', { params: { path: { vendorId } } })),
  });
  const change = useMutation({
    mutationFn: ({ id, role }: { id: string; role: AssignableRole }) =>
      unwrap(
        api.PATCH('/v1/vendors/{vendorId}/members/{id}', {
          params: { path: { vendorId, id } },
          body: { role },
        }),
      ),
    onSuccess: (data) => queryClient.setQueryData(key, data),
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.DELETE('/v1/vendors/{vendorId}/members/{id}', { params: { path: { vendorId, id } } }),
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(key, data);
      setRemoving(null);
    },
  });
  const columns: Column<Member>[] = [
    {
      key: 'name',
      header: t('vendor.team.col.name'),
      render: (m) => <strong>{m.displayName ?? t('vendor.team.noName')}</strong>,
    },
    {
      key: 'role',
      header: t('vendor.team.col.role'),
      render: (m) =>
        m.role === 'vendor_owner' ? (
          t('vendor.role.vendor_owner')
        ) : (
          <SelectField
            label={t('vendor.team.role')}
            value={m.role as AssignableRole}
            onChange={(role) => change.mutate({ id: m.id, role })}
            options={roleOptions}
          />
        ),
    },
    { key: 'since', header: t('vendor.team.col.since'), render: (m) => formatDate(m.createdAt) },
    {
      key: 'actions',
      header: t('common.actions'),
      align: 'right',
      render: (m) =>
        m.role === 'vendor_owner' ? null : (
          <ActionButton variant="text" size="sm" onClick={() => setRemoving(m)}>
            {t('vendor.team.remove')}
          </ActionButton>
        ),
    },
  ];
  return (
    <>
      <PageHeader
        title={t('vendor.team.title')}
        description={t('vendor.team.description')}
        actions={
          <ActionButton icon="plus" onClick={() => setAdding(true)}>
            {t('vendor.team.add')}
          </ActionButton>
        }
      />
      <FormError message={change.isError ? errorText(change.error) : null} />
      <DataTable
        caption={t('vendor.team.title')}
        columns={columns}
        rows={members.data}
        rowKey={(m) => m.id}
        loading={members.isPending}
        error={members.isError ? errorText(members.error) : null}
        onRetry={() => void members.refetch()}
      />
      {adding ? <AddMemberDialog onClose={() => setAdding(false)} /> : null}
      {removing ? (
        <ConfirmDialog
          title={t('vendor.team.removeTitle', {
            name: removing.displayName ?? t('vendor.team.noName'),
          })}
          body={t('vendor.team.removeBody')}
          confirmLabel={t('vendor.team.remove')}
          destructive
          busy={remove.isPending}
          error={remove.isError ? errorText(remove.error) : null}
          onConfirm={() => remove.mutate(removing.id)}
          onClose={() => setRemoving(null)}
        />
      ) : null}
    </>
  );
}
