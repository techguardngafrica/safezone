import { colors, radii, spacing, typography } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import { Card } from '@safezone/web-ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageTitle } from '../../../src/components/site-shell';

export const metadata: Metadata = {
  title: t('public.vendors.metaTitle'),
  description: t('public.vendors.metaDescription'),
  alternates: { canonical: '/vendors' },
  openGraph: {
    title: t('public.vendors.metaTitle'),
    description: t('public.vendors.metaDescription'),
  },
};

const STEPS = [
  'public.vendors.how.apply',
  'public.vendors.how.verify',
  'public.vendors.how.payout',
  'public.vendors.how.estates',
  'public.vendors.how.orders',
] as const;

const primary = {
  background: colors.brand.primary,
  color: colors.brand.onPrimary,
  padding: `${spacing[3]}px ${spacing[4]}px`,
  borderRadius: radii.md,
  textDecoration: 'none',
  fontWeight: Number(typography.weight.semibold),
  minHeight: 48,
  display: 'inline-flex',
  alignItems: 'center',
} as const;

/** Vendor information and the way into the application (public-web.md §3, §8). */
export default function VendorsPage() {
  return (
    <>
      <PageTitle title={t('public.vendors.title')} lead={t('public.vendors.lead')} />
      <p style={{ display: 'flex', gap: spacing[3], flexWrap: 'wrap' }}>
        <Link href="/vendor" style={primary}>
          {t('public.vendors.cta')}
        </Link>
      </p>
      <h2 style={{ fontSize: typography.size.xl, marginTop: spacing[6] }}>
        {t('public.vendors.how.title')}
      </h2>
      <ol style={{ maxWidth: 720, lineHeight: typography.lineHeight.relaxed }}>
        {STEPS.map((step) => (
          <li key={step}>{t(step)}</li>
        ))}
      </ol>
      <div
        style={{
          display: 'grid',
          gap: spacing[4],
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          marginTop: spacing[6],
        }}
      >
        <Card title={t('public.vendors.money.title')}>
          <p style={{ margin: 0 }}>{t('public.vendors.money.body')}</p>
        </Card>
        <Card title={t('public.vendors.who.title')}>
          <p style={{ margin: 0 }}>{t('public.vendors.who.body')}</p>
        </Card>
      </div>
      <p style={{ marginTop: spacing[6] }}>
        <Link
          href="/vendor"
          style={{ color: colors.brand.primary, fontWeight: Number(typography.weight.semibold) }}
        >
          {t('public.vendors.signIn')}
        </Link>
      </p>
    </>
  );
}
