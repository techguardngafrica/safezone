import { colors, radii, spacing, typography } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import { Card } from '@safezone/web-ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageTitle } from '../../../src/components/site-shell';

export const metadata: Metadata = {
  title: 'For estates',
  description:
    'How Safezone helps estate managers run gates, SOS response, billing, maintenance and community, and how free onboarding works.',
  alternates: { canonical: '/estates' },
};

/** Only what the product does today (docs/product, architecture), no claims beyond it. */
const FEATURES = [
  {
    title: 'Gate and visitors',
    body: 'Residents invite visitors with a QR code and PIN. Guards check passes on a gate phone, even offline, ask households about walk-ins and log deliveries. Every entry and exit is recorded.',
  },
  {
    title: 'SOS and incidents',
    body: 'Residents raise an SOS from their phone. Your guards and managers are alerted at once and can acknowledge, respond and resolve it. Guards report incidents with photos.',
  },
  {
    title: 'Billing and payments',
    body: 'Set charges, run billing, and let residents pay by card or transfer. Money settles directly to the estate’s account; Safezone never holds it.',
  },
  {
    title: 'Maintenance and facilities',
    body: 'Residents report problems and book shared facilities. Your team assigns and tracks the work.',
  },
  {
    title: 'Community',
    body: 'Official announcements, estate and building channels, polls and shared documents.',
  },
  {
    title: 'Security team',
    body: 'Shared gate phones with guard PIN sign-in, shift handover notes and a supervisor view of guards and devices.',
  },
];

const STEPS = [
  'Apply online with your estate’s details, or ask us to set it up with you.',
  'Techguard reviews the application and opens your estate’s workspace.',
  'Add your gates and units, invite your managers and guards, and share the join code with residents.',
];

export default function EstatesPage() {
  return (
    <>
      <PageTitle title={t('public.estates.title')} lead={t('public.estates.lead')} />
      <h2 style={{ fontSize: typography.size.xl }}>{t('public.estates.featuresTitle')}</h2>
      <div
        style={{
          display: 'grid',
          gap: spacing[4],
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        }}
      >
        {FEATURES.map((feature) => (
          <Card key={feature.title} title={feature.title}>
            <p style={{ margin: 0 }}>{feature.body}</p>
          </Card>
        ))}
      </div>
      <h2 style={{ fontSize: typography.size.xl, marginTop: spacing[7] }}>
        {t('public.estates.howTitle')}
      </h2>
      <ol style={{ maxWidth: 720, lineHeight: typography.lineHeight.relaxed }}>
        {STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <p style={{ display: 'flex', gap: spacing[3], flexWrap: 'wrap', marginTop: spacing[5] }}>
        <Link
          href="/register"
          style={{
            background: colors.brand.primary,
            color: colors.brand.onPrimary,
            padding: `${spacing[3]}px ${spacing[4]}px`,
            borderRadius: radii.md,
            textDecoration: 'none',
            fontWeight: Number(typography.weight.semibold),
          }}
        >
          {t('public.estates.ctaRegister')}
        </Link>
        <Link
          href="/contact"
          style={{
            color: colors.brand.primary,
            padding: `${spacing[3]}px ${spacing[4]}px`,
            borderRadius: radii.md,
            border: `1px solid ${colors.semantic.borderStrong}`,
            textDecoration: 'none',
            fontWeight: Number(typography.weight.semibold),
          }}
        >
          {t('public.estates.ctaTalk')}
        </Link>
      </p>
    </>
  );
}
