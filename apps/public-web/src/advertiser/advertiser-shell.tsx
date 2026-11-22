'use client';

import { type ApiRow, unwrap } from '@safezone/api-client';
import { type Permission, permissionsForRoles } from '@safezone/permissions';
import { t } from '@safezone/i18n';
import {
  AccountBar,
  ActionButton,
  AppShell,
  Banner,
  EmptyState,
  ErrorState,
  type NavItem,
  SelectField,
  SessionGate,
  Skeleton,
  useSession,
} from '@safezone/web-ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';
import { errorText } from '../../lib/errors';
import { api, session } from '../../lib/session';

export type MyAdvertiser = ApiRow<'/v1/me/advertisers', 'get'>;

interface AdvertiserContextValue {
  advertiser: MyAdvertiser;
  advertiserId: string;
  can: (permission: Permission) => boolean;
}

const AdvertiserContext = createContext<AdvertiserContextValue | null>(null);

export function useAdvertiser(): AdvertiserContextValue {
  const value = useContext(AdvertiserContext);
  if (!value) throw new Error('useAdvertiser outside the advertiser area');
  return value;
}

const NAV: {
  href: string;
  label: 'advertiser.nav.campaigns' | 'advertiser.nav.team';
  icon: NavItem['icon'];
  permission: Permission;
}[] = [
  {
    href: '/advertiser',
    label: 'advertiser.nav.campaigns',
    icon: 'megaphone',
    permission: 'advertiser.campaign.read',
  },
  {
    href: '/advertiser/team',
    label: 'advertiser.nav.team',
    icon: 'users',
    permission: 'advertiser.team.manage',
  },
];

function Area({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const user = useSession(session).user;
  const [selected, setSelected] = useState<string | null>(null);
  const mine = useQuery({
    queryKey: ['me', 'advertisers', user?.id ?? null],
    queryFn: () => unwrap(api.GET('/v1/me/advertisers')),
  });
  const advertiser = mine.data?.find((a) => a.id === selected) ?? mine.data?.[0];
  const value = useMemo(() => {
    if (!advertiser) return null;
    const granted = permissionsForRoles([advertiser.role]);
    return { advertiser, advertiserId: advertiser.id, can: (p: Permission) => granted.has(p) };
  }, [advertiser]);

  if (mine.isPending)
    return (
      <div style={{ padding: 24 }}>
        <Skeleton height={120} />
      </div>
    );
  if (mine.isError)
    return <ErrorState message={errorText(mine.error)} onRetry={() => void mine.refetch()} />;
  if (!value || !advertiser)
    return (
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '24px 16px' }}>
        <AccountBar controller={session} />
        <EmptyState
          icon="megaphone"
          title={t('advertiser.none.title')}
          body={t('advertiser.none.body')}
          action={
            <Link href="/advertise">
              <ActionButton>{t('advertiser.none.cta')}</ActionButton>
            </Link>
          }
        />
      </div>
    );

  return (
    <AdvertiserContext.Provider value={value}>
      <AppShell
        brand={
          <Link
            href="/advertiser"
            style={{ color: 'inherit', textDecoration: 'none', fontWeight: 700 }}
          >
            {t('advertiser.portal.name')}
          </Link>
        }
        nav={[
          {
            label: advertiser.name,
            items: NAV.filter((item) => value.can(item.permission)).map((item) => ({
              href: item.href,
              label: t(item.label),
              icon: item.icon,
            })),
          },
        ]}
        pathname={pathname.startsWith('/advertiser/campaigns') ? '/advertiser' : pathname}
        renderLink={(item, props) => (
          <Link href={item.href} {...props}>
            {props.children}
          </Link>
        )}
        topBar={
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flex: 1,
              justifyContent: 'flex-end',
              flexWrap: 'wrap',
            }}
          >
            {(mine.data?.length ?? 0) > 1 ? (
              <div style={{ minWidth: 220 }}>
                <SelectField
                  label={t('advertiser.switch')}
                  value={advertiser.id}
                  onChange={setSelected}
                  options={(mine.data ?? []).map((a) => ({ value: a.id, label: a.name }))}
                />
              </div>
            ) : null}
            <span className="sz-muted">{user?.fullName ?? user?.phone ?? ''}</span>
            <ActionButton variant="outline" size="sm" onClick={() => void session.signOut()}>
              {t('auth.signOut')}
            </ActionButton>
          </div>
        }
      >
        {advertiser.status === 'suspended' ? (
          <Banner tone="danger">{t('advertiser.suspended')}</Banner>
        ) : null}
        {children}
      </AppShell>
    </AdvertiserContext.Provider>
  );
}

/** Advertiser area (public-web.md §7): campaigns, creatives, results, invoices, team. Signed in, noindex. */
export function AdvertiserShell({ children }: { children: ReactNode }) {
  return (
    <SessionGate
      controller={session}
      title={t('advertiser.portal.name')}
      intro={t('advertiser.portal.signInIntro')}
    >
      <Area>{children}</Area>
    </SessionGate>
  );
}
