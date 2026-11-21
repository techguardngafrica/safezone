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
import { usePullRefresh } from '../../src/lib/use-pull-refresh';

type SecurityView = 'activity' | 'expected' | 'walkins' | 'sos';
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

function Activity({ gateName, search }: { gateName: (id: string) => string; search: string }) {
  const { estateId } = useManager();
  const events = useQuery({
    queryKey: ['estate', estateId, 'gate-events', 'live'],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/gate/events', {
          params: { path: { estateId }, query: { limit: 50 } },
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

/** Live gate feed, expected visitors, walk-ins and SOS (management-mobile.md §6 tab 3, §7.1-7.2). */
export default function SecurityScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { estateId, can, hasFeature } = useManager();
  const canSos = useCanRespondToSos();
  const canGate = hasFeature('visitors') && can('visitor.log.read');
  const canIncidents = hasFeature('security') && (can('incident.manage') || can('incident.report'));
  const options = useMemo(
    () =>
      [
        canGate ? { key: 'activity' as const, label: t('mm.security.tab.activity') } : null,
        canGate ? { key: 'expected' as const, label: t('mm.security.tab.expected') } : null,
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
          {current === 'expected' && (gates.data?.length ?? 0) > 1 ? (
            <ChipGroup
              label={t('visitorLog.filter.gate')}
              options={(gates.data ?? []).map((gate) => ({ key: gate.id, label: gate.name }))}
              value={activeGate}
              onChange={setGateId}
            />
          ) : null}
          {current === 'activity' ? <Activity gateName={gateName} search={search} /> : null}
          {current === 'expected' ? <Expected gateId={activeGate} search={search} /> : null}
          {current === 'walkins' ? <Walkins gateName={gateName} search={search} /> : null}
          {current === 'sos' ? <SosList /> : null}
        </>
      )}
    </ScrollScreen>
  );
}
