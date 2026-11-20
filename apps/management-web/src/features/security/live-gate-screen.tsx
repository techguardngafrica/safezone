'use client';

import { type ApiRow, unwrap, unwrapPage } from '@safezone/api-client';
import { type MessageKey, formatDateTime, formatTime, t } from '@safezone/i18n';
import {
  ActionButton,
  type Column,
  DataTable,
  EmptyState,
  PageHeader,
  SelectField,
  StatusPill,
  Tabs,
  type Tone,
  Toolbar,
} from '@safezone/web-ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { useEstate } from '../../../lib/estate';
import { errorText } from '../../../lib/errors';
import { usePaged } from '../../../lib/paged';
import { useRealtimeRoom } from '../../../lib/realtime';
import { api } from '../../../lib/session';
import { useGates } from '../../../lib/use-gates';

type GateEvent = ApiRow<'/v1/estates/{estateId}/gate/events', 'get'>;
type Walkin = ApiRow<'/v1/estates/{estateId}/walkins', 'get'>;
type InsideItem = ApiRow<'/v1/estates/{estateId}/gate/inside', 'get'>;
type TabId = 'activity' | 'inside' | 'expected' | 'walkins';

const DECISION_TONE: Record<GateEvent['decision'], Tone> = {
  allow: 'success',
  check: 'warning',
  deny: 'danger',
  override: 'info',
};

const WALKIN_TONE: Record<Walkin['status'], Tone> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  timed_out: 'neutral',
  cancelled: 'neutral',
};

