'use client';

import { type ApiRow, unwrap } from '@safezone/api-client';
import { formatDateTime, formatKobo, t } from '@safezone/i18n';
import {
  ActionButton,
  type Column,
  DataTable,
  Dialog,
  FormError,
  InputField,
  PageHeader,
  SelectField,
  StatusPill,
  TextAreaField,
  Toolbar,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useEstate } from '../../../lib/estate';
import { errorText } from '../../../lib/errors';
import { parsePositiveNaira } from '../../../lib/money';
import { api } from '../../../lib/session';

type WorkOrder = ApiRow<'/v1/estates/{estateId}/work-orders', 'get'>;

export function WorkOrdersScreen() {
  const { estateId, can } = useEstate();
  const queryClient = useQueryClient();
  const canAssign = can('maintenance.assign');

  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [scope, setScope] = useState('');
  const [matTarget, setMatTarget] = useState<WorkOrder | null>(null);
  const [matItem, setMatItem] = useState('');
  const [matQty, setMatQty] = useState('1');
  const [matCost, setMatCost] = useState('');

  const list = useQuery({
    queryKey: ['estate', estateId, 'work-orders', status],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/work-orders', {
          params: {
            path: { estateId },
            query: { status: (status || undefined) as WorkOrder['status'] | undefined },
          },
        }),
      ),
  });

  const create = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/work-orders', {
          params: { path: { estateId } },
          body: { title: title.trim(), scope: scope.trim() || undefined },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'work-orders'] });
      setCreating(false);
      setTitle('');
      setScope('');
    },
  });

  const addMaterial = useMutation({
    mutationFn: () => {
      if (!matTarget) throw new Error('No work order selected');
      const unitCost = parsePositiveNaira(matCost);
      if (unitCost === null) throw new Error('Enter a valid positive amount in Naira');
      return unwrap(
        api.POST('/v1/estates/{estateId}/work-orders/{id}/materials', {
          params: { path: { estateId, id: matTarget.id } },
          body: {
            item: matItem.trim(),
            quantity: Math.max(1, Number.parseInt(matQty, 10) || 1),
            unitCost,
          },
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'work-orders'] });
      setMatTarget(null);
      setMatItem('');
      setMatCost('');
    },
  });

  const verify = useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/work-orders/{id}/verify', {
          params: { path: { estateId, id } },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'work-orders'] });
    },
  });

  const columns: Column<WorkOrder>[] = [
    { key: 'title', header: 'Work order', render: (r) => r.title },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <StatusPill
          tone={r.status === 'verified' || r.status === 'completed' ? 'success' : 'info'}
          label={r.status.replace(/_/g, ' ')}
        />
      ),
    },
    {
      key: 'cost',
      header: 'Labour cost',
      align: 'right',
      render: (r) => <span className="sz-num">{formatKobo(r.labourCost)}</span>,
    },
    {
      key: 'created',
      header: 'Created',
      render: (r) => <span className="sz-num">{formatDateTime(r.createdAt)}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <ActionButton
            variant="outline"
            size="sm"
            onClick={() => {
              addMaterial.reset();
              setMatTarget(r);
            }}
          >
            {t('workOrders.addMaterial')}
          </ActionButton>
          {canAssign && r.status === 'completed' ? (
            <ActionButton size="sm" busy={verify.isPending} onClick={() => verify.mutate(r.id)}>
              {t('workOrders.verify')}
            </ActionButton>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('workOrders.title')}
        description={t('workOrders.description')}
        actions={
          canAssign ? (
            <ActionButton
              icon="plus"
              onClick={() => {
                create.reset();
                setCreating(true);
              }}
            >
              {t('workOrders.create')}
            </ActionButton>
          ) : null
        }
      />

      <Toolbar>
        <SelectField
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: '', label: 'All statuses' },
            { value: 'open', label: 'Open' },
            { value: 'in_progress', label: 'In progress' },
            { value: 'completed', label: 'Completed' },
            { value: 'verified', label: 'Verified' },
            { value: 'cancelled', label: 'Cancelled' },
          ]}
        />
      </Toolbar>

      <DataTable
        caption={t('workOrders.title')}
        columns={columns}
        rows={list.data ?? []}
        rowKey={(r) => r.id}
        loading={list.isPending}
        error={list.isError ? errorText(list.error) : null}
        onRetry={() => void list.refetch()}
        empty={{ icon: 'clipboard', title: t('workOrders.title'), body: t('workOrders.empty') }}
      />

      {creating ? (
        <Dialog
          title={t('workOrders.create')}
          onClose={() => setCreating(false)}
          onSubmit={() => create.mutate()}
          actions={
            <>
              <ActionButton variant="outline" type="button" onClick={() => setCreating(false)}>
                {t('common.cancel')}
              </ActionButton>
              <ActionButton type="submit" disabled={!title.trim()} busy={create.isPending}>
                {t('common.save')}
              </ActionButton>
            </>
          }
        >
          <FormError message={create.isError ? errorText(create.error) : null} />
          <div className="sz-form">
            <InputField label="Title" required value={title} onChange={setTitle} />
            <TextAreaField label="Scope of work" rows={3} value={scope} onChange={setScope} />
          </div>
        </Dialog>
      ) : null}

      {matTarget ? (
        <Dialog
          title={`${t('workOrders.addMaterial')} (${matTarget.title})`}
          onClose={() => setMatTarget(null)}
          onSubmit={() => addMaterial.mutate()}
          actions={
            <>
              <ActionButton variant="outline" type="button" onClick={() => setMatTarget(null)}>
                {t('common.cancel')}
              </ActionButton>
              <ActionButton
                type="submit"
                disabled={!matItem.trim() || !matCost}
                busy={addMaterial.isPending}
              >
                {t('common.save')}
              </ActionButton>
            </>
          }
        >
          <FormError message={addMaterial.isError ? errorText(addMaterial.error) : null} />
          <div className="sz-form">
            <InputField label="Material item" required value={matItem} onChange={setMatItem} />
            <div className="sz-form-2">
              <InputField label="Quantity" type="number" value={matQty} onChange={setMatQty} />
              <InputField
                label="Unit cost (NGN)"
                type="number"
                required
                value={matCost}
                onChange={setMatCost}
              />
            </div>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
