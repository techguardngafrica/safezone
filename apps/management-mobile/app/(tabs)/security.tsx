import { type ApiRow, unwrap, unwrapPage } from '@safezone/api-client';
import { colors, spacing, typography } from '@safezone/design-tokens';
import { type MessageKey, formatDateTime, formatTime, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  Card,
  ChipGroup,
  ConfirmModal,
  EmptyState,
  ErrorState,
  ListRow,
  ScreenHeader,
  ScrollScreen,
  Segmented,
  Skeleton,
  StatusPill,
  TextField,
  type Tone,
} from '@safezone/mobile-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { Icon } from '../../src/components/icon';
import {
  SOS_TONE,
  categoryText,
  sosStatusText,
  useActiveSos,
  useCanRespondToSos,
} from '../../src/features/sos';
import { matchesVisitor } from '../../src/features/visitor-search';
import { errorText, isNetworkError } from '../../src/lib/errors';
import { useManager } from '../../src/lib/manager';
import { api } from '../../src/lib/session';
import { useNow } from '../../src/lib/use-now';
import { usePullRefresh } from '../../src/lib/use-pull-refresh';

type SecurityView = 'activity' | 'expected' | 'inside' | 'walkins' | 'sos';
type GateEvent = ApiRow<'/v1/estates/{estateId}/gate/events', 'get'>;
type Walkin = ApiRow<'/v1/estates/{estateId}/walkins', 'get'>;

const DECISION_TONE: Record<GateEvent['decision'], Tone> = {
  allow: 'success',
  check: 'warning',
  deny: 'danger',
  override: 'warning',
};
const WALKIN_TONE: Record<Walkin['status'], Tone> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  timed_out: 'neutral',
  cancelled: 'neutral',
};
const LIVE_MS = 10_000;
const OVERSTAY_MS = 12 * 60 * 60_000;

function useGates() {
  const { estateId, hasFeature } = useManager();
  return useQuery({
    queryKey: ['estate', estateId, 'gates'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/gates', { params: { path: { estateId } } })),
    enabled: hasFeature('security'),
    staleTime: 5 * 60_000,
  });
}

function QueryStates({
  query,
  empty,
  emptyTitle,
  emptyBody,
}: {
  query: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  empty: boolean;
  emptyTitle: string;
  emptyBody?: string;
}) {
  if (query.isPending)
    return (
      <>
        <Skeleton height={64} />
        <Skeleton height={64} />
      </>
    );
  if (query.isError)
    return isNetworkError(query.error) ? (
      <Banner tone="warning">{t('mm.offline.cached')}</Banner>
    ) : (
      <ErrorState message={errorText(query.error)} onRetry={() => void query.refetch()} />
    );
  if (empty)
    return (
      <EmptyState
        icon={<Icon name="shield-checkmark-outline" size={28} color={colors.brand.primary} />}
        title={emptyTitle}
        body={emptyBody}
      />
    );
  return null;
}

function Activity({
  gateId,
  gateName,
  search,
}: {
  gateId: string;
  gateName: (id: string) => string;
  search: string;
}) {
  const { estateId } = useManager();
  const events = useQuery({
    queryKey: ['estate', estateId, 'gate-events', 'live', gateId],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/gate/events', {
          params: {
            path: { estateId },
            query: { gateId: gateId === 'all' ? undefined : gateId, limit: 50 },
          },
        }),
      ),
    refetchInterval: LIVE_MS,
  });
  const items = (events.data?.items ?? []).filter((event) =>
    matchesVisitor(search, [event.visitorName, event.vehiclePlate]),
  );
  return (
    <>
      <QueryStates
        query={events}
        empty={items.length === 0}
        emptyTitle={t('visitorLog.empty.title')}
        emptyBody={t('visitorLog.empty.body')}
      />
      {items.map((event) => (
        <ListRow
          key={event.id}
          title={event.visitorName ?? event.vehiclePlate ?? t('mm.security.unnamed')}
          subtitle={[
            formatTime(event.occurredAt),
            t(`visitorLog.direction.${event.direction}` as MessageKey),
            gateName(event.gateId),
            event.vehiclePlate,
            event.offline ? t('visitorLog.offline') : null,
          ]
            .filter(Boolean)
            .join(' · ')}
          leading={
            <Icon
              name={event.direction === 'in' ? 'enter-outline' : 'exit-outline'}
              color={colors.brand.primary}
              size={20}
            />
          }
          trailing={
            <StatusPill
              tone={DECISION_TONE[event.decision]}
              label={t(`visitorLog.decision.${event.decision}` as MessageKey)}
            />
          }
        />
      ))}
    </>
  );
}

