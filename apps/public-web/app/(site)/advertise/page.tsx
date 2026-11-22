import { colors, spacing, typography } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import { Card } from '@safezone/web-ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { EnquiryForm } from '../../../src/advertise/enquiry-form';
import { PageTitle } from '../../../src/components/site-shell';

export const metadata: Metadata = {
  title: t('public.advertise.metaTitle'),
  description: t('public.advertise.metaDescription'),
  alternates: { canonical: '/advertise' },
  openGraph: {
    title: t('public.advertise.metaTitle'),
    description: t('public.advertise.metaDescription'),
  },
};

const WHERE = [
  'public.advertise.where.home',
  'public.advertise.where.feed',
  'public.advertise.where.marketplace',
  'public.advertise.where.dashboard',
] as const;
const RULES = [
  'public.advertise.rules.audience',
  'public.advertise.rules.review',
  'public.advertise.rules.pay',
  'public.advertise.rules.restricted',
] as const;

/** Advertising information and enquiry form (public-web.md §7). */
export default function AdvertisePage() {
  return (
    <>
      <PageTitle title={t('public.advertise.title')} lead={t('public.advertise.lead')} />
      <div
        style={{
          display: 'grid',
          gap: spacing[4],
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          marginBottom: spacing[6],
        }}
      >
        <Card title={t('public.advertise.where.title')}>
          <ul style={{ margin: 0, paddingLeft: 20, lineHeight: typography.lineHeight.relaxed }}>
            {WHERE.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
        </Card>
        <Card title={t('public.advertise.never.title')}>
          <p style={{ margin: 0 }}>{t('public.advertise.never.body')}</p>
        </Card>
      </div>
      <h2 style={{ fontSize: typography.size.xl }}>{t('public.advertise.rules.title')}</h2>
      <ul
        style={{
          maxWidth: 720,
          lineHeight: typography.lineHeight.relaxed,
          marginBottom: spacing[6],
        }}
      >
        {RULES.map((key) => (
          <li key={key}>{t(key)}</li>
        ))}
      </ul>
      <div style={{ maxWidth: 720 }}>
        <EnquiryForm />
      </div>
      <p style={{ marginTop: spacing[6] }}>
        <Link
          href="/advertiser"
          style={{ color: colors.brand.primary, fontWeight: Number(typography.weight.semibold) }}
        >
          {t('public.advertise.signIn')}
        </Link>
      </p>
    </>
  );
}