export function LiveGateScreen() {
  const { estateId } = useEstate();
  const queryClient = useQueryClient();
  const { gates, gateName } = useGates();
  const [tab, setTab] = useState<TabId>('activity');
  const [gateId, setGateId] = useState('');
  const [walkinStatus, setWalkinStatus] = useState<string>('pending');

  const activeGateId = gateId || gates[0]?.id || '';
  const room = gateId ? `estate:${estateId}:gate:${gateId}` : `estate:${estateId}:security`;

  const invalidateLive = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'live-gate'] });
  }, [queryClient, estateId]);

  const rtStatus = useRealtimeRoom(room, 'gate:update', invalidateLive);
  const pollMs = rtStatus === 'connected' ? 30_000 : 5_000;

  const activity = usePaged<GateEvent>(
    ['estate', estateId, 'live-gate', 'events', gateId],
    (cursor) =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/gate/events', {
          params: {
            path: { estateId },
            query: { gateId: gateId || undefined, limit: 50, cursor },
          },
        }),
      ),
    { refetchInterval: pollMs },
  );

  const inside = useQuery({
    queryKey: ['estate', estateId, 'live-gate', 'inside'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/gate/inside', {
          params: { path: { estateId } },
        }),
      ),
    refetchInterval: pollMs,
  });

  const expected = useQuery({
    queryKey: ['estate', estateId, 'live-gate', 'expected', activeGateId],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/gate/expected', {
          params: { path: { estateId }, query: { gateId: activeGateId, hours: 24 } },
        }),
      ),
    enabled: Boolean(activeGateId),
    refetchInterval: 60_000,
  });

  const walkins = usePaged<Walkin>(
    ['estate', estateId, 'live-gate', 'walkins', gateId, walkinStatus],
    (cursor) =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/walkins', {
          params: {
            path: { estateId },
            query: {
              gateId: gateId || undefined,
              status: (walkinStatus || undefined) as Walkin['status'] | undefined,
              limit: 50,
              cursor,
            },
          },
        }),
      ),
    { refetchInterval: pollMs },
  );

  const insideRows = useMemo(
    () => (inside.data ?? []).filter((item) => !gateId || item.gateId === gateId),
    [inside.data, gateId],
  );
  const expectedPasses = expected.data?.passes ?? [];

  const activityColumns: Column<GateEvent>[] = [
    {
      key: 'time',
      header: t('visitorLog.col.time'),
      render: (row) => <span className="sz-num">{formatDateTime(row.occurredAt)}</span>,
    },
    {
      key: 'visitor',
      header: t('visitorLog.col.visitor'),
      render: (row) => row.visitorName ?? <span className="sz-muted">-</span>,
    },
    {
      key: 'plate',
      header: t('visitorLog.col.plate'),
      render: (row) => row.vehiclePlate ?? <span className="sz-muted">-</span>,
    },
    { key: 'gate', header: t('visitorLog.col.gate'), render: (row) => gateName(row.gateId) },
    {
      key: 'direction',
      header: t('visitorLog.col.direction'),
      render: (row) => t(`visitorLog.direction.${row.direction}` as MessageKey),
    },
    {
      key: 'decision',
      header: t('visitorLog.col.decision'),
      render: (row) => (
        <StatusPill
          tone={DECISION_TONE[row.decision]}
          icon={row.decision === 'allow' ? 'check' : 'alert'}
          label={t(`visitorLog.decision.${row.decision}` as MessageKey)}
        />
      ),
    },
  ];

  const insideColumns: Column<InsideItem>[] = [
    {
      key: 'visitor',
      header: t('visitorLog.col.visitor'),
      render: (row) => row.visitorName ?? <span className="sz-muted">-</span>,
    },
    {
      key: 'plate',
      header: t('visitorLog.col.plate'),
      render: (row) => row.vehiclePlate ?? <span className="sz-muted">-</span>,
    },
    { key: 'gate', header: t('visitorLog.col.gate'), render: (row) => gateName(row.gateId) },
    {
      key: 'enteredAt',
      header: t('liveGate.inside.col.enteredAt'),
      render: (row) => <span className="sz-num">{formatDateTime(row.enteredAt)}</span>,
    },
  ];

  const expectedColumns: Column<(typeof expectedPasses)[number]>[] = [
    {
      key: 'visitor',
      header: t('visitorLog.col.visitor'),
      render: (row) => row.visitorName,
    },
    {
      key: 'unit',
      header: t('liveGate.expected.col.unit'),
      render: (row) => row.unitCode ?? <span className="sz-muted">-</span>,
    },
    {
      key: 'plate',
      header: t('visitorLog.col.plate'),
      render: (row) => row.vehiclePlate ?? <span className="sz-muted">-</span>,
    },
    {
      key: 'window',
      header: t('liveGate.expected.col.window'),
      render: (row) => (
        <span className="sz-num">
          {formatTime(row.validFrom)} - {formatTime(row.validTo)}
        </span>
      ),
    },
    {
      key: 'uses',
      header: t('liveGate.expected.col.uses'),
      render: (row) => (
        <span className="sz-num">
          {row.usesCount} / {row.maxUses ?? '∞'}
        </span>
      ),
    },
  ];

  const walkinColumns: Column<Walkin>[] = [
    {
      key: 'time',
      header: t('visitorLog.col.time'),
      render: (row) => <span className="sz-num">{formatDateTime(row.createdAt)}</span>,
    },
    {
      key: 'visitor',
      header: t('visitorLog.col.visitor'),
      render: (row) => row.visitorName,
    },
    {
      key: 'unit',
      header: t('liveGate.walkins.col.unit'),
      render: (row) => row.unitCode ?? <span className="sz-muted">-</span>,
    },
    { key: 'gate', header: t('visitorLog.col.gate'), render: (row) => gateName(row.gateId) },
    {
      key: 'purpose',
      header: t('liveGate.walkins.col.purpose'),
      render: (row) => row.purpose ?? <span className="sz-muted">-</span>,
    },
    {
      key: 'status',
      header: t('liveGate.walkins.col.status'),
      render: (row) => (
        <StatusPill
          tone={WALKIN_TONE[row.status]}
          label={t(`liveGate.walkins.status.${row.status}` as MessageKey)}
        />
      ),
    },
    {
      key: 'expires',
      header: t('liveGate.walkins.col.expiresAt'),
      render: (row) => <span className="sz-num">{formatTime(row.expiresAt)}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title={t('liveGate.title')}
        description={t('liveGate.description')}
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <StatusPill
              tone={
                rtStatus === 'connected'
                  ? 'success'
                  : rtStatus === 'reconnecting'
                    ? 'warning'
                    : 'neutral'
              }
              icon="activity"
              label={t(`realtime.${rtStatus}` as MessageKey)}
            />
            <ActionButton variant="outline" size="sm" icon="refresh" onClick={invalidateLive}>
              {t('common.refresh')}
            </ActionButton>
          </div>
        }
      />

      <Toolbar>
        <SelectField
          label={t('visitorLog.filter.gate')}
          value={gateId}
          onChange={setGateId}
          options={[
            { value: '', label: t('visitorLog.filter.allGates') },
            ...gates.map((gate) => ({ value: gate.id, label: gate.name })),
          ]}
        />
        {tab === 'walkins' ? (
          <SelectField
            label={t('liveGate.walkins.filter.status')}
            value={walkinStatus}
            onChange={setWalkinStatus}
            options={[
              { value: '', label: t('liveGate.walkins.status.all') },
              { value: 'pending', label: t('liveGate.walkins.status.pending') },
              { value: 'approved', label: t('liveGate.walkins.status.approved') },
              { value: 'rejected', label: t('liveGate.walkins.status.rejected') },
              { value: 'timed_out', label: t('liveGate.walkins.status.timed_out') },
              { value: 'cancelled', label: t('liveGate.walkins.status.cancelled') },
            ]}
          />
        ) : null}
      </Toolbar>

      <Tabs<TabId>
        label={t('liveGate.title')}
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'activity', label: t('liveGate.tab.activity') },
          { key: 'inside', label: t('liveGate.tab.inside', { count: insideRows.length }) },
          { key: 'expected', label: t('liveGate.tab.expected', { count: expectedPasses.length }) },
          {
            key: 'walkins',
            label: t('liveGate.tab.walkins', { count: walkins.rows?.length ?? 0 }),
          },
        ]}
      />

      {tab === 'activity' ? (
        <DataTable
          caption={t('liveGate.tab.activity')}
          columns={activityColumns}
          rows={activity.rows}
          rowKey={(row) => row.id}
          loading={activity.loading}
          error={activity.error ? errorText(activity.error) : null}
          onRetry={() => void activity.refetch()}
          hasMore={activity.hasMore}
          loadingMore={activity.loadingMore}
          onLoadMore={activity.loadMore}
          empty={{
            icon: 'activity',
            title: t('visitorLog.empty.title'),
            body: t('visitorLog.empty.body'),
          }}
        />
      ) : null}

      {tab === 'inside' ? (
        <DataTable
          caption={t('liveGate.tab.inside', { count: insideRows.length })}
          columns={insideColumns}
          rows={insideRows}
          rowKey={(row) =>
            `${row.passId ?? row.walkinId ?? row.vehiclePlate ?? row.gateId}-${row.enteredAt}`
          }
          loading={inside.isPending}
          error={inside.isError ? errorText(inside.error) : null}
          onRetry={() => void inside.refetch()}
          empty={{
            icon: 'users',
            title: t('liveGate.inside.empty.title'),
            body: t('liveGate.inside.empty.body'),
          }}
        />
      ) : null}

      {tab === 'expected' ? (
        !activeGateId ? (
          <EmptyState
            icon="door"
            title={t('liveGate.expected.empty.title')}
            body={t('liveGate.selectGate')}
          />
        ) : (
          <DataTable
            caption={t('liveGate.tab.expected', { count: expectedPasses.length })}
            columns={expectedColumns}
            rows={expectedPasses}
            rowKey={(row) => row.id}
            loading={expected.isPending}
            error={expected.isError ? errorText(expected.error) : null}
            onRetry={() => void expected.refetch()}
            empty={{
              icon: 'ticket',
              title: t('liveGate.expected.empty.title'),
              body: t('liveGate.expected.empty.body'),
            }}
          />
        )
      ) : null}

      {tab === 'walkins' ? (
        <DataTable
          caption={t('liveGate.tab.walkins', { count: walkins.rows?.length ?? 0 })}
          columns={walkinColumns}
          rows={walkins.rows}
          rowKey={(row) => row.id}
          loading={walkins.loading}
          error={walkins.error ? errorText(walkins.error) : null}
          onRetry={() => void walkins.refetch()}
          hasMore={walkins.hasMore}
          loadingMore={walkins.loadingMore}
          onLoadMore={walkins.loadMore}
          empty={{
            icon: 'userCheck',
            title: t('liveGate.walkins.empty.title'),
            body: t('liveGate.walkins.empty.body'),
          }}
        />
      ) : null}
    </>
  );
}
