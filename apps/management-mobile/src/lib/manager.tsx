import { type ApiData, unwrap } from '@safezone/api-client';
import type { Permission } from '@safezone/permissions';
import { useQuery } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { api } from './session';

type Memberships = ApiData<'/v1/me/memberships', 'get'>;
export type Membership = Memberships[number];

const ACTIVE_ESTATE_KEY = 'safezone.management.activeEstate';
const MANAGEABLE = new Set(['approved', 'active']);

export function useMemberships() {
  return useQuery({
    queryKey: ['me', 'memberships'],
    queryFn: () => unwrap(api.GET('/v1/me/memberships')),
  });
}

/** Active memberships in estates that can be managed (the same rule as management-web). */
export function manageableMemberships(data: Memberships | undefined): Membership[] {
  return (data ?? []).filter(
    (membership) => membership.status === 'active' && MANAGEABLE.has(membership.estate.status),
  );
}

export interface ManagerContextValue {
  estateId: string;
  estateName: string;
  roles: string[];
  memberships: Membership[];
  switchEstate: (estateId: string) => void;
  /** False until the permissions for the current estate have loaded. */
  accessReady: boolean;
  can: (permission: Permission) => boolean;
  hasFeature: (feature: string) => boolean;
}

const ManagerContext = createContext<ManagerContextValue | null>(null);

export function useManager(): ManagerContextValue {
  const value = useContext(ManagerContext);
  if (!value) throw new Error('useManager must be used inside ManagerProvider');
  return value;
}

/**
 * Picks the estate (last used first, management-mobile.md §5), then loads the user's permissions and
 * the estate's features there. The UI hides what the user cannot do; the API still enforces it.
 */
export function ManagerProvider({
  memberships,
  children,
}: {
  memberships: Membership[];
  children: ReactNode;
}) {
  const [stored, setStored] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    SecureStore.getItemAsync(ACTIVE_ESTATE_KEY)
      .then(setStored)
      .catch(() => setStored(null));
  }, []);
  const active =
    memberships.find((membership) => membership.estate.id === stored) ?? memberships[0];
  const estateId = active?.estate.id ?? '';

  const switchEstate = useCallback((id: string) => {
    setStored(id);
    void SecureStore.setItemAsync(ACTIVE_ESTATE_KEY, id).catch(() => undefined);
  }, []);

  const access = useQuery({
    queryKey: ['me', 'permissions', estateId],
    queryFn: () => unwrap(api.GET('/v1/me/permissions', { params: { query: { estateId } } })),
    enabled: Boolean(estateId),
  });

  const value = useMemo<ManagerContextValue>(() => {
    const permissions = new Set<string>(access.data?.permissions ?? []);
    const features = new Set(access.data?.features ?? []);
    const ordered = active
      ? [active, ...memberships.filter((item) => item.estate.id !== active.estate.id)]
      : memberships;
    return {
      estateId,
      estateName: active?.estate.name ?? '',
      roles: active?.roles ?? [],
      memberships: ordered,
      switchEstate,
      accessReady: access.isSuccess,
      can: (permission) => permissions.has(permission),
      hasFeature: (feature) => features.has(feature),
    };
  }, [access.data, access.isSuccess, active, estateId, memberships, switchEstate]);

  if (stored === undefined) return null;
  return <ManagerContext.Provider value={value}>{children}</ManagerContext.Provider>;
}
