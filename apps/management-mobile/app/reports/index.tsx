import { unwrap } from '@safezone/api-client';
import { colors, spacing, typography } from '@safezone/design-tokens';
import { formatKobo, t } from '@safezone/i18n';
import {
  Banner,
  Card,
  ErrorState,
  ScreenHeader,
  ScrollScreen,
  Segmented,
  Skeleton,
} from '@safezone/mobile-ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from '../../src/components/icon';
import { monthToDateWat } from '../../src/lib/dates';
import { errorText, isNetworkError } from '../../src/lib/errors';
import { useManager } from '../../src/lib/manager';
import { api } from '../../src/lib/session';
import { usePullRefresh } from '../../src/lib/use-pull-refresh';

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

function last30DaysRange(): { from: string; to: string } {
  const now = new Date();
  const start = new Date(now.getTime() - 30 * 86_400_000);
  return { from: start.toISOString(), to: now.toISOString() };
}

/** Operational summaries (management-mobile.md §4 Reports, §6 More). */
export default function ReportsScreen() {
  const router = useRouter();
  const { estateId, can, hasFeature } = useManager();
  const allowed = can('report.read');
  const [period, setPeriod] = useState<'month' | 'last30'>('month');
  const range = useMemo(
    () => (period === 'month' ? monthToDateWat() : last30DaysRange()),
    [period],
  );

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

  const maintenance = useQuery({
    queryKey: ['estate', estateId, 'reports', 'maintenance', range.from, range.to],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/reports/maintenance', {
          params: { path: { estateId }, query: range },
        }),
      ),
    enabled: allowed && hasFeature('maintenance'),
  });

  const facilities = useQuery({
    queryKey: ['estate', estateId, 'reports', 'facilities', range.from, range.to],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/reports/facilities', {
          params: { path: { estateId }, query: range },
        }),
      ),
    enabled: allowed && hasFeature('facilities'),
  });

  const pull = usePullRefresh(() =>
    Promise.all([summary.refetch(), maintenance.refetch(), facilities.refetch()]),
  );

  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']} {...pull}>
      <ScreenHeader
        title={t('mm.reports.title')}
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />
      <Segmented
        label={t('mm.reports.title')}
        value={period}
        onChange={setPeriod}
        options={[
          { key: 'month', label: t('mm.reports.period.month') },
          { key: 'last30', label: t('mm.reports.period.last30') },
        ]}
      />
      {summary.isPending ? (
        <>
          <Skeleton height={120} />
          <Skeleton height={120} />
        </>
      ) : null}
      {summary.isError ? (
        isNetworkError(summary.error) ? (
          <Banner tone="warning">{t('mm.offline.cached')}</Banner>
        ) : (
          <ErrorState message={errorText(summary.error)} onRetry={() => void summary.refetch()} />
        )
      ) : null}
      {summary.data ? (
        <>
          <Card>
            <View style={{ gap: spacing[2] }}>
              <Text style={styles.title}>{t('mm.reports.section.occupancy')}</Text>
              <Row
                label={t('mm.home.occupancy')}
                value={t('mm.home.occupancyValue', {
                  occupied: summary.data.occupancy.occupiedUnits,
                  total: summary.data.occupancy.totalUnits,
                })}
              />
              <Row label={t('mm.reports.vacantUnits')} value={summary.data.occupancy.vacantUnits} />
              <Row
                label={t('mm.reports.households')}
                value={summary.data.occupancy.activeHouseholds}
              />
              <Row label={t('mm.home.residents')} value={summary.data.occupancy.activeResidents} />
            </View>
          </Card>

          <Card>
            <View style={{ gap: spacing[2] }}>
              <Text style={styles.title}>{t('mm.reports.section.visitors')}</Text>
              <Row label={t('mm.reports.entries')} value={summary.data.visitors.entries} />
              <Row label={t('mm.reports.exits')} value={summary.data.visitors.exits} />
              <Row label={t('mm.reports.denials')} value={summary.data.visitors.denials} />
              <Row
                label={t('mm.reports.activePasses')}
                value={summary.data.visitors.activePasses}
              />
            </View>
          </Card>

          <Card>
            <View style={{ gap: spacing[2] }}>
              <Text style={styles.title}>{t('mm.reports.section.security')}</Text>
              <Row
                label={t('mm.reports.incidentsTotal')}
                value={`${summary.data.incidents.open} / ${summary.data.incidents.total}`}
              />
              <Row
                label={t('mm.reports.sosTotal')}
                value={`${summary.data.sos.realAlerts} / ${summary.data.sos.drills}`}
              />
              {summary.data.sos.avgAckSeconds !== null ? (
                <Row
                  label={t('mm.reports.sosAvgAck')}
                  value={t('mm.reports.secondsValue', {
                    seconds: Math.round(summary.data.sos.avgAckSeconds),
                  })}
                />
              ) : null}
              <Row
                label={t('mm.reports.shifts')}
                value={`${summary.data.attendance.openShifts} / ${summary.data.attendance.totalShifts}`}
              />
            </View>
          </Card>

          {hasFeature('billing') ? (
            <Card>
              <View style={{ gap: spacing[2] }}>
                <Text style={styles.title}>{t('mm.reports.section.finance')}</Text>
                <Row
                  label={t('mm.finance.billed')}
                  value={formatKobo(summary.data.finance.billedKobo)}
                />
                <Row
                  label={t('mm.finance.collected')}
                  value={formatKobo(summary.data.finance.collectedKobo)}
                />
                <Row
                  label={t('mm.finance.outstanding')}
                  value={formatKobo(summary.data.finance.outstandingKobo)}
                />
              </View>
            </Card>
          ) : null}
        </>
      ) : null}

      {hasFeature('maintenance') && maintenance.data ? (
        <Card>
          <View style={{ gap: spacing[2] }}>
            <Text style={styles.title}>{t('mm.reports.section.maintenance')}</Text>
            <Row label={t('mm.reports.maintSubmitted')} value={maintenance.data.submitted} />
            <Row label={t('mm.reports.maintOpen')} value={maintenance.data.open} />
            <Row label={t('mm.reports.maintResolved')} value={maintenance.data.resolved} />
            {maintenance.data.slaCompliancePercent !== null ? (
              <Row
                label={t('mm.reports.maintSla')}
                value={`${Math.round(maintenance.data.slaCompliancePercent)}%`}
              />
            ) : null}
            {maintenance.data.averageResolutionHours !== null ? (
              <Row
                label={t('mm.reports.maintAvgHours')}
                value={t('mm.reports.hoursValue', {
                  hours: Math.round(maintenance.data.averageResolutionHours * 10) / 10,
                })}
              />
            ) : null}
          </View>
        </Card>
      ) : null}

      {hasFeature('facilities') && facilities.data ? (
        <Card>
          <View style={{ gap: spacing[2] }}>
            <Text style={styles.title}>{t('mm.reports.section.facilities')}</Text>
            {facilities.data.facilities.length === 0 ? (
              <Text style={styles.label}>{t('mm.reports.facilitiesEmpty')}</Text>
            ) : (
              facilities.data.facilities.map((fac) => (
                <Row
                  key={fac.facilityId}
                  label={fac.name}
                  value={t('mm.reports.facilityBookings', {
                    bookings: fac.bookings,
                    hours: Math.round(fac.bookedHours * 10) / 10,
                    revenue: formatKobo(fac.revenue),
                  })}
                />
              ))
            )}
          </View>
        </Card>
      ) : null}
    </ScrollScreen>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
    color: colors.semantic.text,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing[3] },
  label: { fontSize: typography.size.sm, color: colors.semantic.textMuted, flexShrink: 1 },
  value: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
    color: colors.semantic.text,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
});
