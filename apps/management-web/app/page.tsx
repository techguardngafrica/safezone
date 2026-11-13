import { t } from '@safezone/i18n';
import { Card, PageShell } from '@safezone/web-ui';

/** Placeholder dashboard. Phase 0 adds sign-in; Phase 1 adds the setup wizard and live gate view. */
export default function HomePage() {
  return (
    <PageShell title={t('management.home.title')}>
      <div
        style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        }}
      >
        <Card title="Active SOS">No active alerts.</Card>
        <Card title="Visitors today">Gate activity appears here.</Card>
        <Card title="Pending approvals">Join requests and staff passes appear here.</Card>
      </div>
    </PageShell>
  );
}
