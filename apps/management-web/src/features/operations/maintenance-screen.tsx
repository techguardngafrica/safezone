'use client';

import { type ApiRow, unwrap, unwrapPage } from '@safezone/api-client';
import { formatDateTime, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  type Column,
  DataTable,
  DetailList,
  Dialog,
  Drawer,
  FormError,
  InputField,
  PageHeader,
  SelectField,
  StatusPill,
  Tabs,
  TextAreaField,
  type Tone,
  Toolbar,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useEstate } from '../../../lib/estate';
import { errorText } from '../../../lib/errors';
import { usePaged } from '../../../lib/paged';
import { api } from '../../../lib/session';

type MaintenanceReq = ApiRow<'/v1/estates/{estateId}/maintenance-requests', 'get'>;
type Category = ApiRow<'/v1/estates/{estateId}/maintenance-categories', 'get'>;
type Recurring = ApiRow<'/v1/estates/{estateId}/recurring-maintenance', 'get'>;
type TabId = 'requests' | 'categories' | 'recurring';

const PRIORITY_TONE: Record<string, Tone> = {
  low: 'neutral',
  medium: 'info',
  high: 'warning',
  urgent: 'danger',
};

const STATUS_TONE: Record<string, Tone> = {
  submitted: 'warning',
  under_review: 'info',
  approved: 'info',
  in_progress: 'info',
  awaiting_materials: 'warning',
  resolved: 'success',
  closed: 'neutral',
  rejected: 'danger',
  cancelled: 'neutral',
};

