import { unwrap, unwrapPage } from '@safezone/api-client';
import { colors, radii, spacing, touchTarget, typography } from '@safezone/design-tokens';
import { formatDateTime, formatElapsed, formatKobo, startOfTodayWat, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  Card,
  ScrollScreen,
  SectionHeader,
  Skeleton,
} from '@safezone/mobile-ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { EstateSwitcherModal } from '../../src/components/estate-switcher';
import { Icon } from '../../src/components/icon';
import { StatTile } from '../../src/components/stat-tile';
import { useApprovals } from '../../src/features/approvals';
import {
  categoryText,
  sosStatusText,
  useActiveSos,
  useCanRespondToSos,
} from '../../src/features/sos';
import { monthToDateWat } from '../../src/lib/dates';
import { errorText, isNetworkError } from '../../src/lib/errors';
import { useManager } from '../../src/lib/manager';
import { useUnreadNotifications } from '../../src/lib/notifications';
import { api } from '../../src/lib/session';
import { useNow } from '../../src/lib/use-now';

function countText(count: number | undefined, more = false): string {
  if (count === undefined) return '-';
  return more ? `${count}+` : String(count);
}

function Header() {
  const router = useRouter();
  const { estateName, memberships } = useManager();
  const unread = useUnreadNotifications();
  const [switching, setSwitching] = useState(false);
  const canSwitch = memberships.length > 1;
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole={canSwitch ? 'button' : 'header'}
        accessibilityLabel={
          canSwitch ? t('mm.home.switchEstate', { estate: estateName }) : estateName
        }
        disabled={!canSwitch}
        onPress={() => setSwitching(true)}
        style={styles.estate}
      >
        <Text style={styles.overline}>{t('management.home.title')}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[1] }}>
          <Text style={styles.estateName} numberOfLines={1}>
            {estateName}
          </Text>
          {canSwitch ? <Icon name="chevron-down" size={18} color={colors.brand.primary} /> : null}
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          unread > 0
            ? t('mm.notifications.bellUnread', { count: unread })
            : t('mm.notifications.title')
        }
        onPress={() => router.push('/notifications')}
        style={styles.bell}
      >
        <Icon name="notifications-outline" size={24} color={colors.semantic.text} />
        {unread > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text>
          </View>
        ) : null}
      </Pressable>
      <EstateSwitcherModal visible={switching} onClose={() => setSwitching(false)} />
    </View>
  );
}

/** Red card for each active alert, above everything else. */
function ActiveSos() {
  const router = useRouter();
  const active = useActiveSos();
  const now = useNow();
  const alerts = active.data ?? [];
  if (alerts.length === 0) return null;
  return (
    <View style={{ gap: spacing[2] }} accessibilityLiveRegion="assertive">
      {alerts.map((alert) => (
        <Pressable
          key={alert.id}
          accessibilityRole="button"
          accessibilityLabel={t('mm.home.sosCard', {
            category: categoryText(alert.category),
            unit: alert.unitCode ?? t('sos.unknownUnit'),
          })}
          onPress={() => router.push(`/sos/${alert.id}`)}
          style={styles.sosCard}
        >
          <Icon name="warning" size={28} color={colors.neutral[0]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.sosTitle}>
              {alert.isDrill ? `${t('sos.drill')} ` : ''}
              {categoryText(alert.category)} · {alert.unitCode ?? t('sos.unknownUnit')}
            </Text>
            <Text style={styles.sosMeta}>
              {sosStatusText(alert.status)} · {formatElapsed(alert.triggeredAt, now)}
            </Text>
          </View>
          <Icon name="chevron-forward" size={22} color={colors.neutral[0]} />
        </Pressable>
      ))}
    </View>
  );
}

