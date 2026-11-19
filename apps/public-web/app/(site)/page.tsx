import { t } from '@safezone/i18n';
import { Card } from '@safezone/web-ui';
import { PageTitle } from '../../src/components/site-shell';
import Link from 'next/link';

export default function HomePage() {
  return (
    <>
      <PageTitle title={t('public.home.headline')} />
      <p>{t('app.tagline')}</p>
      <div
        style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        }}
      >
        <Card title="Register your estate">
          <p>Free for every estate. Apply online and Techguard will review your application.</p>
          <Link href="/register">{t('public.home.cta')}</Link>
        </Card>
        <Card title="Prefer help getting set up?">
          <p>Tell us about your estate and our team will set it up with you.</p>
          <Link href="/contact">Talk to us</Link>
        </Card>
      </div>
    </>
  );
}
