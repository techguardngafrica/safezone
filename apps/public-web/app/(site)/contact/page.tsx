import type { Metadata } from 'next';
import { Card } from '@safezone/web-ui';
import { PageTitle } from '../../../src/components/site-shell';

export const metadata: Metadata = { title: 'Talk to us' };

/**
 * Techguard-assisted onboarding request (public-web.md §6). Validate with onboardingLeadSchema.
 * Creates a lead in the Super Admin onboarding pipeline.
 */
export default function ContactPage() {
  return (
    <>
      <PageTitle title={'Talk to us'} />
      <Card>
        <p>The assisted onboarding form opens in Phase 1.</p>
      </Card>
    </>
  );
}
