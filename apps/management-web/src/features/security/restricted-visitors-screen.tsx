'use client';

import { type ApiRow, unwrap } from '@safezone/api-client';
import { formatDateTime, t } from '@safezone/i18n';
import {
  ActionButton,
  type Column,
  ConfirmDialog,
  DataTable,
  Dialog,
  FormError,
  InputField,
  PageHeader,
  TextAreaField,
  Toolbar,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useEstate } from '../../../lib/estate';
import { errorText, formErrors } from '../../../lib/errors';
import { api } from '../../../lib/session';

type RestrictedVisitor = ApiRow<'/v1/estates/{estateId}/restricted-visitors', 'get'>;

function toWatEndOfDayIso(date: string): string | undefined {
  if (!date) return undefined;
  return new Date(`${date}T23:59:59.000+01:00`).toISOString();
}

function toDateInput(iso: string | null): string {
  if (!iso) return '';
  return iso.slice(0, 10);
}

export function RestrictedVisitorsScreen() {
  const { estateId, can } = useEstate();
  const queryClient = useQueryClient();
  const canManage = can('security.staff.manage');
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<RestrictedVisitor | null>(null);
  const [removing, setRemoving] = useState<RestrictedVisitor | null>(null);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [plate, setPlate] = useState('');
  const [reason, setReason] = useState('');
  const [expiresDate, setExpiresDate] = useState('');

  const list = useQuery({
    queryKey: ['estate', estateId, 'restricted-visitors'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/restricted-visitors', {
          params: { path: { estateId } },
        }),
      ),
  });

  const add = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/restricted-visitors', {
          params: { path: { estateId } },
          body: {
            name: name.trim() || undefined,
            phone: phone.trim() || undefined,
            plate: plate.trim() || undefined,
            reason: reason.trim(),
            expiresAt: toWatEndOfDayIso(expiresDate),
          },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'restricted-visitors'] });
      setAdding(false);
      setName('');
      setPhone('');
      setPlate('');
      setReason('');
      setExpiresDate('');
    },
  });

  const update = useMutation({
    mutationFn: () => {
      if (!editing) throw new Error('No entry selected');
      return unwrap(
        api.PATCH('/v1/estates/{estateId}/restricted-visitors/{id}', {
          params: { path: { estateId, id: editing.id } },
          body: {
            reason: reason.trim(),
            expiresAt: expiresDate ? toWatEndOfDayIso(expiresDate) : null,
          },
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'restricted-visitors'] });
      setEditing(null);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.DELETE('/v1/estates/{estateId}/restricted-visitors/{id}', {
          params: { path: { estateId, id } },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'restricted-visitors'] });
      setRemoving(null);
    },
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = list.data ?? [];
    if (!q) return all;
    return all.filter(
      (item) =>
        item.name?.toLowerCase().includes(q) ||
        item.phone?.toLowerCase().includes(q) ||
        item.plate?.toLowerCase().includes(q) ||
        item.reason.toLowerCase().includes(q),
    );
  }, [list.data, search]);

  const addErr = add.isError
    ? formErrors(add.error, {
        name: 'name',
        phone: 'phone',
        plate: 'plate',
        reason: 'reason',
        expiresAt: 'expiresDate',
      })
    : null;

  const editErr = update.isError
    ? formErrors(update.error, { reason: 'reason', expiresAt: 'expiresDate' })
    : null;

  const openAdd = () => {
    add.reset();
    setName('');
    setPhone('');
    setPlate('');
    setReason('');
    setExpiresDate('');
    setAdding(true);
  };

  const openEdit = (row: RestrictedVisitor) => {
    update.reset();
    setReason(row.reason);
    setExpiresDate(toDateInput(row.expiresAt));
    setEditing(row);
  };

  const columns: Column<RestrictedVisitor>[] = [
    {
      key: 'name',
      header: t('restricted.col.name'),
      render: (row) => row.name ?? <span className="sz-muted">-</span>,
    },
    {
      key: 'phone',
      header: t('restricted.col.phone'),
      render: (row) =>
        row.phone ? (
          <span className="sz-num">{row.phone}</span>
        ) : (
          <span className="sz-muted">-</span>
        ),
    },
    {
      key: 'plate',
      header: t('restricted.col.plate'),
      render: (row) =>
        row.plate ? (
          <span className="sz-num">{row.plate}</span>
        ) : (
          <span className="sz-muted">-</span>
        ),
    },
    { key: 'reason', header: t('restricted.col.reason'), render: (row) => row.reason },
    {
      key: 'expires',
      header: t('restricted.col.expires'),
      render: (row) =>
        row.expiresAt ? (
          <span className="sz-num">{formatDateTime(row.expiresAt)}</span>
        ) : (
          <span className="sz-muted">{t('restricted.neverExpires')}</span>
        ),
    },
    {
      key: 'added',
      header: t('restricted.col.added'),
      render: (row) => <span className="sz-num">{formatDateTime(row.createdAt)}</span>,
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: '',
            align: 'right' as const,
            render: (row: RestrictedVisitor) => (
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <ActionButton variant="outline" size="sm" onClick={() => openEdit(row)}>
                  {t('common.edit')}
                </ActionButton>
                <ActionButton
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    remove.reset();
                    setRemoving(row);
                  }}
                >
                  {t('restricted.remove')}
                </ActionButton>
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title={t('restricted.title')}
        description={t('restricted.description')}
        actions={
          canManage ? (
            <ActionButton icon="plus" onClick={openAdd}>
              {t('restricted.add')}
            </ActionButton>
          ) : null
        }
      />

      <Toolbar>
        <InputField
          label={t('common.search')}
          placeholder={t('restricted.search')}
          value={search}
          onChange={setSearch}
        />
      </Toolbar>

      <DataTable
        caption={t('restricted.title')}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        loading={list.isPending}
        error={list.isError ? errorText(list.error) : null}
        onRetry={() => void list.refetch()}
        empty={{
          icon: 'ban',
          title: t('restricted.empty.title'),
          body: t('restricted.empty.body'),
        }}
      />

      {adding ? (
        <Dialog
          title={t('restricted.add')}
          onClose={() => setAdding(false)}
          onSubmit={() => add.mutate()}
          actions={
            <>
              <ActionButton variant="outline" type="button" onClick={() => setAdding(false)}>
                {t('common.cancel')}
              </ActionButton>
              <ActionButton type="submit" busy={add.isPending}>
                {t('common.save')}
              </ActionButton>
            </>
          }
        >
          <p className="sz-muted" style={{ marginTop: 0, fontSize: 14 }}>
            {t('restricted.field.hint')}
          </p>
          <FormError message={addErr?.other.join(' ')} />
          <div className="sz-form">
            <InputField
              label={t('restricted.field.name')}
              value={name}
              onChange={setName}
              error={addErr?.fields.name}
            />
            <div className="sz-form-2">
              <InputField
                label={t('restricted.field.phone')}
                placeholder="+2348012345678"
                value={phone}
                onChange={setPhone}
                error={addErr?.fields.phone}
              />
              <InputField
                label={t('restricted.field.plate')}
                placeholder="ABC-123-DE"
                value={plate}
                onChange={setPlate}
                error={addErr?.fields.plate}
              />
            </div>
            <TextAreaField
              label={t('restricted.field.reason')}
              required
              rows={3}
              value={reason}
              onChange={setReason}
              error={addErr?.fields.reason}
            />
            <InputField
              label={t('restricted.field.expiresAt')}
              type="date"
              value={expiresDate}
              onChange={setExpiresDate}
              error={addErr?.fields.expiresDate}
            />
          </div>
        </Dialog>
      ) : null}

      {editing ? (
        <Dialog
          title={t('restricted.edit')}
          onClose={() => setEditing(null)}
          onSubmit={() => update.mutate()}
          actions={
            <>
              <ActionButton variant="outline" type="button" onClick={() => setEditing(null)}>
                {t('common.cancel')}
              </ActionButton>
              <ActionButton type="submit" busy={update.isPending}>
                {t('common.save')}
              </ActionButton>
            </>
          }
        >
          <FormError message={editErr?.other.join(' ')} />
          <div className="sz-form">
            <TextAreaField
              label={t('restricted.field.reason')}
              required
              rows={3}
              value={reason}
              onChange={setReason}
              error={editErr?.fields.reason}
            />
            <InputField
              label={t('restricted.field.expiresAt')}
              type="date"
              value={expiresDate}
              onChange={setExpiresDate}
              error={editErr?.fields.expiresDate}
            />
          </div>
        </Dialog>
      ) : null}

      {removing ? (
        <ConfirmDialog
          title={t('restricted.removeConfirm.title')}
          body={t('restricted.removeConfirm.body')}
          confirmLabel={t('restricted.remove')}
          destructive
          busy={remove.isPending}
          error={remove.isError ? errorText(remove.error) : null}
          onClose={() => setRemoving(null)}
          onConfirm={() => remove.mutate(removing.id)}
        />
      ) : null}
    </>
  );
}
