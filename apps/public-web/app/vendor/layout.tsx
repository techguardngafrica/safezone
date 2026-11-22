import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { VendorShell } from '../../src/vendor/vendor-shell';

export const metadata: Metadata = {
  title: { default: 'Vendor Portal', template: '%s | Vendor Portal | Safezone' },
  description: 'Manage your Safezone vendor account, listings and orders.',
  robots: { index: false, follow: false },
};

/** Vendor Portal (public-web.md §8). Signed in, not indexed. */
export default function VendorLayout({ children }: { children: ReactNode }) {
  return <VendorShell>{children}</VendorShell>;
}
