'use client';

import { type ApiRow, unwrap, unwrapPage } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  type Column,
  DataTable,
  Drawer,
  InputField,
  PageHeader,
  StatusPill,
  Tabs,
  Toolbar,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useEstate } from '../../../lib/estate';
import { errorText } from '../../../lib/errors';
import { usePaged } from '../../../lib/paged';
import { api } from '../../../lib/session';

type HouseholdRow = ApiRow<'/v1/estates/{estateId}/households', 'get'>;
type DrawerTab = 'members' | 'vehicles' | 'staff';

export function HouseholdsScreen() {
  const { estateId } = useEstate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<HouseholdRow | null>(null);
  const [tab, setTab] = useState<DrawerTab>('members');

  const list = usePaged<HouseholdRow>(['estate', estateId, 'households', search], (cursor) =>
    unwrapPage(
      api.GET('/v1/estates/{estateId}/households', {
        params: {
          path: { estateId },
          query: { q: search.trim() || undefined, limit: 50, cursor },
        },
      }),
    ),
  );

  const detail = useQuery({
    queryKey: ['estate', estateId, 'households', 'detail', selected?.id],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/households/{id}', {
          params: { path: { estateId, id: selected!.id } },
        }),
      ),
    enabled: Boolean(selected),
  });

  const vehicles = useQuery({
    queryKey: ['estate', estateId, 'vehicles', selected?.id],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/vehicles', {
          params: { path: { estateId }, query: { householdId: selected!.id } },
        }),
      ),
    enabled: Boolean(selected) && tab === 'vehicles',
  });

  const domesticStaff = useQuery({
    queryKey: ['estate', estateId, 'domestic-staff', selected?.id],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/domestic-staff', {
          params: { path: { estateId }, query: { householdId: selected!.id } },
        }),
      ),
    enabled: Boolean(selected) && tab === 'staff',
  });

  const deactivateVehicle = useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/vehicles/{id}/deactivate', {
          params: { path: { estateId, id } },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['estate', estateId, 'vehicles', selected?.id],
      });
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'households'] });
    },
  });

  const setStaffStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' | 'suspended' | 'ended' }) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/domestic-staff/{id}/status', {
          params: { path: { estateId, id } },
          body: { status },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['estate', estateId, 'domestic-staff', selected?.id],
      });
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'households'] });
    },
  });

  const columns: Column<HouseholdRow>[] = [
    {
      key: 'name',
      header: t('household.col.name'),
      render: (row) => (
        <button
          type="button"
          className="sz-btn sz-btn-text"
          style={{ padding: 0, fontWeight: 600 }}
          onClick={() => {
            setTab('members');
            setSelected(row);
          }}
        >
          {row.name}
        </button>
      ),
    },
    {
      key: 'unit',
      header: t('household.col.unit'),
      render: (row) => row.unitCode ?? <span className="sz-muted">-</span>,
    },
    {
      key: 'type',
      header: t('household.col.type'),
      render: (row) => <StatusPill tone="neutral" label={row.occupancyType} />,
    },
    {
      key: 'members',
      header: t('household.col.members'),
      align: 'right',
      render: (row) => <span className="sz-num">{row.memberCount}</span>,
    },
    {
      key: 'vehicles',
      header: t('household.col.vehicles'),
      align: 'right',
      render: (row) => <span className="sz-num">{row.vehicleCount}</span>,
    },
    {
      key: 'staff',
      header: t('household.col.staff'),
      align: 'right',
      render: (row) => <span className="sz-num">{row.domesticStaffCount}</span>,
    },
  ];

  return (
    <>
      <PageHeader title={t('household.title')} description={t('household.description')} />

      <Toolbar>
        <InputField
          label={t('common.search')}
          placeholder={t('household.search')}
          value={search}
          onChange={setSearch}
        />
      </Toolbar>

      <DataTable
        caption={t('household.title')}
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
          icon: 'home',
          title: t('household.empty.title'),
          body: t('household.empty.body'),
        }}
      />

      {selected ? (
        <Drawer
          title={`${selected.name}${selected.unitCode ? ` (${selected.unitCode})` : ''}`}
          onClose={() => setSelected(null)}
        >
          <div style={{ display: 'grid', gap: 16 }}>
            <Tabs<DrawerTab>
              label={t('household.title')}
              value={tab}
              onChange={setTab}
              tabs={[
                { key: 'members', label: t('household.tab.members') },
                { key: 'vehicles', label: t('household.tab.vehicles') },
                { key: 'staff', label: t('household.tab.staff') },
              ]}
            />

            {tab === 'members' ? (
              detail.isError ? (
                <Banner tone="danger">{errorText(detail.error)}</Banner>
              ) : (
                <DataTable
                  caption={t('household.tab.members')}
                  loading={detail.isPending}
                  rows={detail.data?.members ?? []}
                  rowKey={(row) => row.id}
                  columns={[
                    { key: 'name', header: t('household.member.name'), render: (r) => r.fullName },
                    {
                      key: 'rel',
                      header: t('household.member.relationship'),
                      render: (r) => r.relationship,
                    },
                    {
                      key: 'minor',
                      header: t('staff.col.status'),
                      render: (r) => (
                        <StatusPill
                          tone={r.isMinor ? 'info' : 'success'}
                          label={r.isMinor ? 'Minor' : 'Adult'}
                        />
                      ),
                    },
                  ]}
                  empty={{ icon: 'users', title: t('household.tab.members'), body: '-' }}
                />
              )
            ) : null}

            {tab === 'vehicles' ? (
              <DataTable
                caption={t('household.tab.vehicles')}
                loading={vehicles.isPending}
                error={vehicles.isError ? errorText(vehicles.error) : null}
                rows={vehicles.data ?? []}
                rowKey={(row) => row.id}
                columns={[
                  {
                    key: 'plate',
                    header: t('household.vehicle.plate'),
                    render: (r) => <span className="sz-num">{r.plate}</span>,
                  },
                  {
                    key: 'desc',
                    header: t('household.vehicle.make'),
                    render: (r) => [r.make, r.model, r.colour].filter(Boolean).join(' ') || '-',
                  },
                  {
                    key: 'status',
                    header: t('staff.col.status'),
                    render: (r) => (
                      <StatusPill
                        tone={r.status === 'active' ? 'success' : 'neutral'}
                        label={r.status}
                      />
                    ),
                  },
                  {
                    key: 'actions',
                    header: '',
                    align: 'right',
                    render: (r) =>
                      r.status === 'active' ? (
                        <ActionButton
                          variant="outline"
                          size="sm"
                          busy={deactivateVehicle.isPending}
                          onClick={() => deactivateVehicle.mutate(r.id)}
                        >
                          {t('household.vehicle.deactivate')}
                        </ActionButton>
                      ) : null,
                  },
                ]}
                empty={{ icon: 'door', title: t('household.tab.vehicles'), body: '-' }}
              />
            ) : null}

            {tab === 'staff' ? (
              <DataTable
                caption={t('household.tab.staff')}
                loading={domesticStaff.isPending}
                error={domesticStaff.isError ? errorText(domesticStaff.error) : null}
                rows={domesticStaff.data ?? []}
                rowKey={(row) => row.id}
                columns={[
                  { key: 'name', header: t('staff.col.name'), render: (r) => r.name },
                  { key: 'role', header: t('household.staff.role'), render: (r) => r.role },
                  {
                    key: 'status',
                    header: t('staff.col.status'),
                    render: (r) => (
                      <StatusPill
                        tone={
                          r.status === 'active'
                            ? 'success'
                            : r.status === 'suspended'
                              ? 'warning'
                              : 'neutral'
                        }
                        label={r.status}
                      />
                    ),
                  },
                  {
                    key: 'actions',
                    header: '',
                    align: 'right',
                    render: (r) =>
                      r.status === 'active' ? (
                        <ActionButton
                          variant="outline"
                          size="sm"
                          busy={setStaffStatus.isPending}
                          onClick={() => setStaffStatus.mutate({ id: r.id, status: 'suspended' })}
                        >
                          {t('household.staff.suspend')}
                        </ActionButton>
                      ) : r.status === 'suspended' ? (
                        <ActionButton
                          variant="outline"
                          size="sm"
                          busy={setStaffStatus.isPending}
                          onClick={() => setStaffStatus.mutate({ id: r.id, status: 'active' })}
                        >
                          {t('household.staff.activate')}
                        </ActionButton>
                      ) : null,
                  },
                ]}
                empty={{ icon: 'users', title: t('household.tab.staff'), body: '-' }}
              />
            ) : null}
          </div>
        </Drawer>
      ) : null}
    </>
  );
}
