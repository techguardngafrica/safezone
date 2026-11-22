'use client';

import { type ApiRow, unwrap } from '@safezone/api-client';
import { formatDate, type MessageKey, t } from '@safezone/i18n';
import {
  ActionButton,
  ConfirmDialog,
  DataTable,
  Dialog,
  EmptyState,
  FormError,
  InputField,
  PageHeader,
  SelectField,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorText } from '../../lib/errors';
import { api } from '../../lib/session';
import { useAdvertiser } from './advertiser-shell';

type Member = ApiRow<'/v1/advertisers/{advertiserId}/members', 'get'>;
type Role = Member['role'];
const ROLES: Role[] = [
  'advertiser_account_manager',
  'advertising_agency_representative',
  'advertiser_organisation_owner',
];

export function TeamScreen() {
  const qc = useQueryClient();
  const { advertiserId, can } = useAdvertiser();
  const allowed = can('advertiser.team.manage');
  const key = ['advertiser', advertiserId, 'members'];
  const [adding, setAdding] = useState(false);
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<Role>('advertiser_account_manager');
  const [removing, setRemoving] = useState<Member | null>(null);
  const members = useQuery({
    queryKey: key,
    queryFn: () =>
      unwrap(
        api.GET('/v1/advertisers/{advertiserId}/members', { params: { path: { advertiserId } } }),
      ),
  });
  const add = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/advertisers/{advertiserId}/members', {
          params: { path: { advertiserId } },
          body: { phone: phone.trim(), role },
        }),
      ),
    onSuccess: (data) => {
      qc.setQueryData(key, data);
      setAdding(false);
      setPhone('');
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.DELETE('/v1/advertisers/{advertiserId}/members/{id}', {
          params: { path: { advertiserId, id } },
        }),
      ),
    onSuccess: (data) => {
      qc.setQueryData(key, data);
      setRemoving(null);
    },
  });
  const roleLabel = (r: Role) => t(`advertiser.role.${r}` as MessageKey);
  if (!allowed) return <EmptyState icon="ban" title={t('vendor.noAccess')} />;
  return (
    <>
      <PageHeader
        title={t('advertiser.team.title')}
        description={t('advertiser.team.description')}
        actions={
          <ActionButton icon="plus" onClick={() => setAdding(true)}>
            {t('advertiser.team.add')}
          </ActionButton>
        }
      />
      <DataTable
        caption={t('advertiser.team.title')}
        rows={members.data}
        rowKey={(row) => row.id}
        loading={members.isPending}
        error={members.isError ? errorText(members.error) : null}
        onRetry={() => void members.refetch()}
        columns={[
          {
            key: 'name',
            header: t('vendor.team.col.name'),
            render: (row) => <strong>{row.displayName ?? t('advertiser.team.noName')}</strong>,
          },
          { key: 'role', header: t('advertiser.team.role'), render: (row) => roleLabel(row.role) },
          {
            key: 'since',
            header: t('vendor.team.col.since'),
            render: (row) => formatDate(row.createdAt),
          },
          {
            key: 'actions',
            header: t('common.actions'),
            align: 'right',
            render: (row) => (
              <ActionButton size="sm" variant="text" onClick={() => setRemoving(row)}>
                {t('advertiser.team.remove')}
              </ActionButton>
            ),
          },
        ]}
      />
      {adding ? (
        <Dialog
          title={t('advertiser.team.add')}
          onClose={() => setAdding(false)}
          onSubmit={() => {
            if (phone.trim()) add.mutate();
          }}
          actions={
            <>
              <ActionButton variant="text" onClick={() => setAdding(false)}>
                {t('common.cancel')}
              </ActionButton>
              <ActionButton type="submit" busy={add.isPending} disabled={!phone.trim()}>
                {t('advertiser.team.add')}
              </ActionButton>
            </>
          }
        >
          <div className="sz-form">
            <InputField
              label={t('advertiser.team.phone')}
              type="tel"
              value={phone}
              onChange={setPhone}
              maxLength={20}
              autoFocus
            />
            <SelectField
              label={t('advertiser.team.role')}
              value={role}
              onChange={setRole}
              options={ROLES.map((value) => ({ value, label: roleLabel(value) }))}
            />
            <FormError message={add.isError ? errorText(add.error) : null} />
          </div>
        </Dialog>
      ) : null}
      {removing ? (
        <ConfirmDialog
          title={t('advertiser.team.removeTitle', {
            name: removing.displayName ?? t('advertiser.team.noName'),
          })}
          body={t('advertiser.team.removeBody')}
          confirmLabel={t('advertiser.team.remove')}
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
