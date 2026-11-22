'use client';

import { unwrap } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  ErrorState,
  PageHeader,
  Panel,
  Skeleton,
  StatCard,
  StatusPill,
} from '@safezone/web-ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '../../../lib/session';
import { errorText } from '../../lib/errors';
import { formatWat, statusTone } from '../../lib/format';
import { usePlatform } from '../../lib/platform';

export function OverviewScreen() {
  const { can } = usePlatform();
  const overview = useQuery({
    queryKey: ['platform', 'overview'],
    queryFn: () => unwrap(api.GET('/v1/platform/overview')),
    refetchInterval: 60_000,
  });

  const health = useQuery({
    queryKey: ['platform', 'health'],
    queryFn: () => unwrap(api.GET('/v1/platform/health')),
    enabled: can('platform.config'),
    refetchInterval: 60_000,
  });

  if (overview.isPending) {
    return (
      <>
        <PageHeader title={t('admin.home.title')} description={t('admin.overview.description')} />
        <Skeleton height={120} />
      </>
    );
  }
  if (overview.isError) {
    return (
      <>
        <PageHeader title={t('admin.home.title')} description={t('admin.overview.description')} />
        <ErrorState message={errorText(overview.error)} onRetry={() => void overview.refetch()} />
      </>
    );
  }

  const data = overview.data;
  const pendingApps =
    data.applications.submitted + data.applications.underReview + data.applications.infoRequested;

  return (
    <>
      <PageHeader
        title={t('admin.home.title')}
        description={t('admin.overview.description')}
        actions={
          can('platform.estate.create') ? (
            <Link href="/estates/new">
              <ActionButton icon="userPlus">{t('admin.nav.createEstate')}</ActionButton>
            </Link>
          ) : undefined
        }
      />

      <div
        style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          marginBottom: 24,
        }}
      >
        <StatCard
          label={t('admin.overview.estatesActive')}
          value={data.estates.active}
          hint={t('admin.overview.estatesTotal', {
            total: data.estates.total,
            approved: data.estates.approved,
            suspended: data.estates.suspended,
          })}
          icon="building"
        />
        <StatCard
          label={t('admin.overview.pendingApps')}
          value={pendingApps}
          hint={t('admin.overview.pendingAppsHint', {
            review: data.applications.underReview,
            info: data.applications.infoRequested,
          })}
          icon="inbox"
        />
        <StatCard
          label={t('admin.overview.openLeads')}
          value={data.leads.newCount}
          hint={t('admin.overview.openLeadsHint', { contacted: data.leads.contactedCount })}
          icon="clipboard"
        />
        <StatCard
          label={t('admin.overview.users')}
          value={data.users.total}
          hint={t('admin.overview.usersLocked', { locked: data.users.locked })}
          icon="users"
        />
        <StatCard
          label={t('admin.overview.support')}
          value={data.support.openTickets}
          hint={t('admin.overview.supportSessions', {
            active: data.support.activeSessions,
            pending: data.support.pendingSessions,
          })}
          icon="ticket"
        />
        <StatCard
          label={t('admin.overview.compliance')}
          value={data.compliance.openDsrs + data.compliance.openBreaches}
          hint={t('admin.overview.complianceHint', {
            dsrs: data.compliance.openDsrs,
            breaches: data.compliance.openBreaches,
          })}
          icon="fileCheck"
        />
      </div>

      <div
        style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        }}
      >
        <Panel title="Quick actions">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {can('platform.estate.approve') ? (
              <Link href="/estates/applications">
                <ActionButton variant="outline" icon="inbox">
                  {t('admin.nav.applications')} ({pendingApps})
                </ActionButton>
              </Link>
            ) : null}
            {can('platform.estate.create') ? (
              <Link href="/estates/leads">
                <ActionButton variant="outline" icon="clipboard">
                  {t('admin.nav.leads')} ({data.leads.newCount})
                </ActionButton>
              </Link>
            ) : null}
            {can('platform.support_access') ? (
              <Link href="/support">
                <ActionButton variant="outline" icon="ticket">
                  {t('admin.nav.tickets')} ({data.support.openTickets})
                </ActionButton>
              </Link>
            ) : null}
            {can('platform.compliance') ? (
              <Link href="/compliance">
                <ActionButton variant="outline" icon="fileCheck">
                  {t('admin.nav.dsr')} ({data.compliance.openDsrs})
                </ActionButton>
              </Link>
            ) : null}
          </div>
        </Panel>

        {can('platform.config') && health.data ? (
          <Panel
            title={t('admin.nav.health')}
            actions={
              <Link href="/health">
                <ActionButton variant="text" size="sm">
                  View details
                </ActionButton>
              </Link>
            }
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
              <StatusPill
                tone={statusTone(health.data.status)}
                label={`API: ${health.data.status}`}
              />
              <StatusPill
                tone={statusTone(health.data.checks.database)}
                label={`DB: ${health.data.checks.database}`}
              />
              <StatusPill
                tone={statusTone(health.data.checks.redis)}
                label={`Redis: ${health.data.checks.redis}`}
              />
            </div>
            <p className="sz-muted" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
              Last checked {formatWat(health.data.checkedAt)}
            </p>
          </Panel>
        ) : null}
      </div>
    </>
  );
}
