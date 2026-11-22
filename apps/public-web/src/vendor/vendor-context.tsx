'use client';

import type { ApiRow } from '@safezone/api-client';
import { type Permission, permissionsForRoles } from '@safezone/permissions';
import { createContext, type ReactNode, useContext, useMemo } from 'react';

export type MyVendor = ApiRow<'/v1/me/vendors', 'get'>;

interface VendorContextValue {
  vendor: MyVendor;
  vendorId: string;
  /** What the caller's vendor role allows. The API is still the enforcement point. */
  can: (permission: Permission) => boolean;
}

const VendorContext = createContext<VendorContextValue | null>(null);

export function VendorProvider({ vendor, children }: { vendor: MyVendor; children: ReactNode }) {
  const value = useMemo(() => {
    const granted = permissionsForRoles([vendor.role]);
    return { vendor, vendorId: vendor.id, can: (p: Permission) => granted.has(p) };
  }, [vendor]);
  return <VendorContext.Provider value={value}>{children}</VendorContext.Provider>;
}

export function useVendor(): VendorContextValue {
  const value = useContext(VendorContext);
  if (!value) throw new Error('useVendor outside VendorProvider');
  return value;
}
