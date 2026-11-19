import { colors, typography } from '@safezone/design-tokens';
import { webUiCss } from '@safezone/web-ui';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { site } from '../src/site';
import { Providers } from './providers';

const description =
  'Safezone by Techguard: visitor management, SOS, estate payments, maintenance and community for residential estates in Nigeria.';

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: 'Safezone: estate security and management', template: '%s | Safezone' },
  description,
  openGraph: { type: 'website', siteName: 'Safezone', locale: 'en_NG', description },
  twitter: { card: 'summary', description },
};

export const viewport: Viewport = { themeColor: colors.brand.primary };

/** Skip link shows only when focused by keyboard. */
const siteCss = `.sz-skip:focus{position:fixed;left:8px;top:8px;width:auto;height:auto;clip:auto;margin:0;padding:8px 12px;background:${colors.semantic.surface};z-index:10}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: webUiCss + siteCss }} />
      </head>
      <body
        style={{
          margin: 0,
          background: colors.semantic.background,
          color: colors.semantic.text,
          fontFamily: typography.fontFamily.sans,
        }}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
