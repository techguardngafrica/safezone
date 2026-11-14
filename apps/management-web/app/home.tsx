'use client';

import { unwrap } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import { AccountBar, Card, PageShell, SessionGate } from '@safezone/web-ui';
import { useQuery } from '@tanstack/react-query';
import { api, session } from '../lib/session';

function Memberships() {
  const memberships = useQuery({
    queryKey: ['me', 'memberships'],
    queryFn: () => unwrap(api.GET('/v1/me/memberships')),
  });
  if (memberships.isPending) return <p role="status">{t('common.loading')}</p>;
  if (memberships.isError) return <p role="alert">{t('home.memberships.error')}</p>;
  if (memberships.data.length === 0) return <p>{t('home.memberships.empty')}</p>;
  return (
    <ul style={{ margin: 0, paddingLeft: 20 }}>
      {memberships.data.map((membership) => (
        <li key={membership.estate.id}>
          <strong>{membership.estate.name}</strong>{' '}
          <span>{t('home.memberships.roles', { roles: membership.roles.join(', ') || '-' })}</span>
        </li>
      ))}
    </ul>
  );
}

/** Authenticated home. Phase 1 adds the setup wizard, live gate view and approvals. */
export function Home() {
  return (
    <SessionGate controller={session} title={t('app.name')}>
      <PageShell title={t('management.home.title')}>
        <AccountBar controller={session} />
        <Card title={t('home.memberships.title')}>
          <Memberships />
        </Card>
      </PageShell>
    </SessionGate>
  );
}
