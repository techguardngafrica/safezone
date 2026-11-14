'use client';

import { unwrap } from '@safezone/api-client';
import type { Permission } from '@safezone/permissions';
import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './session';

export interface EstateContextValue {
  estateId: string;
  estateName: string;
  estateStatus: string | null;
  roles: string[];
  can: (permission: Permission) => boolean;
  hasFeature: (feature: string) => boolean;
}

const EstateContext = createContext<EstateContextValue | null>(null);

export function useEstate(): EstateContextValue {
  const value = useContext(EstateContext);
  if (!value) throw new Error('useEstate must be used inside EstateProvider');
  return value;
}

export function useMemberships() {
  return useQuery({
    queryKey: ['me', 'memberships'],
    queryFn: () => unwrap(api.GET('/v1/me/memberships')),
  });
}

/** Loads the signed-in user's roles, permissions and the estate's features for the current estate. */
export function useEstateAccess(estateId: string) {
  return useQuery({
    queryKey: ['me', 'permissions', estateId],
    queryFn: () => unwrap(api.GET('/v1/me/permissions', { params: { query: { estateId } } })),
  });
}

export function EstateProvider({
  estateId,
  estateName,
  estateStatus,
  roles,
  permissions,
  features,
  children,
}: {
  estateId: string;
  estateName: string;
  estateStatus: string | null;
  roles: string[];
  permissions: string[];
  features: string[];
  children: ReactNode;
}) {
  const value = useMemo<EstateContextValue>(() => {
    const granted = new Set(permissions);
    const enabled = new Set(features);
    return {
      estateId,
      estateName,
      estateStatus,
      roles,
      can: (permission) => granted.has(permission),
      hasFeature: (feature) => enabled.has(feature),
    };
  }, [estateId, estateName, estateStatus, roles, permissions, features]);
  return <EstateContext.Provider value={value}>{children}</EstateContext.Provider>;
}
