import { colors, typography } from '@safezone/design-tokens';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Super Admin | Safezone',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: colors.brand.primary };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
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
