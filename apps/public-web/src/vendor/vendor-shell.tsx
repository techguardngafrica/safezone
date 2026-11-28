'use client';

import { unwrap } from '@safezone/api-client';
import { type Permission, permissionsForRoles } from '@safezone/permissions';
import { type MessageKey, t } from '@safezone/i18n';
import {
  AccountBar,
  ActionButton,
  AppShell,
  BrandMark,
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
import { type ReactNode, useState } from 'react';
import { errorText } from '../../lib/errors';
import { api, session } from '../../lib/session';
import { ApplyScreen } from './apply-screen';
import { VendorProvider } from './vendor-context';

const NAV: { path: string; label: MessageKey; icon: NavItem['icon']; permission: Permission }[] = [
  {
    path: '/vendor',
    label: 'vendor.nav.overview',
    icon: 'dashboard',
    permission: 'vendor.order.work',
  },
  {
    path: '/vendor/orders',
    label: 'vendor.nav.orders',
    icon: 'clipboard',
    permission: 'vendor.order.work',
  },
  {
    path: '/vendor/listings',
    label: 'vendor.nav.listings',
    icon: 'list',
    permission: 'vendor.listing.manage',
  },
  {
    path: '/vendor/estates',
    label: 'vendor.nav.estates',
    icon: 'building',
    permission: 'vendor.order.manage',
  },
  {
    path: '/vendor/disputes',
    label: 'vendor.nav.disputes',
    icon: 'alert',
    permission: 'vendor.order.manage',
  },
  {
    path: '/vendor/profile',
    label: 'vendor.nav.profile',
    icon: 'settings',
    permission: 'vendor.profile.manage',
  },
  {
    path: '/vendor/team',
    label: 'vendor.nav.team',
    icon: 'users',
    permission: 'vendor.team.manage',
  },
  {
    path: '/vendor/earnings',
    label: 'vendor.nav.earnings',
    icon: 'wallet',
    permission: 'vendor.payout.read',
  },
];

function TopBar({
  vendors,
  selected,
  onSelect,
}: {
  vendors: { id: string; name: string }[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const state = useSession(session);
  return (
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
      {vendors.length > 1 ? (
        <div style={{ minWidth: 220 }}>
          <SelectField
            label={t('vendor.switch')}
            value={selected}
            onChange={onSelect}
            options={vendors.map((v) => ({ value: v.id, label: v.name }))}
          />
        </div>
      ) : null}
      <span className="sz-muted">{state.user?.fullName ?? state.user?.phone ?? ''}</span>
      <ActionButton variant="outline" size="sm" onClick={() => void session.signOut()}>
        {t('auth.signOut')}
      </ActionButton>
    </div>
  );
}

function Portal({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [selected, setSelected] = useState<string | null>(null);
  const mine = useQuery({
    queryKey: ['me', 'vendors'],
    queryFn: () => unwrap(api.GET('/v1/me/vendors')),
  });
  if (mine.isPending)
    return (
      <div
        style={{ padding: 24, display: 'grid', gap: 12 }}
        role="status"
        aria-label={t('common.loading')}
      >
        <Skeleton height={32} width="40%" />
        <Skeleton height={120} />
      </div>
    );
  if (mine.isError)
    return <ErrorState message={errorText(mine.error)} onRetry={() => void mine.refetch()} />;
  const vendor = mine.data.find((v) => v.id === selected) ?? mine.data[0];
  if (!vendor)
    return (
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 16px' }}>
        <AccountBar controller={session} />
        <ApplyScreen />
      </div>
    );
  return (
    <VendorProvider vendor={vendor}>
      <PortalShell vendor={vendor} vendors={mine.data} onSelect={setSelected} pathname={pathname}>
        {children}
      </PortalShell>
    </VendorProvider>
  );
}

function PortalShell({
  vendor,
  vendors,
  onSelect,
  pathname,
  children,
}: {
  vendor: { id: string; name: string; role: string };
  vendors: { id: string; name: string }[];
  onSelect: (id: string) => void;
  pathname: string;
  children: ReactNode;
}) {
  const items = NAV.filter((item) => canRole(vendor.role, item.permission)).map((item) => ({
    href: item.path,
    label: t(item.label),
    icon: item.icon,
  }));
  return (
    <AppShell
      brand={
        <Link
          href="/vendor"
          style={{
            color: 'inherit',
            textDecoration: 'none',
            fontWeight: 700,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <BrandMark size={26} />
          <span>{t('vendor.portal.name')}</span>
        </Link>
      }
      nav={[{ label: vendor.name, items }]}
      pathname={pathname}
      renderLink={(item, props) => (
        <Link href={item.href} {...props}>
          {props.children}
        </Link>
      )}
      topBar={<TopBar vendors={vendors} selected={vendor.id} onSelect={onSelect} />}
    >
      {children}
    </AppShell>
  );
}

function canRole(role: string, permission: Permission): boolean {
  return permissionsForRoles([role]).has(permission);
}

/** Vendor Portal frame (public-web.md §8): phone and OTP sign-in, then the vendor's workspace. */
export function VendorShell({ children }: { children: ReactNode }) {
  return (
    <SessionGate
      controller={session}
      title={t('vendor.portal.name')}
      intro={t('vendor.portal.signInIntro')}
    >
      <Portal>{children}</Portal>
    </SessionGate>
  );
}
