'use client';

import { type ApiData, type ApiRow, unwrap } from '@safezone/api-client';
import { type MessageKey, formatDateTime, formatElapsed, formatTime, t } from '@safezone/i18n';
import {
  ActionButton,
  CheckboxField,
  Dialog,
  DetailList,
  EmptyState,
  ErrorState,
  FormError,
  PageHeader,
  Panel,
  Skeleton,
  StatusPill,
  Tabs,
  TextAreaField,
  type Tone,
} from '@safezone/web-ui';
import { colors } from '@safezone/design-tokens';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useEstate } from '../../../lib/estate';
import { errorText } from '../../../lib/errors';
import { api } from '../../../lib/session';
import { useNow } from '../../../lib/use-now';

type Alert = ApiRow<'/v1/estates/{estateId}/sos', 'get'>;
type AlertDetail = ApiData<'/v1/estates/{estateId}/sos/{id}', 'get'>;
type Status = Alert['status'];

/** UI_GUIDELINES §6.8 SOS tones. */
const TONE: Record<Status, Tone> = {
  triggered: 'danger',
  acknowledged: 'warning',
  assigned: 'info',
  responding: 'info',
  resolved: 'success',
  closed: 'neutral',
  cancelled: 'neutral',
};
const ACTIVE: Status[] = ['triggered', 'acknowledged', 'assigned', 'responding'];

const statusLabel = (status: Status) => t(`sos.status.${status}` as MessageKey);
const categoryLabel = (category: Alert['category']) => t(`sos.category.${category}` as MessageKey);
function eventLabel(type: string): string {
  const key = `sos.event.${type}` as MessageKey;
  const text = t(key);
  return text === key ? type.replace(/[._]/g, ' ') : text;
}

function AlertRow({
  alert,
  selected,
  now,
  onSelect,
}: {
  alert: Alert;
  selected: boolean;
  now: number;
  onSelect: () => void;
}) {
  const active = ACTIVE.includes(alert.status);
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className="sz-card"
        style={{
          width: '100%',
          textAlign: 'left',
          cursor: 'pointer',
          font: 'inherit',
          padding: 16,
          display: 'grid',
          gap: 8,
          borderColor: selected ? colors.brand.primary : undefined,
          borderWidth: selected ? 2 : 1,
          background: selected ? colors.brand.primarySubtle : undefined,
        }}
      >
        {alert.isDrill ? <div className="sz-drill">{t('sos.drill')}</div> : null}
        <div
          style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}
        >
          <strong>{alert.unitCode ?? t('sos.unknownUnit')}</strong>
          <StatusPill tone={TONE[alert.status]} icon="siren" label={statusLabel(alert.status)} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 14 }}>
          <span>{categoryLabel(alert.category)}</span>
          <span
            className="sz-num"
            style={{ fontWeight: 600, color: active ? colors.status.danger : undefined }}
          >
            {active ? formatElapsed(alert.triggeredAt, now) : formatDateTime(alert.triggeredAt)}
          </span>
        </div>
      </button>
    </li>
  );
}

type ActionKind = 'resolve' | 'close' | 'note';

function ActionDialog({
  kind,
  alert,
  onClose,
}: {
  kind: ActionKind;
  alert: AlertDetail;
  onClose: () => void;
}) {
  const { estateId } = useEstate();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [falseAlarm, setFalseAlarm] = useState(false);
  const required = kind !== 'close';
  const run = useMutation({
    mutationFn: () => {
      const path = { estateId, id: alert.id };
      if (kind === 'resolve')
        return unwrap(
          api.POST('/v1/estates/{estateId}/sos/{id}/resolve', {
            params: { path },
            body: { resolution: text.trim(), falseAlarm },
          }),
        );
      if (kind === 'close')
        return unwrap(
          api.POST('/v1/estates/{estateId}/sos/{id}/close', {
            params: { path },
            body: text.trim() ? { notes: text.trim() } : {},
          }),
        );
      return unwrap(
        api.POST('/v1/estates/{estateId}/sos/{id}/notes', {
          params: { path },
          body: { note: text.trim() },
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'sos'] });
      onClose();
    },
  });
  return (
    <Dialog
      title={t(`sos.dialog.${kind}.title` as MessageKey)}
      onClose={onClose}
      onSubmit={() => {
        if (required && !text.trim()) return;
        run.mutate();
      }}
      actions={
        <>
          <ActionButton variant="text" onClick={onClose}>
            {t('common.cancel')}
          </ActionButton>
          <ActionButton type="submit" busy={run.isPending} disabled={required && !text.trim()}>
            {t(`sos.dialog.${kind}.submit` as MessageKey)}
          </ActionButton>
        </>
      }
    >
      <div className="sz-form">
        <TextAreaField
          label={t(`sos.dialog.${kind}.label` as MessageKey)}
          value={text}
          onChange={setText}
          required={required}
          autoFocus
          maxLength={2000}
        />
        {kind === 'resolve' ? (
          <CheckboxField
            label={t('sos.dialog.resolve.falseAlarm')}
            checked={falseAlarm}
            onChange={setFalseAlarm}
          />
        ) : null}
        <FormError message={run.isError ? errorText(run.error) : null} />
      </div>
    </Dialog>
  );
}

