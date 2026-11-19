import { type ApiData, ApiClientError, unwrap } from '@safezone/api-client';
import { useSession } from '@safezone/mobile-ui';
import { GATE_SESSION_PERMISSIONS } from '@safezone/permissions';
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
import { offlineStore } from '../offline/store';
import { type GateSync, useGateSync } from '../offline/use-gate-sync';
import { useGateDevice } from './device';
import { api, session } from './session';

type Memberships = ApiData<'/v1/me/memberships', 'get'>;
export type Membership = Memberships[number];
export type Gate = ApiData<'/v1/estates/{estateId}/gates', 'get'>[number];

const SELECTION_KEY = 'safezone.security.selection';
const USABLE_ESTATE = new Set(['approved', 'active']);

interface Selection {
  estateId: string | null;
  gateId: string | null;
}

/**
 * Fetches and keeps a copy on the device; with no connection, answers from that copy instead
 * (gate devices must start offline from the last known state).
 */
async function withSnapshot<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  try {
    const value = await fetcher();
    offlineStore.setSnapshot(key, value);
    return value;
  } catch (error) {
    const saved = offlineStore.snapshot<T>(key);
    if (saved !== null && error instanceof ApiClientError && error.code === 'NETWORK_ERROR')
      return saved;
    throw error;
  }
}

export function useMemberships() {
  return useQuery({
    queryKey: ['me', 'memberships'],
    queryFn: () => withSnapshot('memberships', () => unwrap(api.GET('/v1/me/memberships'))),
  });
}

export function usableMemberships(data: Memberships | undefined): Membership[] {
  return (data ?? []).filter(
    (membership) => membership.status === 'active' && USABLE_ESTATE.has(membership.estate.status),
  );
}

interface GateContextValue {
  estateId: string;
  estateName: string;
  memberships: Membership[];
  switchEstate: (estateId: string) => void;
  gates: Gate[];
  gatesLoading: boolean;
  gate: Gate | null;
  chooseGate: (gateId: string | null) => void;
  /** This phone is a registered gate device: estate and gate cannot change here. */
  fixedDevice: boolean;
  permissionsLoaded: boolean;
  can: (permission: string) => boolean;
  hasFeature: (feature: string) => boolean;
  sync: GateSync;
}

const GateContext = createContext<GateContextValue | null>(null);

export function useGate(): GateContextValue {
  const value = useContext(GateContext);
  if (!value) throw new Error('useGate must be used inside GateProvider');
  return value;
}

/**
 * The estate and gate this device serves, the guard's permissions there, and the offline sync engine.
 * The choice is kept in secure storage so a mounted gate phone reopens on the same gate.
 */
export function GateProvider({
  memberships,
  children,
}: {
  memberships: Membership[];
  children: ReactNode;
}) {
  const [selection, setSelection] = useState<Selection | undefined>(undefined);
  useEffect(() => {
    SecureStore.getItemAsync(SELECTION_KEY)
      .then((value) => {
        const parsed = value ? (JSON.parse(value) as Selection) : null;
        setSelection(parsed ?? { estateId: null, gateId: null });
      })
      .catch(() => setSelection({ estateId: null, gateId: null }));
  }, []);

  const save = useCallback((next: Selection) => {
    setSelection(next);
    void SecureStore.setItemAsync(SELECTION_KEY, JSON.stringify(next)).catch(() => undefined);
  }, []);

  // A registered gate device is fixed to its estate and gate (ADR-0017).
  const { device } = useGateDevice();
  const wanted = device?.estateId ?? selection?.estateId;
  const active =
    memberships.find((membership) => membership.estate.id === wanted) ?? memberships[0];
  const estateId = active?.estate.id ?? '';

  const access = useQuery({
    queryKey: ['me', 'permissions', estateId],
    queryFn: () =>
      withSnapshot(`permissions:${estateId}`, () =>
        unwrap(api.GET('/v1/me/permissions', { params: { query: { estateId } } })),
      ),
    enabled: Boolean(estateId),
  });
  const gatesQuery = useQuery({
    queryKey: ['estate', estateId, 'gates'],
    queryFn: () =>
      withSnapshot(`gates:${estateId}`, () =>
        unwrap(api.GET('/v1/estates/{estateId}/gates', { params: { path: { estateId } } })),
      ),
    enabled: Boolean(estateId),
  });
  const gates = useMemo(
    () => (gatesQuery.data ?? []).filter((gate) => gate.status === 'active'),
    [gatesQuery.data],
  );
  const gateId =
    device && device.estateId === estateId
      ? device.gateId
      : selection?.estateId === estateId
        ? selection.gateId
        : null;
  const gate =
    gates.find((item) => item.id === gateId) ??
    (device && gateId === device.gateId
      ? {
          id: device.gateId,
          name: device.gateName,
          type: 'both' as const,
          status: 'active' as const,
        }
      : null);

  const sync = useGateSync(estateId, gate?.id ?? null);

  const offline = useSession(session).offline === true;
  const value = useMemo<GateContextValue>(() => {
    // An offline PIN sign-in works within the gate ceiling only (ADR-0017 point 6).
    const permissions = new Set<string>(
      offline ? GATE_SESSION_PERMISSIONS : (access.data?.permissions ?? []),
    );
    const features = new Set(access.data?.features ?? []);
    return {
      estateId,
      estateName: active?.estate.name ?? '',
      memberships,
      switchEstate: (id) => {
        if (!device) save({ estateId: id, gateId: null });
      },
      gates,
      gatesLoading: gatesQuery.isPending && gatesQuery.fetchStatus !== 'idle',
      gate,
      chooseGate: (id) => {
        if (!device) save({ estateId, gateId: id });
      },
      fixedDevice: Boolean(device),
      permissionsLoaded: offline || access.isSuccess,
      can: (permission) => permissions.has(permission),
      hasFeature: (feature) => features.has(feature),
      sync,
    };
  }, [
    access.data,
    access.isSuccess,
    active,
    device,
    offline,
    estateId,
    gate,
    gates,
    gatesQuery.fetchStatus,
    gatesQuery.isPending,
    memberships,
    save,
    sync,
  ]);

  if (selection === undefined) return null;
  return <GateContext.Provider value={value}>{children}</GateContext.Provider>;
}
