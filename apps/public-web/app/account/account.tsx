'use client';

import { unwrap } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import { AccountBar, Card, PageShell, SessionGate } from '@safezone/web-ui';
import { useQuery } from '@tanstack/react-query';
import { api, session } from '../lib/session';

function Profile() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => unwrap(api.GET('/v1/me')) });
  if (me.isPending) return <p role="status">{t('common.loading')}</p>;
  if (me.isError) return <p role="alert">{t('common.error')}</p>;
  return <p>{t('home.signedInAs', { name: me.data.fullName ?? me.data.phone })}</p>;
}

/** Applicant account. Phase 1 adds the estate application status here. */
export function Account() {
  return (
    <SessionGate controller={session} title={t('app.name')} intro={t('public.account.signInIntro')}>
      <PageShell title={t('public.account.title')}>
        <AccountBar controller={session} />
        <Card>
          <Profile />
        </Card>
      </PageShell>
    </SessionGate>
  );
}
