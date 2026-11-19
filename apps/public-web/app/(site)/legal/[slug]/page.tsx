import { colors, radii, spacing, typography } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { adPolicy } from '../../../../content/legal/ad-policy';
import { cookies } from '../../../../content/legal/cookies';
import { privacy } from '../../../../content/legal/privacy';
import { terms } from '../../../../content/legal/terms';
import type { LegalDocument } from '../../../../content/types';
import { PageTitle, Prose } from '../../../../src/components/site-shell';
import { site } from '../../../../src/site';

const DOCUMENTS: Record<string, LegalDocument> = {
  terms,
  privacy,
  cookies,
  'ad-policy': adPolicy,
};

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(DOCUMENTS).map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const document = DOCUMENTS[(await params).slug];
  if (!document) return {};
  return {
    title: document.title,
    description: document.description,
    alternates: { canonical: `/legal/${document.slug}` },
    openGraph: { title: document.title, description: document.description },
  };
}

/** Legal pages (public-web.md §3). Drafts written from how the product works, pending legal review. */
export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const document = DOCUMENTS[(await params).slug];
  if (!document) notFound();
  const operator = site.operator.legalName
    ? [site.operator.legalName, site.operator.registrationNumber, site.operator.address]
        .filter(Boolean)
        .join(', ')
    : t('public.legal.operatorPending');

  return (
    <>
      <PageTitle title={document.title} lead={document.description} />
      <p
        role="note"
        style={{
          maxWidth: 720,
          margin: `0 0 ${spacing[5]}px`,
          padding: spacing[3],
          borderRadius: radii.md,
          background: colors.statusSubtle.warning.background,
          color: colors.statusSubtle.warning.text,
          fontSize: typography.size.sm,
        }}
      >
        {t('public.legal.draft')}
      </p>
      <Prose>
        <p style={{ color: colors.semantic.textMuted }}>
          {t('public.legal.updated', { date: site.legalUpdated })}
        </p>
        {document.sections.map((section) => (
          <section key={section.heading}>
            <h2 style={{ fontSize: typography.size.xl, marginTop: spacing[6] }}>
              {section.heading}
            </h2>
            {(section.paragraphs ?? []).map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            {section.items ? (
              <ul>
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
        <section>
          <h2 style={{ fontSize: typography.size.xl, marginTop: spacing[6] }}>
            {t('public.nav.contact')}
          </h2>
          <p>{t('public.legal.operator', { name: operator })}</p>
          <p>
            {document.slug === 'privacy' && !site.contact.privacy
              ? t('public.legal.privacyContactPending', { email: site.contact.support })
              : t('public.legal.contact', {
                  email:
                    document.slug === 'privacy' && site.contact.privacy
                      ? site.contact.privacy
                      : site.contact.support,
                })}
          </p>
        </section>
      </Prose>
    </>
  );
}
