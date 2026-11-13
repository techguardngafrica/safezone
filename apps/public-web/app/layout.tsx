import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: { default: 'Safezone — Safer, smarter estates', template: '%s · Safezone' },
  description:
    'Safezone by Techguard: visitor management, SOS, estate payments, maintenance and community for residential estates in Nigeria.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
