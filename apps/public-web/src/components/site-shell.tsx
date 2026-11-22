import { colors, radii, spacing, typography } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { site } from '../site';

const NAV = [
  { href: '/estates', label: 'public.nav.estates' },
  { href: '/vendors', label: 'public.nav.vendors' },
  { href: '/advertise', label: 'public.nav.advertise' },
  { href: '/download', label: 'public.nav.download' },
  { href: '/help', label: 'public.nav.help' },
  { href: '/contact', label: 'public.nav.contact' },
] as const;

const LEGAL = [
  { href: '/legal/terms', label: 'public.legal.terms' },
  { href: '/legal/privacy', label: 'public.legal.privacy' },
  { href: '/legal/cookies', label: 'public.legal.cookies' },
  { href: '/legal/ad-policy', label: 'public.legal.adPolicy' },
] as const;

const wrap: CSSProperties = { maxWidth: 1040, margin: '0 auto', padding: `0 ${spacing[4]}px` };
const link: CSSProperties = {
  color: colors.brand.primary,
  textDecoration: 'none',
  fontWeight: Number(typography.weight.semibold),
  minHeight: 44,
  display: 'inline-flex',
  alignItems: 'center',
};

/** Header and footer for public pages (not the visitor pass page, which stays minimal). */
export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <a href="#main" className="sz-visually-hidden sz-skip">
        {t('public.skipToContent')}
      </a>
      <header
        style={{
          borderBottom: `1px solid ${colors.semantic.border}`,
          background: colors.semantic.surface,
        }}
      >
        <nav
          aria-label={t('public.nav.label')}
          style={{
            ...wrap,
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: spacing[4],
            paddingTop: spacing[2],
            paddingBottom: spacing[2],
          }}
        >
          <Link
            href="/"
            style={{
              ...link,
              fontSize: typography.size.lg,
              fontWeight: Number(typography.weight.bold),
              marginRight: 'auto',
            }}
          >
            {site.name}
          </Link>
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} style={link}>
              {t(item.label)}
            </Link>
          ))}
          <Link
            href="/register"
            style={{
              ...link,
              color: colors.brand.onPrimary,
              background: colors.brand.primary,
              borderRadius: radii.md,
              padding: `0 ${spacing[4]}px`,
            }}
          >
            {t('public.nav.register')}
          </Link>
        </nav>
      </header>
      <main
        id="main"
        style={{
          ...wrap,
          width: '100%',
          boxSizing: 'border-box',
          flex: 1,
          paddingTop: spacing[6],
          paddingBottom: spacing[7],
        }}
      >
        {children}
      </main>
      <footer
        style={{
          borderTop: `1px solid ${colors.semantic.border}`,
          background: colors.semantic.surface,
        }}
      >
        <div
          style={{
            ...wrap,
            paddingTop: spacing[5],
            paddingBottom: spacing[5],
            display: 'grid',
            gap: spacing[3],
          }}
        >
          <nav
            aria-label={t('public.legal.label')}
            style={{ display: 'flex', flexWrap: 'wrap', gap: spacing[4] }}
          >
            {LEGAL.map((item) => (
              <Link key={item.href} href={item.href} style={link}>
                {t(item.label)}
              </Link>
            ))}
            <Link href="/status" style={link}>
              {t('public.nav.status')}
            </Link>
          </nav>
          <p style={{ margin: 0, color: colors.semantic.textMuted, fontSize: typography.size.sm }}>
            {t('public.footer.operator', { name: site.name, brand: site.operator.brand })}
          </p>
        </div>
      </footer>
    </div>
  );
}

/** Long-form text block with readable measure. */
export function Prose({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        maxWidth: 720,
        lineHeight: typography.lineHeight.relaxed,
        fontSize: typography.size.md,
      }}
    >
      {children}
    </div>
  );
}

export function PageTitle({ title, lead }: { title: string; lead?: string }) {
  return (
    <div style={{ marginBottom: spacing[5] }}>
      <h1 style={{ margin: 0, fontSize: typography.size.xxl, color: colors.semantic.text }}>
        {title}
      </h1>
      {lead ? (
        <p
          style={{
            marginTop: spacing[2],
            color: colors.semantic.textMuted,
            fontSize: typography.size.lg,
            maxWidth: 720,
          }}
        >
          {lead}
        </p>
      ) : null}
    </div>
  );
}