export function MaintenanceScreen() {
  const { estateId, can } = useEstate();
  const queryClient = useQueryClient();
  const canAssign = can('maintenance.assign');

  const [tab, setTab] = useState<TabId>('requests');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState('');
  const [addingCategory, setAddingCategory] = useState(false);
  const [catName, setCatName] = useState('');
  const [catKind, setCatKind] = useState<'maintenance' | 'complaint'>('maintenance');
  const [catPriority, setCatPriority] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal');

  const list = usePaged<MaintenanceReq>(
    ['estate', estateId, 'maintenance-requests', statusFilter],
    (cursor) =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/maintenance-requests', {
          params: {
            path: { estateId },
            query: {
              status: (statusFilter || undefined) as MaintenanceReq['status'] | undefined,
              mine: 'false',
              limit: 50,
              cursor,
            },
          },
        }),
      ),
  );

  const detail = useQuery({
    queryKey: ['estate', estateId, 'maintenance-requests', 'detail', selectedId],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/maintenance-requests/{id}', {
          params: { path: { estateId, id: selectedId! } },
        }),
      ),
    enabled: Boolean(selectedId),
  });

  const categories = useQuery({
    queryKey: ['estate', estateId, 'maintenance-categories'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/maintenance-categories', {
          params: { path: { estateId } },
        }),
      ),
    enabled: tab === 'categories',
  });

  const recurring = useQuery({
    queryKey: ['estate', estateId, 'recurring-maintenance'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/recurring-maintenance', { params: { path: { estateId } } }),
      ),
    enabled: tab === 'recurring' && canAssign,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'maintenance-requests'] });
  };

  const transition = useMutation({
    mutationFn: ({
      id,
      action,
      reason,
    }: {
      id: string;
      action: 'review' | 'approve' | 'reject' | 'resolve' | 'close';
      reason?: string;
    }) => {
      if (action === 'review') {
        return unwrap(
          api.POST('/v1/estates/{estateId}/maintenance-requests/{id}/review', {
            params: { path: { estateId, id } },
            body: {},
          }),
        );
      }
      if (action === 'approve') {
        return unwrap(
          api.POST('/v1/estates/{estateId}/maintenance-requests/{id}/approve', {
            params: { path: { estateId, id } },
            body: {},
          }),
        );
      }
      if (action === 'reject') {
        return unwrap(
          api.POST('/v1/estates/{estateId}/maintenance-requests/{id}/reject', {
            params: { path: { estateId, id } },
            body: { reason: reason ?? t('mw.maintenance.rejectedByEstateManagement') },
          }),
        );
      }
      if (action === 'resolve') {
        return unwrap(
          api.POST('/v1/estates/{estateId}/maintenance-requests/{id}/resolve', {
            params: { path: { estateId, id } },
            body: {},
          }),
        );
      }
      return unwrap(
        api.POST('/v1/estates/{estateId}/maintenance-requests/{id}/close', {
          params: { path: { estateId, id } },
          body: {},
        }),
      );
    },
    onSuccess: invalidate,
  });

  const postComment = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/maintenance-requests/{id}/comments', {
          params: { path: { estateId, id: selectedId! } },
          body: { body: commentBody.trim(), internal: false },
        }),
      ),
    onSuccess: () => {
      setCommentBody('');
      invalidate();
    },
  });

  const addCategory = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/maintenance-categories', {
          params: { path: { estateId } },
          body: { name: catName.trim(), kind: catKind, defaultPriority: catPriority },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['estate', estateId, 'maintenance-categories'],
      });
      setAddingCategory(false);
      setCatName('');
    },
  });

  const reqCols: Column<MaintenanceReq>[] = [
    {
      key: 'title',
      header: t('mw.maintenance.request'),
      render: (r) => (
        <button
          type="button"
          className="sz-btn sz-btn-text"
          style={{ padding: 0, fontWeight: 600 }}
          onClick={() => {
            transition.reset();
            setSelectedId(r.id);
          }}
        >
          {r.title}
        </button>
      ),
    },
    { key: 'kind', header: t('mw.maintenance.kind'), render: (r) => r.kind },
    {
      key: 'priority',
      header: t('mw.maintenance.priority'),
      render: (r) => (
        <StatusPill tone={PRIORITY_TONE[r.priority] ?? 'neutral'} label={r.priority} />
      ),
    },
    {
      key: 'status',
      header: t('mw.maintenance.status'),
      render: (r) => (
        <StatusPill tone={STATUS_TONE[r.status] ?? 'neutral'} label={r.status.replace(/_/g, ' ')} />
      ),
    },
    {
      key: 'created',
      header: t('mw.maintenance.submitted'),
      render: (r) => <span className="sz-num">{formatDateTime(r.createdAt)}</span>,
    },
  ];

  const catCols: Column<Category>[] = [
    { key: 'name', header: t('mw.maintenance.category'), render: (r) => r.name },
    { key: 'kind', header: t('mw.maintenance.kind'), render: (r) => r.kind },
    {
      key: 'priority',
      header: t('mw.maintenance.defaultPriority'),
      render: (r) => (
        <StatusPill
          tone={PRIORITY_TONE[r.defaultPriority] ?? 'neutral'}
          label={r.defaultPriority}
        />
      ),
    },
    {
      key: 'active',
      header: t('mw.maintenance.status'),
      render: (r) => (
        <StatusPill
          tone={r.active ? 'success' : 'neutral'}
          label={r.active ? 'Active' : t('mw.maintenance.inactive')}
        />
      ),
    },
  ];

  const recCols: Column<Recurring>[] = [
    { key: 'title', header: t('mw.maintenance.schedule'), render: (r) => r.title },
    { key: 'interval', header: t('mw.maintenance.frequency'), render: (r) => r.frequency },
    {
      key: 'next',
      header: t('mw.maintenance.nextDue'),
      render: (r) => <span className="sz-num">{r.nextRunOn}</span>,
    },
    {
      key: 'active',
      header: t('mw.maintenance.status'),
      render: (r) => (
        <StatusPill
          tone={r.active ? 'success' : 'neutral'}
          label={r.active ? 'Active' : t('mw.maintenance.paused')}
        />
      ),
    },
  ];

  const current = detail.data;

  return (
    <>
      <PageHeader
        title={t('maintenance.title')}
        description={t('maintenance.description')}
        actions={
          tab === 'categories' && canAssign ? (
            <ActionButton
              icon="plus"
              onClick={() => {
                addCategory.reset();
                setAddingCategory(true);
              }}
            >
              {t('maintenance.addCategory')}
            </ActionButton>
          ) : null
        }
      />

      <Tabs<TabId>
        label={t('maintenance.title')}
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'requests', label: t('maintenance.tab.requests') },
          { key: 'categories', label: t('maintenance.tab.categories') },
          ...(canAssign
            ? [{ key: 'recurring' as const, label: t('maintenance.tab.recurring') }]
            : []),
        ]}
      />

      {tab === 'requests' ? (
        <>
          <Toolbar>
            <SelectField
              label={t('mw.maintenance.status')}
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: '', label: t('mw.maintenance.allStatuses') },
                { value: 'submitted', label: t('mw.maintenance.submitted') },
                { value: 'under_review', label: t('mw.maintenance.underReview') },
                { value: 'approved', label: t('mw.maintenance.approved') },
                { value: 'in_progress', label: t('mw.maintenance.inProgress') },
                { value: 'resolved', label: t('mw.maintenance.resolved') },
                { value: 'closed', label: t('mw.maintenance.closed') },
              ]}
            />
          </Toolbar>
          <DataTable
            caption={t('maintenance.tab.requests')}
            columns={reqCols}
            rows={list.rows}
            rowKey={(r) => r.id}
            loading={list.loading}
            error={list.error ? errorText(list.error) : null}
            onRetry={() => void list.refetch()}
            hasMore={list.hasMore}
            loadingMore={list.loadingMore}
            onLoadMore={list.loadMore}
            empty={{ icon: 'wrench', title: t('maintenance.title'), body: t('maintenance.empty') }}
          />
        </>
      ) : null}

      {tab === 'categories' ? (
        <DataTable
          caption={t('maintenance.tab.categories')}
          columns={catCols}
          rows={categories.data ?? []}
          rowKey={(r) => r.id}
          loading={categories.isPending}
          error={categories.isError ? errorText(categories.error) : null}
          onRetry={() => void categories.refetch()}
          empty={{ icon: 'wrench', title: t('maintenance.tab.categories'), body: '-' }}
        />
      ) : null}

      {tab === 'recurring' ? (
        <DataTable
          caption={t('maintenance.tab.recurring')}
          columns={recCols}
          rows={recurring.data ?? []}
          rowKey={(r) => r.id}
          loading={recurring.isPending}
          error={recurring.isError ? errorText(recurring.error) : null}
          onRetry={() => void recurring.refetch()}
          empty={{ icon: 'calendar', title: t('maintenance.tab.recurring'), body: '-' }}
        />
      ) : null}

      {selectedId ? (
        <Drawer
          title={current?.title ?? t('maintenance.title')}
          onClose={() => setSelectedId(null)}
        >
          {transition.isError ? <Banner tone="danger">{errorText(transition.error)}</Banner> : null}
          {current ? (
            <div style={{ display: 'grid', gap: 16 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <StatusPill
                  tone={STATUS_TONE[current.status] ?? 'neutral'}
                  label={current.status.replace(/_/g, ' ')}
                />
                <StatusPill
                  tone={PRIORITY_TONE[current.priority] ?? 'neutral'}
                  label={current.priority}
                />
              </div>
              {canAssign ? (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {current.status === 'submitted' ? (
                    <ActionButton
                      size="sm"
                      variant="secondary"
                      busy={transition.isPending}
                      onClick={() => transition.mutate({ id: current.id, action: 'review' })}
                    >
                      {t('mw.maintenance.review')}
                    </ActionButton>
                  ) : null}
                  {current.status === 'submitted' || current.status === 'under_review' ? (
                    <>
                      <ActionButton
                        size="sm"
                        busy={transition.isPending}
                        onClick={() => transition.mutate({ id: current.id, action: 'approve' })}
                      >
                        {t('mw.maintenance.approve')}
                      </ActionButton>
                      <ActionButton
                        size="sm"
                        variant="danger"
                        busy={transition.isPending}
                        onClick={() =>
                          transition.mutate({
                            id: current.id,
                            action: 'reject',
                            reason: t('mw.maintenance.rejectedByEstateManagement'),
                          })
                        }
                      >
                        {t('mw.maintenance.reject')}
                      </ActionButton>
                    </>
                  ) : null}
                  {current.status === 'approved' || current.status === 'in_progress' ? (
                    <ActionButton
                      size="sm"
                      busy={transition.isPending}
                      onClick={() => transition.mutate({ id: current.id, action: 'resolve' })}
                    >
                      {t('mw.maintenance.resolve')}
                    </ActionButton>
                  ) : null}
                  {current.status === 'resolved' ? (
                    <ActionButton
                      size="sm"
                      variant="outline"
                      busy={transition.isPending}
                      onClick={() => transition.mutate({ id: current.id, action: 'close' })}
                    >
                      {t('mw.maintenance.close')}
                    </ActionButton>
                  ) : null}
                </div>
              ) : null}
              <DetailList
                items={[
                  { label: t('mw.maintenance.kind'), value: current.kind },
                  {
                    label: t('mw.maintenance.submitted'),
                    value: formatDateTime(current.createdAt),
                  },
                ]}
              />
              <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{current.description}</p>
              <form
                className="sz-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (commentBody.trim()) postComment.mutate();
                }}
              >
                <TextAreaField
                  label={t('mw.maintenance.addComment')}
                  rows={3}
                  value={commentBody}
                  onChange={setCommentBody}
                />
                <div>
                  <ActionButton
                    type="submit"
                    size="sm"
                    disabled={!commentBody.trim()}
                    busy={postComment.isPending}
                  >
                    {t('mw.maintenance.postComment')}
                  </ActionButton>
                </div>
              </form>
            </div>
          ) : null}
        </Drawer>
      ) : null}

      {addingCategory ? (
        <Dialog
          title={t('maintenance.addCategory')}
          onClose={() => setAddingCategory(false)}
          onSubmit={() => addCategory.mutate()}
          actions={
            <>
              <ActionButton
                variant="outline"
                type="button"
                onClick={() => setAddingCategory(false)}
              >
                {t('common.cancel')}
              </ActionButton>
              <ActionButton type="submit" disabled={!catName.trim()} busy={addCategory.isPending}>
                {t('common.save')}
              </ActionButton>
            </>
          }
        >
          <FormError message={addCategory.isError ? errorText(addCategory.error) : null} />
          <div className="sz-form">
            <InputField
              label={t('mw.maintenance.name')}
              required
              value={catName}
              onChange={setCatName}
            />
            <div className="sz-form-2">
              <SelectField
                label={t('mw.maintenance.kind')}
                value={catKind}
                onChange={setCatKind}
                options={[
                  { value: 'maintenance', label: t('mw.maintenance.maintenance') },
                  { value: 'complaint', label: t('mw.maintenance.complaint') },
                ]}
              />
              <SelectField
                label={t('mw.maintenance.defaultPriority')}
                value={catPriority}
                onChange={setCatPriority}
                options={[
                  { value: 'low', label: t('mw.maintenance.low') },
                  { value: 'normal', label: t('mw.maintenance.normal') },
                  { value: 'high', label: t('mw.maintenance.high') },
                  { value: 'urgent', label: t('mw.maintenance.urgent') },
                ]}
              />
            </div>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