function AlertDetailPanel({ id, now }: { id: string; now: number }) {
  const { estateId } = useEstate();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<ActionKind | null>(null);
  const detail = useQuery({
    queryKey: ['estate', estateId, 'sos', 'detail', id],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/sos/{id}', { params: { path: { estateId, id } } })),
    refetchInterval: 3_000,
  });
  const step = useMutation({
    mutationFn: (kind: 'acknowledge' | 'responding') =>
      kind === 'acknowledge'
        ? unwrap(
            api.POST('/v1/estates/{estateId}/sos/{id}/acknowledge', {
              params: { path: { estateId, id } },
            }),
          )
        : unwrap(
            api.POST('/v1/estates/{estateId}/sos/{id}/responding', {
              params: { path: { estateId, id } },
            }),
          ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'sos'] }),
  });

  if (detail.isPending)
    return (
      <Panel>
        <div style={{ display: 'grid', gap: 12 }}>
          <Skeleton height={24} width="50%" />
          <Skeleton height={120} />
        </div>
      </Panel>
    );
  if (detail.isError)
    return (
      <Panel>
        <ErrorState message={errorText(detail.error)} onRetry={() => void detail.refetch()} />
      </Panel>
    );
  const alert = detail.data;
  const active = ACTIVE.includes(alert.status);
  return (
    <Panel>
      {alert.isDrill ? (
        <div className="sz-drill" style={{ marginBottom: 12 }}>
          {t('sos.drillBanner')}
        </div>
      ) : null}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 16,
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>
            {t('sos.detail.title', { unit: alert.unitCode ?? t('sos.unknownUnit') })}
          </h2>
          <div className="sz-muted" style={{ fontSize: 14 }}>
            {categoryLabel(alert.category)} · {formatDateTime(alert.triggeredAt)}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <StatusPill tone={TONE[alert.status]} icon="siren" label={statusLabel(alert.status)} />
          {active ? (
            <div
              className="sz-num"
              style={{ fontSize: 22, fontWeight: 700, color: colors.status.danger, marginTop: 4 }}
            >
              {formatElapsed(alert.triggeredAt, now)}
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        {alert.status === 'triggered' ? (
          <ActionButton
            variant="danger"
            busy={step.isPending && step.variables === 'acknowledge'}
            onClick={() => step.mutate('acknowledge')}
          >
            {t('sos.action.acknowledge')}
          </ActionButton>
        ) : null}
        {alert.status === 'acknowledged' || alert.status === 'assigned' ? (
          <ActionButton
            busy={step.isPending && step.variables === 'responding'}
            onClick={() => step.mutate('responding')}
          >
            {t('sos.action.responding')}
          </ActionButton>
        ) : null}
        {active && alert.status !== 'triggered' ? (
          <ActionButton variant="outline" onClick={() => setDialog('resolve')}>
            {t('sos.action.resolve')}
          </ActionButton>
        ) : null}
        {alert.status === 'resolved' ? (
          <ActionButton variant="outline" onClick={() => setDialog('close')}>
            {t('sos.action.close')}
          </ActionButton>
        ) : null}
        {alert.status !== 'closed' && alert.status !== 'cancelled' ? (
          <ActionButton variant="text" onClick={() => setDialog('note')}>
            {t('sos.action.note')}
          </ActionButton>
        ) : null}
      </div>
      <FormError message={step.isError ? errorText(step.error) : null} />

      <DetailList
        items={[
          { label: t('sos.field.source'), value: alert.source },
          { label: t('sos.field.triggerRole'), value: alert.triggerRole },
          {
            label: t('sos.field.location'),
            value: alert.lastLocation ? (
              <span className="sz-num">
                {alert.lastLocation.lat.toFixed(5)}, {alert.lastLocation.lng.toFixed(5)}
                {alert.lastLocation.accuracyM !== null
                  ? ` (${t('sos.field.accuracy', { metres: Math.round(alert.lastLocation.accuracyM) })})`
                  : ''}
                <span className="sz-muted"> · {formatTime(alert.lastLocation.capturedAt)}</span>
              </span>
            ) : (
              <span className="sz-muted">{t('sos.field.noLocation')}</span>
            ),
          },
          ...(alert.resolution
            ? [
                {
                  label: t('sos.field.resolution'),
                  value: `${alert.resolution}${alert.falseAlarm ? ` (${t('sos.field.falseAlarm')})` : ''}`,
                },
              ]
            : []),
        ]}
      />

      {alert.emergencyContacts && alert.emergencyContacts.length > 0 ? (
        <>
          <h3 style={{ fontSize: 16, margin: '24px 0 8px' }}>{t('sos.contacts')}</h3>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14 }}>
            {alert.emergencyContacts.map((contact) => (
              <li key={`${contact.name}-${contact.phone}`}>
                {contact.name} ({contact.relationship}):{' '}
                <a href={`tel:${contact.phone}`}>{contact.phone}</a>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <h3 style={{ fontSize: 16, margin: '24px 0 12px' }}>{t('sos.timeline')}</h3>
      <ol className="sz-timeline">
        {alert.timeline.map((event) => (
          <li key={event.id}>
            <div>
              <strong>{eventLabel(event.type)}</strong>
              {event.channel ? <span className="sz-muted"> · {event.channel}</span> : null}
              {typeof (event.payload as { note?: unknown }).note === 'string' ? (
                <div>{(event.payload as { note: string }).note}</div>
              ) : null}
              <div className="sz-muted sz-num" style={{ fontSize: 13 }}>
                {formatTime(event.occurredAt)}
              </div>
            </div>
          </li>
        ))}
      </ol>
      {dialog ? <ActionDialog kind={dialog} alert={alert} onClose={() => setDialog(null)} /> : null}
    </Panel>
  );
}

export function SosConsoleScreen() {
  const { estateId } = useEstate();
  const now = useNow();
  const [view, setView] = useState<'active' | 'all'>('active');
  const [selected, setSelected] = useState<string | null>(null);
  const alerts = useQuery({
    queryKey: ['estate', estateId, 'sos', view],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/sos', {
          params: { path: { estateId }, query: { status: view, limit: 50 } },
        }),
      ),
    refetchInterval: view === 'active' ? 3_000 : 30_000,
  });
  const list = alerts.data ?? [];
  const current =
    selected && list.some((alert) => alert.id === selected) ? selected : (list[0]?.id ?? null);

  return (
    <>
      <PageHeader title={t('sos.console.title')} description={t('sos.console.description')} />
      <Tabs
        label={t('sos.console.title')}
        value={view}
        onChange={(key) => {
          setView(key);
          setSelected(null);
        }}
        tabs={[
          { key: 'active', label: t('sos.console.active') },
          { key: 'all', label: t('sos.console.history') },
        ]}
      />
      <div
        style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          alignItems: 'start',
        }}
      >
        <div style={{ maxWidth: 480 }}>
          {alerts.isPending ? (
            <div style={{ display: 'grid', gap: 12 }}>
              <Skeleton height={88} />
              <Skeleton height={88} />
            </div>
          ) : alerts.isError ? (
            <ErrorState message={errorText(alerts.error)} onRetry={() => void alerts.refetch()} />
          ) : list.length === 0 ? (
            <Panel>
              <EmptyState
                icon="shield"
                title={
                  view === 'active' ? t('sos.console.emptyActive') : t('sos.console.emptyHistory')
                }
                body={view === 'active' ? t('sos.console.emptyActiveBody') : undefined}
              />
            </Panel>
          ) : (
            <ul
              style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}
              aria-live="polite"
            >
              {list.map((alert) => (
                <AlertRow
                  key={alert.id}
                  alert={alert}
                  now={now}
                  selected={alert.id === current}
                  onSelect={() => setSelected(alert.id)}
                />
              ))}
            </ul>
          )}
        </div>
        <div style={{ gridColumn: 'span 2', minWidth: 0 }}>
          {current ? <AlertDetailPanel key={current} id={current} now={now} /> : null}
        </div>
      </div>
    </>
  );
}