function Expected({ gateId, search }: { gateId: string | null; search: string }) {
  const { estateId } = useManager();
  const queryClient = useQueryClient();
  const [revoking, setRevoking] = useState<{ id: string; name: string } | null>(null);
  const [reason, setReason] = useState('');
  const expected = useQuery({
    queryKey: ['estate', estateId, 'gate', 'expected', gateId],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/gate/expected', {
          params: { path: { estateId }, query: { gateId: gateId ?? '', hours: 24 } },
        }),
      ),
    enabled: Boolean(gateId),
    refetchInterval: 30_000,
  });
  const revoke = useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/visitor-passes/{id}/revoke', {
          params: { path: { estateId, id } },
          body: { reason: reason.trim() },
        }),
      ),
    onSuccess: () => {
      setRevoking(null);
      setReason('');
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'gate'] });
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'visitor-passes'] });
    },
  });
  if (!gateId) return <Banner tone="info">{t('liveGate.selectGate')}</Banner>;
  const passes = (expected.data?.passes ?? []).filter((pass) =>
    matchesVisitor(search, [pass.visitorName, pass.vehiclePlate, pass.unitCode]),
  );
  return (
    <>
      <QueryStates
        query={expected}
        empty={passes.length === 0}
        emptyTitle={t('liveGate.expected.empty.title')}
      />
      {passes.map((pass) => (
        <Card key={pass.id}>
          <View style={{ gap: spacing[1] }}>
            <View
              style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing[2] }}
            >
              <Text
                style={{
                  flex: 1,
                  fontSize: typography.size.md,
                  fontWeight: typography.weight.semibold,
                  color: colors.semantic.text,
                }}
              >
                {pass.visitorName}
              </Text>
              <StatusPill tone="info" label={t(`passes.type.${pass.type}` as MessageKey)} />
            </View>
            <Text style={{ fontSize: typography.size.sm, color: colors.semantic.textMuted }}>
              {[
                pass.unitCode,
                pass.vehiclePlate,
                `${formatTime(pass.validFrom)} - ${formatTime(pass.validTo)}`,
                t('mm.security.uses', {
                  used: pass.usesCount,
                  max: pass.maxUses ?? t('mm.security.unlimited'),
                }),
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
          <View style={{ marginTop: spacing[2] }}>
            <ActionButton
              label={t('mm.security.revokePass')}
              variant="outline"
              icon={<Icon name="ban-outline" color={colors.brand.primary} size={18} />}
              onPress={() => {
                setReason('');
                setRevoking({ id: pass.id, name: pass.visitorName });
              }}
            />
          </View>
        </Card>
      ))}
      <ConfirmModal
        visible={revoking !== null}
        title={t('passes.revokeConfirm.title')}
        body={t('mm.security.revokeBody', { name: revoking?.name ?? '' })}
        confirmLabel={t('passes.revoke')}
        cancelLabel={t('passes.revokeConfirm.keep')}
        destructive
        busy={revoke.isPending}
        error={revoke.isError ? errorText(revoke.error) : null}
        reason={{
          label: t('passes.revokeConfirm.reason'),
          value: reason,
          onChange: setReason,
          required: true,
        }}
        onConfirm={() => {
          if (revoking && reason.trim().length >= 3) revoke.mutate(revoking.id);
        }}
        onCancel={() => {
          setRevoking(null);
          revoke.reset();
        }}
      />
    </>
  );
}

