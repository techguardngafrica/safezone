import { t } from '@safezone/i18n';
import { Card, PageShell } from '@safezone/web-ui';

/** Placeholder overview. Phase 0 adds SSO + MFA sign-in; Phase 1 adds estate applications and assisted onboarding. */
export default function OverviewPage() {
  return (
    <PageShell title={t('admin.home.title')}>
      <div
        style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        }}
      >
        <Card title="Estate applications">
          Self-service applications awaiting review appear here.
        </Card>
        <Card title="Onboarding pipeline">Techguard-assisted estates in setup appear here.</Card>
        <Card title="Platform health">
          SOS synthetic checks, queues and provider delivery rates.
        </Card>
      </div>
    </PageShell>
  );
}
