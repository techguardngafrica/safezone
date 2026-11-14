'use client';

import { t } from '@safezone/i18n';
import {
  AccountBar,
  ActionButton,
  EmptyState,
  ErrorState,
  PageShell,
  SessionGate,
  Skeleton,
} from '@safezone/web-ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useMemberships } from '../lib/estate';
import { errorText } from '../lib/errors';
import { session } from '../lib/session';

const MANAGEABLE = new Set(['approved', 'active']);

function EstatePicker() {
  const router = useRouter();
  const memberships = useMemberships();
  const usable = (memberships.data ?? []).filter(
    (membership) => membership.status === 'active' && MANAGEABLE.has(membership.estate.status),
  );
  const only = usable.length === 1 ? usable[0] : undefined;

  useEffect(() => {
    if (only) router.replace(`/${only.estate.id}/dashboard`);
  }, [only, router]);

  if (memberships.isPending || only)
    return (
      <div style={{ display: 'grid', gap: 12 }} aria-busy="true">
        <Skeleton height={56} />
        <Skeleton height={56} />
      </div>
    );
  if (memberships.isError)
    return (
      <ErrorState
        message={errorText(memberships.error)}
        onRetry={() => void memberships.refetch()}
      />
    );
  if (usable.length === 0)
    return (
      <EmptyState
        icon="building"
        title={t('management.picker.emptyTitle')}
        body={t('management.picker.emptyBody')}
      />
    );
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}>
      {usable.map((membership) => (
        <li key={membership.estate.id}>
          <Link
            href={`/${membership.estate.id}/dashboard`}
            className="sz-card"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              textDecoration: 'none',
              color: 'inherit',
            }}
          >
            <span>
              <strong>{membership.estate.name}</strong>
              <br />
              <span className="sz-muted" style={{ fontSize: 14 }}>
                {t('home.memberships.roles', { roles: membership.roles.join(', ') || '-' })}
              </span>
            </span>
            <ActionButton variant="outline" size="sm" tabIndex={-1}>
              {t('management.picker.open')}
            </ActionButton>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Signed-in landing: opens the only estate straight away, or lets multi-estate managers choose. */
export function Home() {
  return (
    <SessionGate controller={session} title={t('app.name')}>
      <PageShell title={t('management.picker.title')}>
        <div style={{ maxWidth: 640 }}>
          <AccountBar controller={session} />
          <EstatePicker />
        </div>
      </PageShell>
    </SessionGate>
  );
}
