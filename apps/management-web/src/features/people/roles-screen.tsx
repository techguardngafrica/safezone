'use client';

import { type ApiRow, unwrap } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  CheckboxField,
  type Column,
  ConfirmDialog,
  DataTable,
  Dialog,
  FormError,
  InputField,
  PageHeader,
  StatusPill,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useEstate } from '../../../lib/estate';
import { errorText, formErrors } from '../../../lib/errors';
import { api } from '../../../lib/session';

type EstateRole = ApiRow<'/v1/estates/{estateId}/roles', 'get'>;

const DISALLOWED_PREFIXES = ['platform.', 'ad.', 'vendor.'];

export function RolesScreen() {
  const { estateId } = useEstate();
  const queryClient = useQueryClient();

  const [dialogMode, setDialogMode] = useState<'create' | 'edit' | null>(null);
  const [editing, setEditing] = useState<EstateRole | null>(null);
  const [deleting, setDeleting] = useState<EstateRole | null>(null);
  const [name, setName] = useState('');
  const [selectedPerms, setSelectedPerms] = useState<Set<string>>(new Set());

  const roles = useQuery({
    queryKey: ['estate', estateId, 'roles'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/roles', { params: { path: { estateId } } })),
  });

  const catalogue = useQuery({
    queryKey: ['permissions', 'catalogue'],
    queryFn: () => unwrap(api.GET('/v1/permissions/catalogue')),
  });

  const estatePermissions = useMemo(
    () =>
      (catalogue.data ?? []).filter(
        (item) => !DISALLOWED_PREFIXES.some((prefix) => item.key.startsWith(prefix)),
      ),
    [catalogue.data],
  );

  const create = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/roles', {
          params: { path: { estateId } },
          body: { name: name.trim(), permissions: [...selectedPerms] },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'roles'] });
      setDialogMode(null);
    },
  });

  const update = useMutation({
    mutationFn: () => {
      if (!editing?.id) throw new Error(t('mw.roles.errNoRoleSelected'));
      return unwrap(
        api.PATCH('/v1/estates/{estateId}/roles/{id}', {
          params: { path: { estateId, id: editing.id } },
          body: { name: name.trim(), permissions: [...selectedPerms] },
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'roles'] });
      setDialogMode(null);
      setEditing(null);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.DELETE('/v1/estates/{estateId}/roles/{id}', {
          params: { path: { estateId, id } },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'roles'] });
      setDeleting(null);
    },
  });

  const togglePerm = (key: string, checked: boolean) => {
    setSelectedPerms((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const activeMutation = dialogMode === 'edit' ? update : create;
  const err = activeMutation.isError
    ? formErrors(activeMutation.error, { name: 'name', permissions: 'permissions' })
    : null;

  const columns: Column<EstateRole>[] = [
    {
      key: 'name',
      header: t('roles.col.name'),
      render: (row) => (
        <div>
          <div style={{ fontWeight: 600 }}>{row.name}</div>
          <div className="sz-muted sz-num" style={{ fontSize: 12 }}>
            {row.key}
          </div>
        </div>
      ),
    },
    {
      key: 'type',
      header: t('roles.col.type'),
      render: (row) => (
        <StatusPill
          tone={row.isBuiltin ? 'neutral' : 'info'}
          label={row.isBuiltin ? t('roles.builtin') : t('roles.custom')}
        />
      ),
    },
    {
      key: 'permissions',
      header: t('roles.col.permissions'),
      render: (row) => (
        <span className="sz-muted" style={{ fontSize: 13 }}>
          {row.permissions.length} permission(s)
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) =>
        row.isBuiltin || !row.id ? null : (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <ActionButton
              variant="outline"
              size="sm"
              onClick={() => {
                update.reset();
                setEditing(row);
                setName(row.name);
                setSelectedPerms(new Set(row.permissions));
                setDialogMode('edit');
              }}
            >
              {t('common.edit')}
            </ActionButton>
            <ActionButton
              variant="danger"
              size="sm"
              onClick={() => {
                remove.reset();
                setDeleting(row);
              }}
            >
              {t('roles.delete')}
            </ActionButton>
          </div>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('roles.title')}
        description={t('roles.description')}
        actions={
          <ActionButton
            icon="plus"
            onClick={() => {
              create.reset();
              setEditing(null);
              setName('');
              setSelectedPerms(new Set());
              setDialogMode('create');
            }}
          >
            {t('roles.create')}
          </ActionButton>
        }
      />

      <DataTable
        caption={t('roles.title')}
        columns={columns}
        rows={roles.data ?? []}
        rowKey={(row) => row.key}
        loading={roles.isPending}
        error={roles.isError ? errorText(roles.error) : null}
        onRetry={() => void roles.refetch()}
        empty={{
          icon: 'key',
          title: t('roles.empty.title'),
          body: t('roles.empty.body'),
        }}
      />

      {dialogMode ? (
        <Dialog
          title={dialogMode === 'edit' ? t('roles.edit') : t('roles.create')}
          wide
          onClose={() => setDialogMode(null)}
          onSubmit={() => activeMutation.mutate()}
          actions={
            <>
              <ActionButton variant="outline" type="button" onClick={() => setDialogMode(null)}>
                {t('common.cancel')}
              </ActionButton>
              <ActionButton
                type="submit"
                disabled={!name.trim() || selectedPerms.size === 0}
                busy={activeMutation.isPending}
              >
                {t('common.save')}
              </ActionButton>
            </>
          }
        >
          <FormError message={err?.other.join(' ')} />
          <div className="sz-form">
            <InputField
              label={t('roles.field.name')}
              required
              value={name}
              onChange={setName}
              error={err?.fields.name}
            />
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>
                {t('roles.field.permissions')} ({selectedPerms.size})
              </div>
              <div
                style={{
                  display: 'grid',
                  gap: 8,
                  maxHeight: 320,
                  overflowY: 'auto',
                  padding: 4,
                }}
              >
                {estatePermissions.map((perm) => (
                  <CheckboxField
                    key={perm.key}
                    label={`${perm.key}: ${perm.description}`}
                    checked={selectedPerms.has(perm.key)}
                    onChange={(checked) => togglePerm(perm.key, checked)}
                  />
                ))}
              </div>
            </div>
          </div>
        </Dialog>
      ) : null}

      {deleting?.id ? (
        <ConfirmDialog
          title={t('roles.deleteTitle')}
          body={t('roles.deleteBody')}
          confirmLabel={t('roles.delete')}
          destructive
          busy={remove.isPending}
          error={remove.isError ? errorText(remove.error) : null}
          onClose={() => setDeleting(null)}
          onConfirm={() => remove.mutate(deleting.id!)}
        />
      ) : null}
    </>
  );
}