function Stats() {
  const router = useRouter();
  const { estateId, can, hasFeature } = useManager();
  const canSos = useCanRespondToSos();
  const sos = useActiveSos();
  const approvals = useApprovals();
  const today = startOfTodayWat();
  const showGate = can('visitor.log.read') && hasFeature('visitors');
  const gate = useQuery({
    queryKey: ['estate', estateId, 'gate-events', 'today', today],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/gate/events', {
          params: { path: { estateId }, query: { from: today, limit: 100 } },
        }),
      ),
    enabled: showGate,
    refetchInterval: 30_000,
  });
  const showIncidents =
    hasFeature('security') && (can('incident.manage') || can('incident.report'));
  const incidents = useQuery({
    queryKey: ['estate', estateId, 'incidents', 'open', 'count'],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/incidents', {
          params: { path: { estateId }, query: { open: 'true', limit: 50 } },
        }),
      ),
    enabled: showIncidents,
    refetchInterval: 60_000,
  });
  const showMaintenance = hasFeature('maintenance') && can('maintenance.assign');
  const maintenance = useQuery({
    queryKey: ['estate', estateId, 'maintenance-requests', 'open', 'count'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/maintenance-requests', {
          params: { path: { estateId }, query: { limit: 50 } },
        }),
      ),
    enabled: showMaintenance,
    refetchInterval: 60_000,
  });
  const showBookings = hasFeature('facilities') && can('facility.manage');
  const bookings = useQuery({
    queryKey: ['estate', estateId, 'bookings', 'confirmed', 'count'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/bookings', {
          params: { path: { estateId }, query: { status: 'confirmed' } },
        }),
      ),
    enabled: showBookings,
    refetchInterval: 60_000,
  });
  const entries = gate.data?.items.filter(
    (event) => event.direction === 'in' && event.decision !== 'deny',
  );
  const openMaintenance = maintenance.data?.filter(
    (req) => !['resolved', 'closed', 'rejected', 'cancelled'].includes(req.status),
  );
  const activeCount = sos.data?.length;

  return (
    <View style={styles.grid}>
      {canSos ? (
        <StatTile
          icon="warning-outline"
          label={t('dashboard.stat.activeSos')}
          value={countText(activeCount)}
          alert={(activeCount ?? 0) > 0}
          onPress={() => router.push('/security')}
        />
      ) : null}
      {approvals.anyAllowed ? (
        <StatTile
          icon="checkmark-done-outline"
          label={t('mm.home.pendingApprovals')}
          value={approvals.isPending ? '-' : String(approvals.items.length)}
          onPress={() => router.push('/approvals')}
        />
      ) : null}
      {showGate ? (
        <StatTile
          icon="enter-outline"
          label={t('dashboard.stat.entriesToday')}
          value={countText(entries?.length, Boolean(gate.data?.nextCursor))}
          onPress={() => router.push('/security')}
        />
      ) : null}
      {showIncidents ? (
        <StatTile
          icon="document-text-outline"
          label={t('mm.home.openIncidents')}
          value={countText(incidents.data?.items.length, Boolean(incidents.data?.nextCursor))}
          onPress={() => router.push('/incidents')}
        />
      ) : null}
      {showMaintenance ? (
        <StatTile
          icon="construct-outline"
          label={t('mm.home.openMaintenance')}
          value={countText(openMaintenance?.length)}
          onPress={() => router.push('/estate?section=maintenance')}
        />
      ) : null}
      {showBookings ? (
        <StatTile
          icon="calendar-outline"
          label={t('mm.home.upcomingBookings')}
          value={countText(bookings.data?.length)}
          onPress={() => router.push('/estate?section=facilities')}
        />
      ) : null}
    </View>
  );
}

