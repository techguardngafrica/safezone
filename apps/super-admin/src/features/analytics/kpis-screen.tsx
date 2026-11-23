'use client';

import { unwrap } from '@safezone/api-client';
import { formatKobo, t } from '@safezone/i18n';
import { ErrorState, PageHeader, Panel, Skeleton, StatCard } from '@safezone/web-ui';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/session';
import { errorText } from '../../lib/errors';

export function PlatformKpisScreen() {
  const kpis = useQuery({
    queryKey: ['platform', 'kpis'],
    queryFn: () => unwrap(api.GET('/v1/platform/kpis')),
  });

  if (kpis.isLoading) return <Skeleton height={220} />;
  if (kpis.isError) return <ErrorState message={errorText(kpis.error)} />;
  const data = kpis.data!;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <PageHeader title={t('p5.admin.kpis.title')} description={t('p5.admin.kpis.description')} />
      {data.suppressed ? (
        <Panel>
          <p style={{ margin: 0 }}>
            Monthly active users are suppressed below the privacy cohort threshold (
            {data.suppressionThreshold} users).
          </p>
        </Panel>
      ) : null}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 12,
        }}
      >
        <StatCard label="Active Estates" value={String(data.activeEstates)} />
        <StatCard label="Total Users" value={String(data.totalUsers)} />
        <StatCard
          label="Monthly Active Users"
          value={
            data.monthlyActiveUsers !== null
              ? String(data.monthlyActiveUsers)
              : `< ${data.suppressionThreshold}`
          }
        />
        <StatCard label="Transaction Volume" value={formatKobo(data.txVolumeKobo)} />
        <StatCard label="Ad Revenue" value={formatKobo(data.adRevenueKobo)} />
        <StatCard
          label="Marketplace Commission"
          value={formatKobo(data.marketplaceCommissionKobo)}
        />
        <StatCard label="Ad Impressions" value={String(data.adImpressions)} />
        <StatCard label="Ad CTR" value={`${data.adCtrPercent}%`} />
      </div>
    </div>
  );
}
