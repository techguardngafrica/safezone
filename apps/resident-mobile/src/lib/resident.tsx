import { type ApiData, unwrap } from '@safezone/api-client';
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
export type Household = ApiData<'/v1/estates/{estateId}/households/mine', 'get'>[number];

const ACTIVE_ESTATE_KEY = 'safezone.activeEstate';
const USABLE_ESTATE = new Set(['approved', 'active']);

export function useMemberships() {
  return useQuery({
    queryKey: ['me', 'memberships'],
    queryFn: () => unwrap(api.GET('/v1/me/memberships')),
  });
}

/** Active memberships in estates that are open for residents. */
export function usableMemberships(data: Memberships | undefined): Membership[] {
  return (data ?? []).filter(
    (membership) => membership.status === 'active' && USABLE_ESTATE.has(membership.estate.status),
  );
}

interface ResidentContextValue {
  estateId: string;
  estateName: string;
  memberships: Membership[];
  switchEstate: (estateId: string) => void;
  household: Household | null;
  householdLoading: boolean;
  can: (permission: string) => boolean;
  hasFeature: (feature: string) => boolean;
}

const ResidentContext = createContext<ResidentContextValue | null>(null);

export function useResident(): ResidentContextValue {
  const value = useContext(ResidentContext);
  if (!value) throw new Error('useResident must be used inside ResidentProvider');
  return value;
}

/** Picks the estate (last used first), then loads permissions and the user's household there. */
export function ResidentProvider({
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
  const households = useQuery({
    queryKey: ['estate', estateId, 'households', 'mine'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/households/mine', { params: { path: { estateId } } })),
    enabled: Boolean(estateId) && (access.data?.features.includes('occupancy') ?? false),
  });

  const value = useMemo<ResidentContextValue>(() => {
    const permissions = new Set(access.data?.permissions ?? []);
    const features = new Set(access.data?.features ?? []);
    return {
      estateId,
      estateName: active?.estate.name ?? '',
      memberships,
      switchEstate,
      household: households.data?.find((item) => item.status === 'active') ?? null,
      householdLoading: households.isPending && households.fetchStatus !== 'idle',
      can: (permission) => permissions.has(permission),
      hasFeature: (feature) => features.has(feature),
    };
  }, [
    access.data,
    active,
    estateId,
    households.data,
    households.fetchStatus,
    households.isPending,
    memberships,
    switchEstate,
  ]);

  if (stored === undefined) return null;
  return <ResidentContext.Provider value={value}>{children}</ResidentContext.Provider>;
}
