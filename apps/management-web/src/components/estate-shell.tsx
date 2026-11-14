'use client';

import { ApiClientError, unwrap, unwrapPage } from '@safezone/api-client';
import type { Permission } from '@safezone/permissions';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  AppShell,
  EmptyState,
  ErrorState,
  Icon,
  type NavGroup,
  type NavItem,
  SessionGate,
  Skeleton,
  useSession,
} from '@safezone/web-ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { EstateProvider, useEstate, useEstateAccess, useMemberships } from '../../lib/estate';
import { errorText } from '../../lib/errors';
import { api, session } from '../../lib/session';
import { SosAlarm } from './sos-alarm';

interface NavSpec {
  path: string;
  label: Parameters<typeof t>[0];
  icon: NavItem['icon'];
  permission?: Permission;
  feature?: string;
  badge?: 'joinRequests' | 'sos';
}

/** Sidebar per management-web.md §5. Phase 2 and 3 areas join as their screens ship. */
const NAV: { label?: Parameters<typeof t>[0]; items: NavSpec[] }[] = [
  { items: [{ path: 'dashboard', label: 'nav.dashboard', icon: 'dashboard' }] },
  {
    label: 'nav.group.estate',
    items: [
      { path: 'estate/spaces', label: 'nav.spaces', icon: 'building', feature: 'property' },
      {
        path: 'estate/gates',
        label: 'nav.gates',
        icon: 'door',
        permission: 'security.staff.manage',
        feature: 'security',
      },
    ],
  },
  {
    label: 'nav.group.people',
    items: [
      {
        path: 'people/residents',
        label: 'nav.residents',
        icon: 'users',
        permission: 'resident.read',
        feature: 'occupancy',
      },
      {
        path: 'people/join-requests',
        label: 'nav.joinRequests',
        icon: 'userCheck',
        permission: 'resident.approve',
        feature: 'occupancy',
        badge: 'joinRequests',
      },
    ],
  },
  {
    label: 'nav.group.security',
    items: [
      {
        path: 'security/sos',
        label: 'nav.sos',
        icon: 'siren',
        permission: 'sos.respond',
        feature: 'emergency',
        badge: 'sos',
      },
      {
        path: 'security/visitor-log',
        label: 'nav.visitorLog',
        icon: 'list',
        permission: 'visitor.log.read',
        feature: 'visitors',
      },
      {
        path: 'security/passes',
        label: 'nav.passes',
        icon: 'ticket',
        permission: 'visitor.log.read',
        feature: 'visitors',
      },
    ],
  },
  {
    label: 'nav.group.community',
    items: [
      {
        path: 'community/announcements',
        label: 'nav.announcements',
        icon: 'megaphone',
        permission: 'announcement.publish',
        feature: 'announcements',
      },
    ],
  },
  {
    label: 'nav.group.settings',
    items: [
      {
        path: 'settings/estate',
        label: 'nav.estateSettings',
        icon: 'settings',
        permission: 'estate.configure',
      },
      {
        path: 'settings/audit-log',
        label: 'nav.auditLog',
        icon: 'history',
        permission: 'audit.read',
      },
    ],
  },
];

function useBadges(): { joinRequests: number; sos: number } {
  const { estateId, can, hasFeature } = useEstate();
  const joinRequests = useQuery({
    queryKey: ['estate', estateId, 'join-requests', 'awaiting_manager', 'count'],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/join-requests', {
          params: { path: { estateId }, query: { status: 'awaiting_manager', limit: 50 } },
        }),
      ),
    enabled: can('resident.approve') && hasFeature('occupancy'),
    refetchInterval: 60_000,
  });
  const sos = useQuery({
    queryKey: ['estate', estateId, 'sos', 'active'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/sos', {
          params: { path: { estateId }, query: { status: 'active' } },
        }),
      ),
    enabled: can('sos.respond') && hasFeature('emergency'),
    refetchInterval: 3_000,
  });
  return {
    joinRequests: joinRequests.data?.items.length ?? 0,
    sos: sos.data?.length ?? 0,
  };
}

