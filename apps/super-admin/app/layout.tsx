import { colors } from '@safezone/design-tokens';
import { webUiCss } from '@safezone/web-ui';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Super Admin | Safezone',
  description: 'Techguard internal control plane for Safezone.',
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
