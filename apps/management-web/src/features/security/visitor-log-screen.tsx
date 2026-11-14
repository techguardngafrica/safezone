'use client';

import { type ApiRow, unwrapPage } from '@safezone/api-client';
import { type MessageKey, formatDateTime, t } from '@safezone/i18n';
import {
  type Column,
  DataTable,
  InputField,
  PageHeader,
  SelectField,
  StatusPill,
  type Tone,
  Toolbar,
} from '@safezone/web-ui';
import { useState } from 'react';
import { useEstate } from '../../../lib/estate';
import { errorText } from '../../../lib/errors';
import { usePaged } from '../../../lib/paged';
import { api } from '../../../lib/session';
import { useGates } from '../../../lib/use-gates';

type GateEvent = ApiRow<'/v1/estates/{estateId}/gate/events', 'get'>;

const DECISION_TONE: Record<GateEvent['decision'], Tone> = {
  allow: 'success',
  check: 'warning',
  deny: 'danger',
  override: 'info',
};

/** A yyyy-mm-dd date from the picker, read as WAT (UTC+1), to an ISO instant. */
function watDate(value: string, endOfDay: boolean): string | undefined {
  if (!value) return undefined;
  return new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+01:00`).toISOString();
}

export function VisitorLogScreen() {
  const { estateId } = useEstate();
  const { gates, gateName } = useGates();
  const [gateId, setGateId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const list = usePaged<GateEvent>(
    ['estate', estateId, 'gate-events', gateId, from, to],
    (cursor) =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/gate/events', {
          params: {
            path: { estateId },
            query: {
              gateId: gateId || undefined,
              from: watDate(from, false),
              to: watDate(to, true),
              limit: 50,
              cursor,
            },
          },
        }),
      ),
    { refetchInterval: 15_000 },
  );

  const columns: Column<GateEvent>[] = [
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
        <div>
          <StatusPill
            tone={DECISION_TONE[row.decision]}
            icon={row.decision === 'allow' ? 'check' : 'alert'}
            label={t(`visitorLog.decision.${row.decision}` as MessageKey)}
          />
          {row.decisionReason ? (
            <div className="sz-muted" style={{ fontSize: 13 }}>
              {row.decisionReason}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'source',
      header: t('visitorLog.col.source'),
      render: (row) => (
        <span className="sz-muted" style={{ fontSize: 13 }}>
          {row.passId
            ? t('visitorLog.source.pass')
            : row.walkinId
              ? t('visitorLog.source.walkin')
              : '-'}
          {row.offline ? ` · ${t('visitorLog.offline')}` : ''}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader title={t('visitorLog.title')} description={t('visitorLog.description')} />
      <Toolbar>
        <div style={{ width: 220 }}>
          <SelectField
            label={t('visitorLog.filter.gate')}
            value={gateId}
            onChange={setGateId}
            options={[
              { value: '', label: t('visitorLog.filter.allGates') },
              ...gates.map((gate) => ({ value: gate.id, label: gate.name })),
            ]}
          />
        </div>
        <div style={{ width: 180 }}>
          <InputField
            label={t('visitorLog.filter.from')}
            type="date"
            value={from}
            onChange={setFrom}
            max={to || undefined}
          />
        </div>
        <div style={{ width: 180 }}>
          <InputField
            label={t('visitorLog.filter.to')}
            type="date"
            value={to}
            onChange={setTo}
            min={from || undefined}
          />
        </div>
      </Toolbar>
      <DataTable
        caption={t('visitorLog.title')}
        columns={columns}
        rows={list.rows}
        rowKey={(row) => row.id}
        loading={list.loading}
        error={list.error ? errorText(list.error) : null}
        onRetry={list.refetch}
        hasMore={list.hasMore}
        loadingMore={list.loadingMore}
        onLoadMore={list.loadMore}
        empty={{
          icon: 'list',
          title: t('visitorLog.empty.title'),
          body: t('visitorLog.empty.body'),
        }}
      />
    </>
  );
}
