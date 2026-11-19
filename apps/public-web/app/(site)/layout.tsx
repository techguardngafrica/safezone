import type { ReactNode } from 'react';
import { SiteShell } from '../../src/components/site-shell';

/** Public pages share the header and footer (legal links on every page). The pass page does not. */
export default function SiteLayout({ children }: { children: ReactNode }) {
  return <SiteShell>{children}</SiteShell>;
}
