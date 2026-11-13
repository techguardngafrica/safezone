import type { Metadata } from 'next';
import { t } from '@safezone/i18n';
import { Card, PageShell } from '@safezone/web-ui';

export const metadata: Metadata = {
  title: 'Visitor pass',
  robots: { index: false, follow: false },
};

/**
 * Visitor pass page (public-web.md §4). Visitors have no app and no account.
 * Phase 1: fetch GET /v1/public/passes/:token (random public token, never the signed QR payload),
 * render the QR code and PIN large, validity, gate, status and directions. No ads, no analytics trackers.
 */
export default async function VisitorPassPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <PageShell title={t('public.pass.title')}>
      <Card>
        <p>Pass reference: {token.slice(0, 6)}…</p>
        <p>The QR code and PIN appear here once visitor passes launch in Phase 1.</p>
      </Card>
    </PageShell>
  );
}
