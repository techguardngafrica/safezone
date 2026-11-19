import { colors, spacing, typography } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import type { Metadata } from 'next';
import { helpGroups } from '../../../content/help';
import { PageTitle, Prose } from '../../../src/components/site-shell';
import { site } from '../../../src/site';

export const metadata: Metadata = {
  title: 'Help',
  description:
    'Answers for Safezone residents, estate managers and security officers: joining an estate, visitor passes, SOS, payments and gate phones.',
  alternates: { canonical: '/help' },
};

/** FAQ structured data (public-web.md §9). */
const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: helpGroups.flatMap((group) =>
    group.articles.map((article) => ({
      '@type': 'Question',
      name: article.question,
      acceptedAnswer: { '@type': 'Answer', text: article.answer.join(' ') },
    })),
  ),
};

export default function HelpPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <PageTitle title={t('public.help.title')} lead={t('public.help.lead')} />
      <Prose>
        {helpGroups.map((group) => (
          <section key={group.id} id={group.id}>
            <h2 style={{ fontSize: typography.size.xl, marginTop: spacing[6] }}>{group.title}</h2>
            {group.articles.map((article) => (
              <details key={article.id} id={article.id} style={{ marginBottom: spacing[3] }}>
                <summary
                  style={{
                    cursor: 'pointer',
                    minHeight: 44,
                    display: 'flex',
                    alignItems: 'center',
                    fontWeight: Number(typography.weight.semibold),
                  }}
                >
                  <h3 style={{ fontSize: typography.size.md, margin: 0 }}>{article.question}</h3>
                </summary>
                {article.answer.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </details>
            ))}
          </section>
        ))}
        <p style={{ color: colors.semantic.textMuted, marginTop: spacing[6] }}>
          {t('public.help.more', { email: site.contact.support })}
        </p>
      </Prose>
    </>
  );
}