function Inside({ gateName, search }: { gateName: (id: string) => string; search: string }) {
  const { estateId, can } = useManager();
  const now = useNow(60_000);
  const canFlag = can('security.staff.manage') || can('incident.manage');
  const [flagging, setFlagging] = useState<{ name: string; plate: string | null } | null>(null);
  const [reason, setReason] = useState('');
  const inside = useQuery({
    queryKey: ['estate', estateId, 'gate', 'inside'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/gate/inside', { params: { path: { estateId } } })),
    refetchInterval: LIVE_MS,
  });
  const flag = useMutation({
    mutationFn: (target: { name: string; plate: string | null }) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/restricted-visitors', {
          params: { path: { estateId } },
          body: {
            name: target.name,
            plate: target.plate ?? undefined,
            reason: reason.trim(),
          },
        }),
      ),
    onSuccess: () => {
      setFlagging(null);
      setReason('');
    },
  });
  const items = (inside.data ?? []).filter((visitor) =>
    matchesVisitor(search, [visitor.visitorName, visitor.vehiclePlate]),
  );
  return (
    <>
      <QueryStates
        query={inside}
        empty={items.length === 0}
        emptyTitle={t('mm.security.insideEmpty')}
        emptyBody={t('mm.security.insideEmptyBody')}
      />
      {items.map((visitor, index) => {
        const enteredMs = Date.parse(visitor.enteredAt);
        const isOverstay = Number.isFinite(enteredMs) && now - enteredMs > OVERSTAY_MS;
        const displayName = visitor.visitorName ?? visitor.vehiclePlate ?? t('mm.security.unnamed');
        return (
          <Card key={`${visitor.passId ?? visitor.walkinId ?? index}-${visitor.enteredAt}`}>
            <View style={{ gap: spacing[2] }}>
              <View
                style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing[2] }}
              >
                <Text
                  style={{
                    flex: 1,
                    fontSize: typography.size.md,
                    fontWeight: typography.weight.semibold,
                    color: colors.semantic.text,
                  }}
                >
                  {displayName}
                </Text>
                {isOverstay ? (
                  <StatusPill tone="warning" label={t('mm.security.overstay')} />
                ) : null}
              </View>
              <Text style={{ fontSize: typography.size.sm, color: colors.semantic.textMuted }}>
                {[
                  t('mm.security.enteredAt', { time: formatTime(visitor.enteredAt) }),
                  gateName(visitor.gateId),
                  visitor.vehiclePlate,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
              {canFlag ? (
                <ActionButton
                  label={t('mm.security.flagVisitor')}
                  variant="outline"
                  icon={<Icon name="flag-outline" color={colors.brand.primary} size={18} />}
                  onPress={() => {
                    setReason('');
                    setFlagging({ name: displayName, plate: visitor.vehiclePlate ?? null });
                  }}
                />
              ) : null}
            </View>
          </Card>
        );
      })}
      <ConfirmModal
        visible={flagging !== null}
        title={t('mm.security.flagTitle', { name: flagging?.name ?? '' })}
        body={t('mm.security.flagBody')}
        confirmLabel={t('mm.security.flagVisitor')}
        destructive
        busy={flag.isPending}
        error={flag.isError ? errorText(flag.error) : null}
        reason={{
          label: t('mm.security.flagReason'),
          value: reason,
          onChange: setReason,
          required: true,
        }}
        onConfirm={() => {
          if (flagging && reason.trim().length >= 3) flag.mutate(flagging);
        }}
        onCancel={() => {
          setFlagging(null);
          flag.reset();
        }}
      />
    </>
  );
}

