import type { Metadata } from 'next';
import { t } from '@safezone/i18n';
import { PageTitle } from '../../../src/components/site-shell';
import { ContactForm } from '../../../src/contact/contact-form';

export const metadata: Metadata = {
  title: t('public.contact.metaTitle'),
  description: t('public.contact.metaDescription'),
};

/**
 * Techguard-assisted onboarding request (public-web.md §6).
 * Creates a lead in the Super Admin onboarding pipeline.
 */
export default function ContactPage() {
  return (
    <>
      <PageTitle title={t('public.contact.title')} lead={t('public.contact.lead')} />
      <ContactForm />
    </>
  );
}
