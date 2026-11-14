import { colors } from '@safezone/design-tokens';
import { webUiCss } from '@safezone/web-ui';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Estate Management | Safezone',
  description: 'Run your estate: residents, gates, SOS, finance, maintenance and community.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: colors.brand.primary };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: webUiCss }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