function Walkins({ gateName, search }: { gateName: (id: string) => string; search: string }) {
  const { estateId } = useManager();
  const walkins = useQuery({
    queryKey: ['estate', estateId, 'walkins', 'pending'],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/walkins', {
          params: { path: { estateId }, query: { status: 'pending', limit: 50 } },
        }),
      ),
    refetchInterval: LIVE_MS,
  });
  const items = (walkins.data?.items ?? []).filter((walkin) =>
    matchesVisitor(search, [walkin.visitorName, walkin.vehiclePlate, walkin.unitCode]),
  );
  return (
    <>
      <QueryStates
        query={walkins}
        empty={items.length === 0}
        emptyTitle={t('liveGate.walkins.empty.title')}
        emptyBody={t('liveGate.walkins.empty.body')}
      />
      {items.map((walkin) => (
        <ListRow
          key={walkin.id}
          title={walkin.visitorName}
          subtitle={[
            walkin.unitCode,
            gateName(walkin.gateId),
            walkin.purpose,
            t('mm.security.expires', { time: formatTime(walkin.expiresAt) }),
          ]
            .filter(Boolean)
            .join(' · ')}
          leading={<Icon name="walk-outline" color={colors.brand.primary} size={20} />}
          trailing={
            <StatusPill
              tone={WALKIN_TONE[walkin.status]}
              label={t(`liveGate.walkins.status.${walkin.status}` as MessageKey)}
            />
          }
        />
      ))}
    </>
  );
}

function SosList() {
  const router = useRouter();
  const { estateId } = useManager();
  const active = useActiveSos();
  const history = useQuery({
    queryKey: ['estate', estateId, 'sos', 'all'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/sos', {
          params: { path: { estateId }, query: { status: 'all', limit: 20 } },
        }),
      ),
    refetchInterval: 60_000,
  });
  const activeIds = new Set((active.data ?? []).map((alert) => alert.id));
  const past = (history.data ?? []).filter((alert) => !activeIds.has(alert.id));
  const row = (alert: NonNullable<typeof history.data>[number]) => (
    <ListRow
      key={alert.id}
      title={`${alert.isDrill ? `${t('sos.drill')} ` : ''}${categoryText(alert.category)} · ${
        alert.unitCode ?? t('sos.unknownUnit')
      }`}
      subtitle={formatDateTime(alert.triggeredAt)}
      leading={<Icon name="warning-outline" color={colors.status.danger} size={20} />}
      trailing={<StatusPill tone={SOS_TONE[alert.status]} label={sosStatusText(alert.status)} />}
      onPress={() => router.push(`/sos/${alert.id}`)}
    />
  );
  return (
    <>
      <Text accessibilityRole="header" style={{ fontWeight: '700', color: colors.semantic.text }}>
        {t('sos.console.active')}
      </Text>
      <QueryStates
        query={active}
        empty={(active.data ?? []).length === 0}
        emptyTitle={t('sos.console.emptyActive')}
        emptyBody={t('sos.console.emptyActiveBody')}
      />
      {(active.data ?? []).map(row)}
      <Text accessibilityRole="header" style={{ fontWeight: '700', color: colors.semantic.text }}>
        {t('sos.console.history')}
      </Text>
      {history.isPending ? <Skeleton height={64} /> : null}
      {history.data && past.length === 0 ? (
        <Text style={{ color: colors.semantic.textMuted }}>{t('sos.console.emptyHistory')}</Text>
      ) : null}
      {past.map(row)}
    </>
  );
}