function MonthSummary() {
  const router = useRouter();
  const { estateId, can, hasFeature } = useManager();
  const range = monthToDateWat();
  const allowed = can('report.read');
  const summary = useQuery({
    queryKey: ['estate', estateId, 'reports', 'summary', range.from, range.to],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/reports/summary', {
          params: { path: { estateId }, query: range },
        }),
      ),
    enabled: allowed,
  });
  if (!allowed) return null;
  if (summary.isPending) return <Skeleton height={120} />;
  if (summary.isError)
    return isNetworkError(summary.error) ? null : (
      <Banner tone="warning">{errorText(summary.error)}</Banner>
    );
  const { occupancy, finance } = summary.data;
  const showFinance = hasFeature('billing') && finance.billedKobo > 0;
  return (
    <Card>
      <View style={{ gap: spacing[3] }}>
        <Text style={styles.cardTitle}>{t('mm.home.monthTitle')}</Text>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>{t('mm.home.occupancy')}</Text>
          <Text style={styles.summaryValue}>
            {t('mm.home.occupancyValue', {
              occupied: occupancy.occupiedUnits,
              total: occupancy.totalUnits,
            })}
          </Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>{t('mm.home.residents')}</Text>
          <Text style={styles.summaryValue}>{occupancy.activeResidents}</Text>
        </View>
        {showFinance ? (
          <>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>{t('mm.home.collected')}</Text>
              <Text style={styles.summaryValue}>
                {t('mm.home.collectedValue', {
                  collected: formatKobo(finance.collectedKobo),
                  billed: formatKobo(finance.billedKobo),
                })}
              </Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>{t('mm.home.outstanding')}</Text>
              <Text style={styles.summaryValue}>{formatKobo(finance.outstandingKobo)}</Text>
            </View>
          </>
        ) : null}
        <ActionButton
          label={t('mm.home.viewReports')}
          variant="text"
          onPress={() => router.push('/reports')}
        />
      </View>
    </Card>
  );
}

function LatestAnnouncements() {
  const router = useRouter();
  const { estateId, hasFeature } = useManager();
  const list = useQuery({
    queryKey: ['estate', estateId, 'announcements', 'latest'],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/announcements', {
          params: { path: { estateId }, query: { all: 'true', limit: 3 } },
        }),
      ),
    enabled: hasFeature('announcements'),
  });
  if (!hasFeature('announcements')) return null;
  return (
    <View style={{ gap: spacing[2] }}>
      <SectionHeader
        title={t('dashboard.announcements.title')}
        action={
          <ActionButton
            label={t('dashboard.viewAll')}
            variant="text"
            onPress={() => router.push('/announcements')}
          />
        }
      />
      {list.isPending ? <Skeleton height={64} /> : null}
      {list.data && list.data.items.length === 0 ? (
        <Text style={styles.muted}>{t('dashboard.announcements.empty')}</Text>
      ) : null}
      {list.data?.items.map((item) => (
        <Card key={item.id}>
          <Text style={styles.cardTitle}>{item.title}</Text>
          <Text style={styles.muted}>{formatDateTime(item.publishedAt)}</Text>
        </Card>
      ))}
    </View>
  );
}

/** Permission-aware dashboard (management-mobile.md §6, tab 1). */
export default function HomeScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const queryClient = useQueryClient();
  return (
    <ScrollScreen
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void queryClient.refetchQueries({ type: 'active' }).finally(() => setRefreshing(false));
      }}
    >
      <Header />
      <ActiveSos />
      <Stats />
      <MonthSummary />
      <LatestAnnouncements />
    </ScrollScreen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  estate: { flex: 1, minHeight: touchTarget.default, justifyContent: 'center' },
  overline: { fontSize: typography.size.sm, color: colors.semantic.textMuted },
  estateName: {
    flexShrink: 1,
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    color: colors.brand.primary,
  },
  bell: {
    width: touchTarget.default,
    height: touchTarget.default,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 6,
    right: 4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.status.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: colors.neutral[0], fontSize: 11, fontWeight: typography.weight.bold },
  sosCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: touchTarget.security,
    padding: spacing[4],
    borderRadius: radii.lg,
    backgroundColor: colors.status.danger,
  },
  sosTitle: {
    color: colors.neutral[0],
    fontSize: typography.size.lg,
    fontWeight: typography.weight.bold,
  },
  sosMeta: { color: colors.neutral[0], fontSize: typography.size.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3] },
  cardTitle: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
    color: colors.semantic.text,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing[3] },
  summaryLabel: { fontSize: typography.size.sm, color: colors.semantic.textMuted },
  summaryValue: {
    flexShrink: 1,
    textAlign: 'right',
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
    color: colors.semantic.text,
    fontVariant: ['tabular-nums'],
  },
  muted: { fontSize: typography.size.sm, color: colors.semantic.textMuted },
});
