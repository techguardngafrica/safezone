'use client';

import { type ApiRow, unwrap, unwrapPage } from '@safezone/api-client';
import { formatDate, formatDateTime, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  type Column,
  ConfirmDialog,
  DataTable,
  Dialog,
  Drawer,
  FormError,
  InputField,
  PageHeader,
  SelectField,
  StatusPill,
  Toolbar,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useEstate } from '../../../lib/estate';
import { errorText, formErrors } from '../../../lib/errors';
import { usePaged } from '../../../lib/paged';
import { api } from '../../../lib/session';

type StaffRow = ApiRow<'/v1/estates/{estateId}/staff', 'get'>;

function toWatEndOfDay(date: string): string | undefined {
  if (!date) return undefined;
  return new Date(`${date}T23:59:59.000+01:00`).toISOString();
}

export function StaffScreen() {
  const { estateId } = useEstate();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | 'active' | 'suspended'>('');
  const [inviting, setInviting] = useState(false);
  const [managing, setManaging] = useState<StaffRow | null>(null);
  const [statusTarget, setStatusTarget] = useState<{
    row: StaffRow;
    next: 'active' | 'suspended';
  } | null>(null);

  // Invite form
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [roleKey, setRoleKey] = useState('estate_manager');
  const [validToDate, setValidToDate] = useState('');

  // Assign role drawer form
  const [addRoleKey, setAddRoleKey] = useState('');
  const [addRoleValidTo, setAddRoleValidTo] = useState('');

  const roles = useQuery({
    queryKey: ['estate', estateId, 'roles'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/roles', { params: { path: { estateId } } })),
  });

  const list = usePaged<StaffRow>(['estate', estateId, 'staff', search, status], (cursor) =>
    unwrapPage(
      api.GET('/v1/estates/{estateId}/staff', {
        params: {
          path: { estateId },
          query: {
            q: search.trim() || undefined,
            status: status || undefined,
            limit: 50,
            cursor,
          },
        },
      }),
    ),
  );

  const assignableRoles = (roles.data ?? []).filter(
    (r) => r.key !== 'resident' && r.key !== 'owner' && r.key !== 'household_member',
  );

  const invite = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/staff/invite', {
          params: { path: { estateId } },
          body: {
            fullName: fullName.trim(),
            phone: phone.trim(),
            email: email.trim() || undefined,
            roleKeys: [roleKey],
            validTo: toWatEndOfDay(validToDate),
          },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'staff'] });
      setInviting(false);
      setFullName('');
      setPhone('');
      setEmail('');
      setValidToDate('');
    },
  });

  const assignRole = useMutation({
    mutationFn: () => {
      if (!managing) throw new Error(t('mw.staff.errNoStaffSelected'));
      return unwrap(
        api.POST('/v1/estates/{estateId}/staff/{userId}/roles', {
          params: { path: { estateId, userId: managing.userId } },
          body: { roleKey: addRoleKey, validTo: toWatEndOfDay(addRoleValidTo) },
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'staff'] });
      setAddRoleKey('');
      setAddRoleValidTo('');
      setManaging(null);
    },
  });

  const revokeRole = useMutation({
    mutationFn: ({ userId, assignmentId }: { userId: string; assignmentId: string }) =>
      unwrap(
        api.DELETE('/v1/estates/{estateId}/staff/{userId}/roles/{assignmentId}', {
          params: { path: { estateId, userId, assignmentId } },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'staff'] });
      setManaging(null);
    },
  });

  const updateStatus = useMutation({
    mutationFn: ({
      userId,
      next,
      reason,
    }: {
      userId: string;
      next: 'active' | 'suspended';
      reason: string;
    }) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/staff/{userId}/status', {
          params: { path: { estateId, userId } },
          body: { status: next, reason },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'staff'] });
      setStatusTarget(null);
    },
  });

  const inviteErr = invite.isError
    ? formErrors(invite.error, {
        fullName: 'fullName',
        phone: 'phone',
        email: 'email',
        roleKeys: 'roleKey',
      })
    : null;

  const columns: Column<StaffRow>[] = [
    {
      key: 'name',
      header: t('staff.col.name'),
      render: (row) => (
        <div>
          <div style={{ fontWeight: 600 }}>{row.fullName ?? '-'}</div>
          {row.email ? (
            <div className="sz-muted" style={{ fontSize: 13 }}>
              {row.email}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'phone',
      header: t('staff.col.phone'),
      render: (row) => <span className="sz-num">{row.phone}</span>,
    },
    {
      key: 'roles',
      header: t('staff.col.roles'),
      render: (row) => (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {row.assignments.map((a) => (
            <StatusPill
              key={a.id}
              tone={a.validTo ? 'info' : 'neutral'}
              label={a.validTo ? `${a.roleName} (${formatDate(a.validTo)})` : a.roleName}
            />
          ))}
        </div>
      ),
    },
    {
      key: 'status',
      header: t('staff.col.status'),
      render: (row) => (
        <StatusPill tone={row.status === 'active' ? 'success' : 'warning'} label={row.status} />
      ),
    },
    {
      key: 'joined',
      header: t('staff.col.joined'),
      render: (row) => <span className="sz-num">{formatDate(row.joinedAt)}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <ActionButton
            variant="outline"
            size="sm"
            onClick={() => {
              assignRole.reset();
              revokeRole.reset();
              setAddRoleKey(assignableRoles[0]?.key ?? '');
              setAddRoleValidTo('');
              setManaging(row);
            }}
          >
            {t('staff.manageRoles')}
          </ActionButton>
          {row.status === 'active' ? (
            <ActionButton
              variant="danger"
              size="sm"
              onClick={() => {
                updateStatus.reset();
                setStatusTarget({ row, next: 'suspended' });
              }}
            >
              {t('staff.suspend')}
            </ActionButton>
          ) : (
            <ActionButton
              variant="secondary"
              size="sm"
              onClick={() => {
                updateStatus.reset();
                setStatusTarget({ row, next: 'active' });
              }}
            >
              {t('staff.reactivate')}
            </ActionButton>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('staff.title')}
        description={t('staff.description')}
        actions={
          <ActionButton
            icon="userPlus"
            onClick={() => {
              invite.reset();
              setInviting(true);
            }}
          >
            {t('staff.invite')}
          </ActionButton>
        }
      />

      <Toolbar>
        <InputField
          label={t('common.search')}
          placeholder={t('staff.search')}
          value={search}
          onChange={setSearch}
        />
        <SelectField
          label={t('staff.filter.status')}
          value={status}
          onChange={setStatus}
          options={[
            { value: '', label: t('staff.filter.all') },
            { value: 'active', label: t('staff.filter.active') },
            { value: 'suspended', label: t('staff.filter.suspended') },
          ]}
        />
      </Toolbar>

      <DataTable
        caption={t('staff.title')}
        columns={columns}
        rows={list.rows}
        rowKey={(row) => row.userId}
        loading={list.loading}
        error={list.error ? errorText(list.error) : null}
        onRetry={() => void list.refetch()}
        hasMore={list.hasMore}
        loadingMore={list.loadingMore}
        onLoadMore={list.loadMore}
        empty={{
          icon: 'users',
          title: t('staff.empty.title'),
          body: t('staff.empty.body'),
        }}
      />

      {inviting ? (
        <Dialog
          title={t('staff.invite')}
          onClose={() => setInviting(false)}
          onSubmit={() => invite.mutate()}
          actions={
            <>
              <ActionButton variant="outline" type="button" onClick={() => setInviting(false)}>
                {t('common.cancel')}
              </ActionButton>
              <ActionButton type="submit" busy={invite.isPending}>
                {t('staff.invite')}
              </ActionButton>
            </>
          }
        >
          <FormError message={inviteErr?.other.join(' ')} />
          <div className="sz-form">
            <InputField
              label={t('staff.field.fullName')}
              required
              value={fullName}
              onChange={setFullName}
              error={inviteErr?.fields.fullName}
            />
            <div className="sz-form-2">
              <InputField
                label={t('staff.field.phone')}
                required
                placeholder="+2348012345678"
                value={phone}
                onChange={setPhone}
                error={inviteErr?.fields.phone}
              />
              <InputField
                label={t('staff.field.email')}
                type="email"
                value={email}
                onChange={setEmail}
                error={inviteErr?.fields.email}
              />
            </div>
            <SelectField
              label={t('staff.field.role')}
              value={roleKey}
              onChange={setRoleKey}
              options={assignableRoles.map((role) => ({ value: role.key, label: role.name }))}
            />
            <InputField
              label={t('staff.field.validTo')}
              type="date"
              value={validToDate}
              onChange={setValidToDate}
            />
          </div>
        </Dialog>
      ) : null}

      {managing ? (
        <Drawer
          title={`${managing.fullName ?? managing.phone} - ${t('staff.manageRoles')}`}
          onClose={() => setManaging(null)}
        >
          <div style={{ display: 'grid', gap: 20 }}>
            {assignRole.isError ? (
              <Banner tone="danger">{errorText(assignRole.error)}</Banner>
            ) : null}
            {revokeRole.isError ? (
              <Banner tone="danger">{errorText(revokeRole.error)}</Banner>
            ) : null}

            <div style={{ display: 'grid', gap: 10 }}>
              {managing.assignments.map((assignment) => (
                <div
                  key={assignment.id}
                  className="sz-card"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: 12,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>{assignment.roleName}</div>
                    <div className="sz-muted" style={{ fontSize: 13 }}>
                      {assignment.validTo
                        ? t('mw.staff.expiresAt', { date: formatDateTime(assignment.validTo) })
                        : t('mw.staff.permanent')}
                    </div>
                  </div>
                  <ActionButton
                    variant="danger"
                    size="sm"
                    busy={revokeRole.isPending}
                    onClick={() =>
                      revokeRole.mutate({ userId: managing.userId, assignmentId: assignment.id })
                    }
                  >
                    {t('staff.revokeRole')}
                  </ActionButton>
                </div>
              ))}
            </div>

            <form
              className="sz-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (addRoleKey) assignRole.mutate();
              }}
            >
              <SelectField
                label={t('staff.assignRole')}
                value={addRoleKey}
                onChange={setAddRoleKey}
                options={assignableRoles.map((role) => ({ value: role.key, label: role.name }))}
              />
              <InputField
                label={t('staff.field.validTo')}
                type="date"
                value={addRoleValidTo}
                onChange={setAddRoleValidTo}
              />
              <div>
                <ActionButton
                  type="submit"
                  size="sm"
                  disabled={!addRoleKey}
                  busy={assignRole.isPending}
                >
                  {t('staff.assignRole')}
                </ActionButton>
              </div>
            </form>
          </div>
        </Drawer>
      ) : null}

      {statusTarget ? (
        <ConfirmDialog
          title={
            statusTarget.next === 'suspended' ? t('staff.suspendTitle') : t('staff.reactivateTitle')
          }
          body={
            statusTarget.next === 'suspended' ? t('staff.suspendBody') : t('staff.reactivateBody')
          }
          confirmLabel={
            statusTarget.next === 'suspended' ? t('staff.suspend') : t('staff.reactivate')
          }
          destructive={statusTarget.next === 'suspended'}
          reason={{ label: t('staff.statusReason'), required: true }}
          busy={updateStatus.isPending}
          error={updateStatus.isError ? errorText(updateStatus.error) : null}
          onClose={() => setStatusTarget(null)}
          onConfirm={(reason) =>
            updateStatus.mutate({
              userId: statusTarget.row.userId,
              next: statusTarget.next,
              reason: reason ?? '',
            })
          }
        />
      ) : null}
    </>
  );
}
