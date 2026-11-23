import type { Metadata } from 'next';
import { t } from '@safezone/i18n';
import { PageTitle } from '../../../src/components/site-shell';
import { RegisterFlow } from '../../../src/register/register-flow';

export const metadata: Metadata = {
  title: t('public.register.metaTitle'),
  description: t('public.register.metaDescription'),
};

/**
 * Self-service estate registration (docs/architecture/apps/public-web.md §5).
 * Onboarding is free: no plan or payment step.
 */
export default function RegisterPage() {
  return (
    <>
      <PageTitle title={t('public.register.title')} lead={t('public.register.lead')} />
      <RegisterFlow />
    </>
  );
}
