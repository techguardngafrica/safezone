import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AdvertiserShell } from '../../src/advertiser/advertiser-shell';

export const metadata: Metadata = {
  title: { default: 'Advertiser area', template: '%s | Advertiser area | Safezone' },
  description: 'Your Safezone advertising campaigns, creatives, results and invoices.',
  robots: { index: false, follow: false },
};

export default function AdvertiserLayout({ children }: { children: ReactNode }) {
  return <AdvertiserShell>{children}</AdvertiserShell>;
}
