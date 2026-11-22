'use client';

import { unwrap, unwrapPage } from '@safezone/api-client';
import { type MessageKey, t } from '@safezone/i18n';
import {
  Banner,
  ErrorState,
  Icon,
  PageHeader,
  Panel,
  Skeleton,
  StatCard,
  StatusPill,
} from '@safezone/web-ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { errorText } from '../../lib/errors';
import { api } from '../../lib/session';
import { useVendor } from './vendor-context';

const OPEN = ['requested', 'quoted', 'accepted', 'scheduled', 'in_progress'];

export function vendorStatusTone(status: string) {
  if (status === 'approved') return 'success' as const;
  if (status === 'rejected' || status === 'suspended') return 'danger' as const;
  return 'warning' as const;
}

/** Overview: account status, the steps left before orders arrive, and open orders. */
export function OverviewScreen() {
  const { vendorId, can } = useVendor();
  const profile = useQuery({
    queryKey: ['vendor', vendorId, 'profile'],
    queryFn: () => unwrap(api.GET('/v1/vendors/{vendorId}', { params: { path: { vendorId } } })),
  });
  const listings = useQuery({
    queryKey: ['vendor', vendorId, 'listings', 'active'],
    enabled: can('vendor.listing.manage'),
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/vendors/{vendorId}/listings', {
          params: { path: { vendorId }, query: { status: 'active', limit: 1 } },
        }),
      ),
  });
  const orders = useQuery({
    queryKey: ['vendor', vendorId, 'orders', 'all'],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/vendors/{vendorId}/orders', {
          params: { path: { vendorId }, query: { limit: 100 } },
        }),
      ),
  });

  if (profile.isPending) return <Skeleton height={200} />;
  if (profile.isError)
    return <ErrorState message={errorText(profile.error)} onRetry={() => void profile.refetch()} />;
  const vendor = profile.data;
  const steps = [
    {
      label: t('vendor.overview.step.approved'),
      done: vendor.status === 'approved',
      href: null,
    },
    { label: t('vendor.overview.step.payout'), done: vendor.payout.ready, href: '/vendor/profile' },
    {
      label: t('vendor.overview.step.listing'),
      done: (listings.data?.items.length ?? 0) > 0,
      href: '/vendor/listings',
    },
  ];
  const openOrders = orders.data?.items.filter((o) => OPEN.includes(o.status)).length;

  return (
    <>
      <PageHeader
        title={vendor.name}
        description={t('vendor.overview.description')}
        actions={
          <StatusPill
            tone={vendorStatusTone(vendor.status)}
            label={t(`vendor.status.${vendor.status}` as MessageKey)}
          />
        }
      />
      {vendor.status === 'applied' || vendor.status === 'under_review' ? (
        <Banner tone="info">{t('vendor.overview.pending')}</Banner>
      ) : null}
      {vendor.status === 'rejected' ? (
        <Banner tone="danger">
          {t('vendor.overview.rejected', {
            reason: vendor.rejectionReason ?? t('vendor.overview.noReason'),
          })}
        </Banner>
      ) : null}
      {vendor.status === 'suspended' ? (
        <Banner tone="danger">
          {t('vendor.overview.suspended', {
            reason: vendor.suspendedReason ?? t('vendor.overview.noReason'),
          })}
        </Banner>
      ) : null}
      <div
        style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          margin: '16px 0',
        }}
      >
        <StatCard
          label={t('vendor.overview.openOrders')}
          icon="clipboard"
          value={orders.isPending ? '…' : (openOrders ?? 0)}
        />
        <StatCard
          label={t('vendor.overview.rating')}
          icon="activity"
          value={vendor.ratingAvg === null ? '-' : vendor.ratingAvg.toFixed(1)}
          hint={
            vendor.ratingCount === 0
              ? t('vendor.overview.noRating')
              : t('vendor.orders.stars', { rating: vendor.ratingAvg?.toFixed(1) ?? '0' })
          }
        />
      </div>
      {can('vendor.profile.manage') ? (
        <Panel title={t('vendor.overview.checklist')}>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
            {steps.map((step) => (
              <li
                key={step.label}
                style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 44 }}
              >
                <Icon
                  name={step.done ? 'check' : 'clock'}
                  label={
                    step.done ? t('vendor.overview.step.done') : t('vendor.overview.step.todo')
                  }
                />
                {step.done || !step.href ? (
                  <span>{step.label}</span>
                ) : (
                  <Link href={step.href}>{step.label}</Link>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </>
  );
}
