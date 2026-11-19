import { spacing } from '@safezone/design-tokens';
import { type MessageKey, t } from '@safezone/i18n';
import { Card } from '@safezone/web-ui';
import type { Metadata } from 'next';
import { PageTitle } from '../../../src/components/site-shell';
import { site } from '../../../src/site';

export const metadata: Metadata = {
  title: 'Get the apps',
  description: 'The Safezone Resident, Estate Management and Security apps for Android and iPhone.',
  alternates: { canonical: '/download' },
};

const APPS: { key: keyof typeof site.stores; title: MessageKey; body: MessageKey }[] = [
  { key: 'resident', title: 'public.download.resident', body: 'public.download.residentBody' },
  {
    key: 'management',
    title: 'public.download.management',
    body: 'public.download.managementBody',
  },
  { key: 'security', title: 'public.download.security', body: 'public.download.securityBody' },
];

/** App links (public-web.md §3). No store links until each app is published: nothing is faked. */
export default function DownloadPage() {
  return (
    <>
      <PageTitle title={t('public.download.title')} lead={t('public.download.lead')} />
      <div
        style={{
          display: 'grid',
          gap: spacing[4],
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        }}
      >
        {APPS.map((app) => {
          const links = site.stores[app.key];
          return (
            <Card key={app.key} title={t(app.title)}>
              <p>{t(app.body)}</p>
              {links.googlePlay || links.appStore ? (
                <p style={{ display: 'flex', gap: spacing[3], flexWrap: 'wrap' }}>
                  {links.googlePlay ? (
                    <a href={links.googlePlay}>{t('public.download.googlePlay')}</a>
                  ) : null}
                  {links.appStore ? (
                    <a href={links.appStore}>{t('public.download.appStore')}</a>
                  ) : null}
                </p>
              ) : (
                <p>
                  <strong>{t('public.download.soon')}</strong>
                </p>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}
