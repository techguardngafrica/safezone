'use client';

import { unwrap } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import { AccountBar, Card, PageShell, SessionGate } from '@safezone/web-ui';
import { useQuery } from '@tanstack/react-query';
import { api, session } from './lib/session';

function PlatformAccess() {
  const snapshot = useQuery({
    queryKey: ['me', 'permissions', 'platform'],
    queryFn: () => unwrap(api.GET('/v1/me/permissions')),
  });
  if (snapshot.isPending) return <p role="status">{t('common.loading')}</p>;
  if (snapshot.isError) return <p role="alert">{t('common.error')}</p>;
  if (snapshot.data.roles.length === 0) return <p role="alert">{t('admin.home.noAccess')}</p>;
  return <p>{t('home.memberships.roles', { roles: snapshot.data.roles.join(', ') })}</p>;
}

/** Authenticated overview. Phase 1 adds estate applications and assisted onboarding. */
export function Home() {
  return (
    <SessionGate controller={session} title={t('admin.home.platformLabel')}>
      <PageShell title={t('admin.home.title')}>
        <AccountBar controller={session} />
        <Card title={t('admin.home.platformLabel')}>
          <PlatformAccess />
        </Card>
      </PageShell>
    </SessionGate>
  );
}
