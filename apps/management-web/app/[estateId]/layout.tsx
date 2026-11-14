import type { ReactNode } from 'react';
import { EstateShell } from '../../src/components/estate-shell';

export default async function EstateLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ estateId: string }>;
}) {
  const { estateId } = await params;
  return <EstateShell estateId={estateId}>{children}</EstateShell>;
}