function TopBar() {
  const router = useRouter();
  const { estateId, estateName } = useEstate();
  const memberships = useMemberships();
  const state = useSession(session);
  const others = (memberships.data ?? []).filter((membership) => membership.status === 'active');
  return (
    <>
      {others.length > 1 ? (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="sz-visually-hidden">{t('shell.switchEstate')}</span>
          <select
            className="sz-input"
            style={{ width: 'auto', minWidth: 220 }}
            value={estateId}
            onChange={(event) => router.push(`/${event.target.value}/dashboard`)}
          >
            {others.map((membership) => (
              <option key={membership.estate.id} value={membership.estate.id}>
                {membership.estate.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <strong style={{ fontSize: 16 }}>{estateName}</strong>
      )}
      <span style={{ flex: 1 }} />
      <span className="sz-muted" style={{ fontSize: 14 }}>
        {state.user?.fullName ?? state.user?.phone}
      </span>
      <ActionButton
        variant="outline"
        size="sm"
        icon="logOut"
        onClick={() => void session.signOut()}
      >
        {t('auth.signOut')}
      </ActionButton>
    </>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { estateId, can, hasFeature } = useEstate();
  const badges = useBadges();
  const nav: NavGroup[] = NAV.map((group) => ({
    label: group.label ? t(group.label) : undefined,
    items: group.items
      .filter(
        (item) =>
          (!item.permission || can(item.permission)) && (!item.feature || hasFeature(item.feature)),
      )
      .map((item) => ({
        href: `/${estateId}/${item.path}`,
        label: t(item.label),
        icon: item.icon,
        badge: item.badge ? badges[item.badge] : undefined,
        urgent: item.badge === 'sos',
      })),
  })).filter((group) => group.items.length > 0);

  return (
    <AppShell
      brand={
        <>
          <Icon name="shield" size={24} />
          {t('app.name')}
        </>
      }
      nav={nav}
      pathname={pathname}
      renderLink={(item, props) => (
        <Link
          href={item.href}
          className={props.className}
          aria-current={props['aria-current']}
          onClick={props.onClick}
        >
          {props.children}
        </Link>
      )}
      topBar={<TopBar />}
    >
      {can('sos.respond') && hasFeature('emergency') ? <SosAlarm /> : null}
      {children}
    </AppShell>
  );
}

function EstateAccess({ estateId, children }: { estateId: string; children: ReactNode }) {
  const memberships = useMemberships();
  const access = useEstateAccess(estateId);
  if (memberships.isPending || access.isPending)
    return (
      <div style={{ padding: 32, display: 'grid', gap: 16, maxWidth: 960 }} aria-busy="true">
        <Skeleton height={32} width="40%" />
        <Skeleton height={120} />
        <Skeleton height={240} />
      </div>
    );
  const failure = access.error ?? memberships.error;
  if (failure instanceof ApiClientError && failure.code === 'MFA_REQUIRED')
    return (
      <EmptyState
        icon="shield"
        title={t('shell.mfaRequired.title')}
        body={t('shell.mfaRequired.body')}
        action={
          <ActionButton onClick={() => void session.signOut()}>
            {t('shell.mfaRequired.action')}
          </ActionButton>
        }
      />
    );
  if (access.isError || memberships.isError)
    return (
      <ErrorState
        message={errorText(access.error ?? memberships.error)}
        onRetry={() => {
          void access.refetch();
          void memberships.refetch();
        }}
      />
    );
  const membership = memberships.data.find((item) => item.estate.id === estateId);
  if (!membership || membership.status !== 'active')
    return <ErrorState message={t('shell.noEstateAccess')} />;
  return (
    <EstateProvider
      estateId={estateId}
      estateName={membership.estate.name}
      estateStatus={membership.estate.status}
      roles={access.data.roles}
      permissions={access.data.permissions}
      features={access.data.features}
    >
      <Shell>{children}</Shell>
    </EstateProvider>
  );
}

/** Signed-in, estate-scoped shell for every /[estateId]/... page. */
export function EstateShell({ estateId, children }: { estateId: string; children: ReactNode }) {
  return (
    <SessionGate controller={session} title={t('app.name')}>
      <EstateAccess estateId={estateId}>{children}</EstateAccess>
    </SessionGate>
  );
}
