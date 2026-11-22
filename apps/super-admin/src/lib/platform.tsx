'use client';

import { unwrap } from '@safezone/api-client';
import type { Permission } from '@safezone/permissions';
import { useQuery } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, session } from '../../lib/session';

/** Sessions expire after 15 minutes idle (super-admin.md §7). */
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

export interface PlatformAccessValue {
  roles: string[];
  permissions: Set<Permission>;
  can: (permission: Permission | readonly Permission[]) => boolean;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
}

const PlatformContext = createContext<PlatformAccessValue | null>(null);

export function PlatformProvider({ children }: { children: ReactNode }) {
  const query = useQuery({
    queryKey: ['me', 'permissions', 'platform'],
    queryFn: () => unwrap(api.GET('/v1/me/permissions')),
    staleTime: 60_000,
  });

  const permissions = useMemo(
    () => new Set<Permission>((query.data?.permissions ?? []) as Permission[]),
    [query.data],
  );

  const can = useCallback(
    (permission: Permission | readonly Permission[]) => {
      const list = Array.isArray(permission) ? permission : [permission];
      return list.some((p) => permissions.has(p as Permission));
    },
    [permissions],
  );

  const value = useMemo<PlatformAccessValue>(
    () => ({
      roles: query.data?.roles ?? [],
      permissions,
      can,
      isLoading: query.isPending,
      isError: query.isError,
      error: query.error,
      refetch: () => void query.refetch(),
    }),
    [query, permissions, can],
  );

  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>;
}

export function usePlatform(): PlatformAccessValue {
  const ctx = useContext(PlatformContext);
  if (!ctx) throw new Error('usePlatform must be used inside PlatformProvider');
  return ctx;
}

/** Auto-signs out after 15 minutes of inactivity and exposes a flag for the sign-in screen. */
export function useIdleTimeout(active: boolean) {
  const [timedOut, setTimedOut] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!active) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }
    const reset = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setTimedOut(true);
        void session.signOut();
      }, IDLE_TIMEOUT_MS);
    };
    reset();
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'scroll'];
    for (const ev of events) window.addEventListener(ev, reset, { passive: true });
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      for (const ev of events) window.removeEventListener(ev, reset);
    };
  }, [active]);

  return { timedOut, clearTimedOut: () => setTimedOut(false) };
}