/** Live gate feed, expected visitors, inside/overstaying, walk-ins and SOS (management-mobile.md §6 tab 3). */
export default function SecurityScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { estateId, can, hasFeature } = useManager();
  const canSos = useCanRespondToSos();
  const canGate = hasFeature('visitors') && can('visitor.log.read');
  const canIncidents = hasFeature('security') && (can('incident.manage') || can('incident.report'));
  const canShifts = hasFeature('security') && can('security.staff.manage');
  const options = useMemo(
    () =>
      [
        canGate ? { key: 'activity' as const, label: t('mm.security.tab.activity') } : null,
        canGate ? { key: 'expected' as const, label: t('mm.security.tab.expected') } : null,
        canGate ? { key: 'inside' as const, label: t('mm.security.tab.inside') } : null,
        canGate ? { key: 'walkins' as const, label: t('mm.security.tab.walkins') } : null,
        canSos ? { key: 'sos' as const, label: t('mm.security.tab.sos') } : null,
      ].filter((option): option is { key: SecurityView; label: string } => option !== null),
    [canGate, canSos],
  );
  const [view, setView] = useState<SecurityView | null>(null);
  const current = view && options.some((option) => option.key === view) ? view : options[0]?.key;
  const [search, setSearch] = useState('');
  const gates = useGates();
  const [gateId, setGateId] = useState<string | null>(null);
  const [activityGate, setActivityGate] = useState<string>('all');
  const activeGate = gateId ?? gates.data?.[0]?.id ?? null;
  const gateName = (id: string) => gates.data?.find((gate) => gate.id === id)?.name ?? '';
  const pull = usePullRefresh(() =>
    Promise.all([
      queryClient.refetchQueries({ queryKey: ['estate', estateId, 'gate-events'] }),
      queryClient.refetchQueries({ queryKey: ['estate', estateId, 'gate'] }),
      queryClient.refetchQueries({ queryKey: ['estate', estateId, 'walkins'] }),
      queryClient.refetchQueries({ queryKey: ['estate', estateId, 'sos'] }),
    ]),
  );

  return (
    <ScrollScreen {...pull}>
      <ScreenHeader title={t('mm.security.title')} />
      {canIncidents ? (
        <ListRow
          title={t('mm.incidents.title')}
          subtitle={t('mm.incidents.subtitle')}
          leading={<Icon name="document-text-outline" color={colors.brand.primary} size={20} />}
          trailing={<Icon name="chevron-forward" color={colors.semantic.textMuted} size={20} />}
          onPress={() => router.push('/incidents')}
        />
      ) : null}
      {canShifts ? (
        <ListRow
          title={t('mm.security.shiftsTitle')}
          subtitle={t('mm.security.shiftsSubtitle')}
          leading={<Icon name="time-outline" color={colors.brand.primary} size={20} />}
          trailing={<Icon name="chevron-forward" color={colors.semantic.textMuted} size={20} />}
          onPress={() => router.push('/security-shifts')}
        />
      ) : null}
      {!current ? (
        <EmptyState
          icon={<Icon name="lock-closed-outline" size={28} color={colors.brand.primary} />}
          title={t('mm.security.noAccess')}
          body={t('mm.security.noAccessBody')}
        />
      ) : (
        <>
          <Segmented
            label={t('mm.security.title')}
            options={options}
            value={current}
            onChange={setView}
          />
          {current !== 'sos' ? (
            <TextField
              label={t('common.search')}
              placeholder={t('mm.security.searchPlaceholder')}
              value={search}
              onChangeText={setSearch}
              autoCapitalize="none"
            />
          ) : null}
          {current === 'activity' && (gates.data?.length ?? 0) > 1 ? (
            <ChipGroup
              label={t('visitorLog.filter.gate')}
              options={[
                { key: 'all', label: t('mm.security.allGates') },
                ...(gates.data ?? []).map((gate) => ({ key: gate.id, label: gate.name })),
              ]}
              value={activityGate}
              onChange={setActivityGate}
            />
          ) : null}
          {current === 'expected' && (gates.data?.length ?? 0) > 1 ? (
            <ChipGroup
              label={t('visitorLog.filter.gate')}
              options={(gates.data ?? []).map((gate) => ({ key: gate.id, label: gate.name }))}
              value={activeGate}
              onChange={setGateId}
            />
          ) : null}
          {current === 'activity' ? (
            <Activity gateId={activityGate} gateName={gateName} search={search} />
          ) : null}
          {current === 'expected' ? <Expected gateId={activeGate} search={search} /> : null}
          {current === 'inside' ? <Inside gateName={gateName} search={search} /> : null}
          {current === 'walkins' ? <Walkins gateName={gateName} search={search} /> : null}
          {current === 'sos' ? <SosList /> : null}
        </>
      )}
    </ScrollScreen>
  );
}
