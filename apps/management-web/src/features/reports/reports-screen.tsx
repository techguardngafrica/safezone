'use client';

import { unwrap } from '@safezone/api-client';
import { formatKobo, t } from '@safezone/i18n';
import {
  ActionButton,
  DataTable,
  ErrorState,
  InputField,
  PageHeader,
  Panel,
  Skeleton,
  StatCard,
  Tabs,
  Toolbar,
} from '@safezone/web-ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useEstate } from '../../../lib/estate';
import { errorText } from '../../../lib/errors';
import { api } from '../../../lib/session';

type ReportTab = 'overview' | 'finance' | 'security' | 'operations';

function defaultRange() {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 86_400_000);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows
    .map((cols) => cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function ReportsScreen() {
  const { estateId, hasFeature } = useEstate();
  const initial = defaultRange();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [tab, setTab] = useState<ReportTab>('overview');

  const summary = useQuery({
    queryKey: ['estate', estateId, 'reports', 'summary', from, to],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/reports/summary', {
          params: { path: { estateId }, query: { from, to } },
        }),
      ),
  });

  const maintenance = useQuery({
    queryKey: ['estate', estateId, 'reports', 'maintenance', from, to],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/reports/maintenance', {
          params: { path: { estateId }, query: { from, to } },
        }),
      ),
    enabled: tab === 'operations' && hasFeature('maintenance'),
  });

  const facilities = useQuery({
    queryKey: ['estate', estateId, 'reports', 'facilities', from, to],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/reports/facilities', {
          params: { path: { estateId }, query: { from, to } },
        }),
      ),
    enabled: tab === 'operations' && hasFeature('facilities'),
  });

  const exportSummary = () => {
    const data = summary.data;
    if (!data) return;
    downloadCsv(`safezone-report-${from}-to-${to}.csv`, [
      ['Section', 'Metric', 'Value'],
      ['Occupancy', 'Total units', String(data.occupancy.totalUnits)],
      ['Occupancy', 'Occupied units', String(data.occupancy.occupiedUnits)],
      ['Occupancy', 'Vacant units', String(data.occupancy.vacantUnits)],
      ['Occupancy', 'Active households', String(data.occupancy.activeHouseholds)],
      ['Occupancy', 'Active residents', String(data.occupancy.activeResidents)],
      ['Visitors', 'Gate events', String(data.visitors.totalEvents)],
      ['Visitors', 'Entries', String(data.visitors.entries)],
      ['Visitors', 'Exits', String(data.visitors.exits)],
      ['Visitors', 'Denials', String(data.visitors.denials)],
      ['Visitors', 'Overrides', String(data.visitors.overrides)],
      ['Incidents', 'Total', String(data.incidents.total)],
      ['Incidents', 'Open', String(data.incidents.open)],
      ['SOS', 'Real alerts', String(data.sos.realAlerts)],
      ['SOS', 'Avg ack (s)', String(data.sos.avgAckSeconds ?? '-')],
      ['Finance', 'Billed (kobo)', String(data.finance.billedKobo)],
      ['Finance', 'Collected (kobo)', String(data.finance.collectedKobo)],
      ['Finance', 'Outstanding (kobo)', String(data.finance.outstandingKobo)],
      ['Attendance', 'Total shifts', String(data.attendance.totalShifts)],
      ['Attendance', 'Total minutes', String(data.attendance.totalMinutes)],
    ]);
  };

  const data = summary.data;

  return (
    <>
      <PageHeader
        title={t('reports.title')}
        description={t('reports.description')}
        actions={
          <ActionButton variant="outline" icon="download" disabled={!data} onClick={exportSummary}>
            {t('common.export')}
          </ActionButton>
        }
      />

      <Toolbar>
        <InputField label={t('reports.from')} type="date" value={from} onChange={setFrom} />
        <InputField label={t('reports.to')} type="date" value={to} onChange={setTo} />
      </Toolbar>

      <Tabs<ReportTab>
        label={t('reports.title')}
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'overview', label: t('reports.tab.overview') },
          { key: 'finance', label: t('reports.tab.finance') },
          { key: 'security', label: t('reports.tab.security') },
          { key: 'operations', label: t('reports.tab.operations') },
        ]}
      />

      {summary.isPending ? (
        <div style={{ display: 'grid', gap: 16 }}>
          <Skeleton height={100} />
          <Skeleton height={220} />
        </div>
      ) : summary.isError ? (
        <ErrorState message={errorText(summary.error)} onRetry={() => void summary.refetch()} />
      ) : data ? (
        <>
          {tab === 'overview' ? (
            <div style={{ display: 'grid', gap: 20 }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: 16,
                }}
              >
                <StatCard
                  label={t('reports.kpi.occupancy')}
                  value={`${data.occupancy.occupiedUnits} / ${data.occupancy.totalUnits}`}
                />
                <StatCard
                  label={t('reports.kpi.residents')}
                  value={String(data.occupancy.activeResidents)}
                />
                <StatCard
                  label={t('reports.kpi.gateEvents')}
                  value={String(data.visitors.totalEvents)}
                />
                <StatCard label={t('reports.kpi.incidents')} value={String(data.incidents.open)} />
                <StatCard
                  label={t('reports.kpi.collected')}
                  value={formatKobo(data.finance.collectedKobo)}
                />
                <StatCard
                  label={t('reports.kpi.shifts')}
                  value={`${(data.attendance.totalMinutes / 60).toFixed(1)} h`}
                />
              </div>
            </div>
          ) : null}

          {tab === 'finance' ? (
            <div style={{ display: 'grid', gap: 20 }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: 16,
                }}
              >
                <StatCard
                  label={t('reports.kpi.billed')}
                  value={formatKobo(data.finance.billedKobo)}
                />
                <StatCard
                  label={t('reports.kpi.collected')}
                  value={formatKobo(data.finance.collectedKobo)}
                />
                <StatCard
                  label={t('reports.kpi.outstanding')}
                  value={formatKobo(data.finance.outstandingKobo)}
                />
              </div>
              <DataTable
                caption="Arrears ageing"
                rows={[
                  { bucket: 'Current (not yet due)', amount: data.finance.ageing.currentKobo },
                  { bucket: '1 - 30 days overdue', amount: data.finance.ageing.days30Kobo },
                  { bucket: '31 - 60 days overdue', amount: data.finance.ageing.days60Kobo },
                  { bucket: '61+ days overdue', amount: data.finance.ageing.days90PlusKobo },
                ]}
                rowKey={(r) => r.bucket}
                columns={[
                  { key: 'bucket', header: 'Ageing bucket', render: (r) => r.bucket },
                  {
                    key: 'amount',
                    header: 'Outstanding',
                    align: 'right',
                    render: (r) => <span className="sz-num">{formatKobo(r.amount)}</span>,
                  },
                ]}
                empty={{ icon: 'receipt', title: 'No arrears', body: '' }}
              />
            </div>
          ) : null}

          {tab === 'security' ? (
            <div style={{ display: 'grid', gap: 20 }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: 16,
                }}
              >
                <StatCard
                  label={t('reports.kpi.gateEvents')}
                  value={`${data.visitors.entries} in / ${data.visitors.exits} out`}
                />
                <StatCard
                  label={t('reports.sos.avgAck')}
                  value={data.sos.avgAckSeconds !== null ? `${data.sos.avgAckSeconds}s` : '-'}
                />
                <StatCard
                  label={t('reports.sos.avgResolve')}
                  value={
                    data.sos.avgResolveSeconds !== null ? `${data.sos.avgResolveSeconds}s` : '-'
                  }
                />
                <StatCard
                  label={t('reports.kpi.shifts')}
                  value={`${data.attendance.totalShifts} (${data.attendance.openShifts} open)`}
                />
              </div>
              <DataTable
                caption="Incidents by severity"
                rows={data.incidents.bySeverity}
                rowKey={(r) => r.severity}
                columns={[
                  { key: 'severity', header: 'Severity', render: (r) => r.severity },
                  {
                    key: 'count',
                    header: 'Count',
                    align: 'right',
                    render: (r) => <span className="sz-num">{r.count}</span>,
                  },
                ]}
                empty={{ icon: 'flag', title: 'No incidents in period', body: '' }}
              />
            </div>
          ) : null}

          {tab === 'operations' ? (
            <div style={{ display: 'grid', gap: 20 }}>
              <Panel title="Maintenance performance">
                {maintenance.isPending ? (
                  <Skeleton height={80} />
                ) : maintenance.data ? (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                      gap: 12,
                    }}
                  >
                    <StatCard label="Submitted" value={String(maintenance.data.submitted)} />
                    <StatCard label="Resolved" value={String(maintenance.data.resolved)} />
                    <StatCard
                      label="SLA met"
                      value={
                        maintenance.data.slaCompliancePercent !== null
                          ? `${Math.round(maintenance.data.slaCompliancePercent)}%`
                          : '-'
                      }
                    />
                    <StatCard label="Open requests" value={String(maintenance.data.open)} />
                  </div>
                ) : (
                  <p className="sz-muted" style={{ margin: 0 }}>
                    Maintenance module not enabled.
                  </p>
                )}
              </Panel>
              <Panel title="Facility utilisation">
                {facilities.isPending ? (
                  <Skeleton height={80} />
                ) : facilities.data ? (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                      gap: 12,
                    }}
                  >
                    <StatCard
                      label="Bookings"
                      value={String(
                        facilities.data.facilities.reduce((sum, f) => sum + f.bookings, 0),
                      )}
                    />
                    <StatCard
                      label="Hours booked"
                      value={String(
                        facilities.data.facilities.reduce((sum, f) => sum + f.bookedHours, 0),
                      )}
                    />
                    <StatCard
                      label="Booking revenue"
                      value={formatKobo(
                        facilities.data.facilities.reduce((sum, f) => sum + f.revenue, 0),
                      )}
                    />
                  </div>
                ) : (
                  <p className="sz-muted" style={{ margin: 0 }}>
                    Facilities module not enabled.
                  </p>
                )}
              </Panel>
            </div>
          ) : null}
        </>
      ) : null}
    </>
  );
}
