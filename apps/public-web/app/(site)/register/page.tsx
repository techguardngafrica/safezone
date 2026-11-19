import type { Metadata } from 'next';
import { Card } from '@safezone/web-ui';
import { PageTitle } from '../../../src/components/site-shell';

export const metadata: Metadata = { title: 'Register your estate' };

/**
 * Self-service estate registration (docs/architecture/apps/public-web.md §5).
 * Phase 1: phone + OTP → representative details → estate details → documents → consent → submit.
 * Validate with estateApplicationSchema from @safezone/schemas. Onboarding is free: no plan or payment step.
 */
export default function RegisterPage() {
  return (
    <>
      <PageTitle title={'Register your estate'} />
      <Card>
        <p>Estate registration opens in Phase 1.</p>
      </Card>
    </>
  );
}
