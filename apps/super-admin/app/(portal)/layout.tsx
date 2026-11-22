import type { ReactNode } from 'react';
import { PlatformShell } from '../../src/components/platform-shell';

export default function PortalLayout({ children }: { children: ReactNode }) {
  return <PlatformShell>{children}</PlatformShell>;
}
