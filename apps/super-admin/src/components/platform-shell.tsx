'use client';

import { unwrapPage } from '@safezone/api-client';
import { t, type MessageKey } from '@safezone/i18n';
import type { Permission } from '@safezone/permissions';
import {
  ActionButton,
  AppShell,
  Banner,
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
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { api, session } from '../../lib/session';
import { errorText } from '../lib/errors';
import { PlatformProvider, useIdleTimeout, usePlatform } from '../lib/platform';

interface NavSpec {
  href: string;
  label: MessageKey;
  icon: NavItem['icon'];
  permission?: Permission | readonly Permission[];
  badge?: 'applications';
}

const NAV: { label?: MessageKey; items: NavSpec[] }[] = [
  { items: [{ href: '/overview', label: 'admin.nav.overview', icon: 'dashboard' }] },
  {
    label: 'admin.nav.group.estates',
    items: [
      {
        href: '/estates/applications',
        label: 'admin.nav.applications',
        icon: 'inbox',
        permission: 'platform.estate.approve',
        badge: 'applications',
      },
      {
        href: '/estates/leads',
        label: 'admin.nav.leads',
        icon: 'clipboard',
        permission: 'platform.estate.create',
      },
      {
        href: '/estates',
        label: 'admin.nav.estates',
        icon: 'building',
        permission: 'platform.estate.create',
      },
      {
        href: '/estates/new',
        label: 'admin.nav.createEstate',
        icon: 'userPlus',
        permission: 'platform.estate.create',
      },
    ],
  },
  {
    label: 'admin.nav.group.users',
    items: [
      {
        href: '/users',
        label: 'admin.nav.users',
        icon: 'users',
        permission: 'platform.user.manage',
      },
      {
        href: '/users/staff',
        label: 'admin.nav.staff',
        icon: 'key',
        permission: 'platform.staff.manage',
      },
    ],
  },
  {
    label: 'admin.nav.group.support',
    items: [
      {
        href: '/support',
        label: 'admin.nav.tickets',
        icon: 'ticket',
        permission: 'platform.support_access',
      },
      {
        href: '/support/sessions',
        label: 'admin.nav.supportSessions',
        icon: 'shield',
        permission: 'platform.support_access',
      },
    ],
  },
  {
    label: 'admin.nav.group.operations',
    items: [
      {
        href: '/transactions',
        label: 'admin.nav.transactions',
        icon: 'wallet',
        permission: 'platform.finance',
      },
    ],
  },
  {
    label: 'admin.nav.group.vendors',
    items: [
      {
        href: '/vendors',
        label: 'admin.nav.vendors',
        icon: 'building',
        permission: 'vendor.approve',
      },
      {
        href: '/vendors/commissions',
        label: 'admin.nav.commissions',
        icon: 'sliders',
        permission: ['platform.config', 'platform.finance'],
      },
      {
        href: '/vendors/disputes',
        label: 'admin.nav.disputes',
        icon: 'alert',
        permission: 'vendor.approve',
      },
    ],
  },
  {
    label: 'admin.nav.group.advertising',
    items: [
      {
        href: '/ads/enquiries',
        label: 'admin.nav.adEnquiries',
        icon: 'inbox',
        permission: 'ad.enquiry.manage',
      },
      {
        href: '/ads/advertisers',
        label: 'admin.nav.advertisers',
        icon: 'megaphone',
        permission: ['ad.enquiry.manage', 'ad.campaign.manage', 'ad.campaign.review'],
      },
      {
        href: '/ads/campaigns',
        label: 'admin.nav.adCampaigns',
        icon: 'layers',
        permission: ['ad.campaign.manage', 'ad.campaign.review'],
      },
      {
        href: '/ads/review',
        label: 'admin.nav.adReview',
        icon: 'fileCheck',
        permission: ['ad.campaign.review', 'ad.campaign.manage'],
      },
      {
        href: '/ads/placements',
        label: 'admin.nav.adPlacements',
        icon: 'sliders',
        permission: ['ad.campaign.manage', 'ad.campaign.review'],
      },
      {
        href: '/ads/invoices',
        label: 'admin.nav.adInvoices',
        icon: 'wallet',
        permission: ['ad.campaign.manage', 'ad.campaign.review', 'platform.finance'],
      },
      {
        href: '/ads/reports',
        label: 'admin.nav.adReports',
        icon: 'activity',
        permission: ['ad.campaign.manage', 'ad.campaign.review', 'platform.finance'],
      },
    ],
  },
  {
    label: 'admin.nav.group.compliance',
    items: [
      {
        href: '/compliance',
        label: 'admin.nav.dsr',
        icon: 'fileCheck',
        permission: 'platform.compliance',
      },
      {
        href: '/compliance/breaches',
        label: 'admin.nav.breaches',
        icon: 'alert',
        permission: 'platform.compliance',
      },
      {
        href: '/compliance/retention',
        label: 'admin.nav.retention',
        icon: 'clock',
        permission: 'platform.compliance',
      },
      {
        href: '/compliance/dpia',
        label: 'admin.nav.dpia',
        icon: 'shield',
        permission: 'platform.compliance',
      },
      {
        href: '/compliance/arcon',
        label: 'admin.nav.arcon',
        icon: 'clipboard',
        permission: ['platform.compliance', 'ad.campaign.review'],
      },
    ],
  },
  {
    label: 'admin.nav.group.platform',
    items: [
      {
        href: '/platform/flags',
        label: 'admin.nav.flags',
        icon: 'flag',
        permission: 'platform.config',
      },
      {
        href: '/platform/versions',
        label: 'admin.nav.versions',
        icon: 'smartphone',
        permission: 'platform.config',
      },
      {
        href: '/platform/plans',
        label: 'admin.nav.plans',
        icon: 'layers',
        permission: 'platform.config',
      },
      {
        href: '/platform/providers',
        label: 'admin.nav.providers',
        icon: 'sliders',
        permission: 'platform.config',
      },
      {
        href: '/platform/templates',
        label: 'admin.nav.templates',
        icon: 'inbox',
        permission: 'platform.config',
      },
      {
        href: '/platform/ad-categories',
        label: 'admin.nav.adCategories',
        icon: 'shield',
        permission: ['platform.config', 'ad.campaign.manage', 'ad.campaign.review'],
      },
      {
        href: '/audit',
        label: 'admin.nav.audit',
        icon: 'history',
        permission: ['platform.compliance', 'platform.staff.manage', 'platform.config'],
      },
      {
        href: '/health',
        label: 'admin.nav.health',
        icon: 'activity',
        permission: 'platform.config',
      },
    ],
  },
];

function TopBar() {
  const state = useSession(session);
  const { roles } = usePlatform();
  return (
    <>
      <strong style={{ fontSize: 15 }}>{t('admin.home.platformLabel')}</strong>
      <span style={{ flex: 1 }} />
      <span className="sz-muted" style={{ fontSize: 13 }}>
        {state.user?.fullName ?? state.user?.phone}
        {roles.length > 0 ? ` (${roles[0]})` : ''}
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

function AuthenticatedShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { roles, can, isLoading, isError, error, refetch } = usePlatform();
  useIdleTimeout(true);

  const pendingApps = useQuery({
    queryKey: ['platform', 'applications', 'submitted', 'count'],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/platform/estate-applications', {
          params: { query: { status: 'submitted', limit: 50 } },
        }),
      ),
    enabled: can('platform.estate.approve'),
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div style={{ padding: 32 }}>
        <Skeleton height={36} width={280} />
      </div>
    );
  }
  if (isError) {
    return (
      <div style={{ padding: 32 }}>
        <ErrorState message={errorText(error)} onRetry={refetch} />
      </div>
    );
  }
  if (roles.length === 0) {
    return (
      <div style={{ maxWidth: 520, margin: '64px auto', padding: 24 }}>
        <EmptyState
          icon="shield"
          title={t('admin.home.platformLabel')}
          body={t('admin.home.noAccess')}
          action={
            <ActionButton variant="outline" onClick={() => void session.signOut()}>
              {t('auth.signOut')}
            </ActionButton>
          }
        />
      </div>
    );
  }

  const nav: NavGroup[] = NAV.map((group) => ({
    label: group.label ? t(group.label) : undefined,
    items: group.items
      .filter((item) => !item.permission || can(item.permission))
      .map((item) => ({
        href: item.href,
        label: t(item.label),
        icon: item.icon,
        badge:
          item.badge === 'applications' && (pendingApps.data?.items.length ?? 0) > 0
            ? pendingApps.data?.items.length
            : undefined,
      })),
  })).filter((group) => group.items.length > 0);

  return (
    <AppShell
      brand={
        <>
          <Icon name="shield" size={22} />
          <span>Safezone Admin</span>
        </>
      }
      nav={nav}
      pathname={pathname}
      renderLink={(item, props) => <Link href={item.href} {...props} />}
      topBar={<TopBar />}
    >
      {children}
    </AppShell>
  );
}

export function PlatformShell({ children }: { children: ReactNode }) {
  const state = useSession(session);
  const { timedOut, clearTimedOut } = useIdleTimeout(false);

  return (
    <SessionGate controller={session} title={t('admin.home.platformLabel')}>
      {timedOut && state.status !== 'signed_in' ? (
        <div style={{ maxWidth: 420, margin: '16px auto' }}>
          <Banner tone="warning">{t('admin.idle.signedOut')}</Banner>
        </div>
      ) : null}
      <PlatformProvider>
        <AuthenticatedShell>
          {timedOut ? <span onClick={clearTimedOut} /> : null}
          {children}
        </AuthenticatedShell>
      </PlatformProvider>
    </SessionGate>
  );
}
