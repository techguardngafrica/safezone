import { ApiClientError, newIdempotencyKey, unwrap } from '@safezone/api-client';
import { useNetworkState } from 'expo-network';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { gateDevice, deviceApi } from '../lib/device';
import { api, session } from '../lib/session';
import { offlineStore, type QueuedEvent } from './store';
import { verifyOffline, type Credential, type OfflineCache, type VerifyResult } from './verify';

const TICK_MS = 30_000;
const KEYS_EVERY_MS = 60 * 60_000;
const EXPECTED_EVERY_MS = 3 * 60_000;
const REVOCATIONS_EVERY_MS = 2 * 60_000;
/** First revocation fetch looks back this far: recurring staff passes can live for months. */
const REVOCATION_LOOKBACK_MS = 90 * 86_400_000;

export type NewGateEvent = Omit<QueuedEvent, 'clientUuid' | 'gateId' | 'occurredAt'>;

function isNetwork(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === 'NETWORK_ERROR';
}

/**
 * Keeps the offline cache fresh and the sync queue drained (security-mobile.md §8): keys hourly,
 * revocations every 2 minutes, the expected list every 3 minutes, queued events every 30 seconds.
 * Verification tries the API first and falls back to the signed-pass check when there is no connection.
 */
export function useGateSync(estateId: string, gateId: string | null) {
  const network = useNetworkState();
  const reachable = network.isConnected !== false && network.isInternetReachable !== false;
  const [apiDown, setApiDown] = useState(false);
  const online = reachable && !apiDown;

  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((value) => value + 1), []);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [rejected, setRejected] = useState(0);
  const last = useRef({ keys: 0, expected: 0, revocations: 0 });
  const running = useRef(false);

  useEffect(() => {
    last.current = { keys: 0, expected: 0, revocations: 0 };
  }, [estateId, gateId]);

  const cache = useMemo<OfflineCache | null>(() => {
    if (!estateId || !gateId) return null;
    return {
      estateId,
      gateId,
      keys: offlineStore.keys(estateId),
      expected: offlineStore.expected(estateId, gateId),
      revokedPassIds: new Set(offlineStore.revocations(estateId)?.passIds ?? []),
      pendingUses: offlineStore.pendingUses(estateId),
    };
    // `version` is a dependency on purpose: it re-reads the store after every write.
  }, [estateId, gateId, version]);

  const pendingCount = useMemo(
    () => (estateId ? offlineStore.pendingCount(estateId) : 0),
    [estateId, version],
  );

  const flush = useCallback(async () => {
    const batch = offlineStore.pending(estateId);
    if (batch.length === 0) return;
    const deviceNow = new Date().toISOString();
    const signedOffline = batch.filter((event) => event.offlineGuardUserId);
    const normal = batch.filter((event) => !event.offlineGuardUserId);
    let rejectedCount = 0;
    const done: string[] = [];
    // Events of an offline PIN sign-in go with the device credential; the server flags them.
    const device = gateDevice.current();
    if (signedOffline.length > 0 && device) {
      const result = await unwrap(
        deviceApi.POST('/v1/gate-devices/sync', {
          body: {
            deviceCredential: device.credential,
            deviceNow,
            events: signedOffline.map(({ offlineGuardUserId, ...event }) => ({
              ...event,
              guardUserId: offlineGuardUserId as string,
            })),
          },
        }),
      );
      rejectedCount += result.rejected.length;
      done.push(...signedOffline.map((event) => event.clientUuid));
    }
    // The rest needs a guard session; an offline sign-in has none yet.
    if (normal.length > 0 && !session.getState().offline) {
      const result = await unwrap(
        api.POST('/v1/estates/{estateId}/gate/sync', {
          params: { path: { estateId } },
          body: { deviceNow, events: normal },
        }),
      );
      rejectedCount += result.rejected.length;
      done.push(...normal.map((event) => event.clientUuid));
    }
    // Accepted and duplicate events are done; rejected ones can never succeed, so they leave the queue
    // too and the guard is told how many (the supervisor sees the gap in the visitor log).
    offlineStore.remove(done);
    if (rejectedCount > 0) setRejected((value) => value + rejectedCount);
  }, [estateId]);

  const refresh = useCallback(
    async (force = false) => {
      if (!estateId || !gateId || running.current) return;
      running.current = true;
      const now = Date.now();
      try {
        await flush();
        // An offline PIN sign-in has no token: only device-credential sync is possible.
        if (session.getState().offline) return;
        if (force || now - last.current.keys > KEYS_EVERY_MS) {
          const keys = await unwrap(
            api.GET('/v1/estates/{estateId}/gate/keys', { params: { path: { estateId } } }),
          );
          offlineStore.setKeys(estateId, keys);
          last.current.keys = now;
        }
        if (force || now - last.current.revocations > REVOCATIONS_EVERY_MS) {
          const previous = offlineStore.revocations(estateId);
          const since = previous?.syncedAt ?? new Date(now - REVOCATION_LOOKBACK_MS).toISOString();
          const changes = await unwrap(
            api.GET('/v1/estates/{estateId}/gate/revocations', {
              params: { path: { estateId }, query: { since } },
            }),
          );
          const ids = new Set(previous?.passIds ?? []);
          for (const item of changes.revoked) ids.add(item.passId);
          offlineStore.setRevocations(estateId, {
            syncedAt: changes.generatedAt,
            passIds: [...ids],
          });
          last.current.revocations = now;
        }
        if (force || now - last.current.expected > EXPECTED_EVERY_MS) {
          const list = await unwrap(
            api.GET('/v1/estates/{estateId}/gate/expected', {
              params: { path: { estateId }, query: { gateId, hours: 24 } },
            }),
          );
          offlineStore.setExpected(estateId, gateId, list);
          last.current.expected = now;
        }
        setApiDown(false);
        setLastSyncAt(new Date().toISOString());
      } catch (error) {
        if (isNetwork(error)) setApiDown(true);
      } finally {
        running.current = false;
        bump();
      }
    },
    [bump, estateId, flush, gateId],
  );

  useEffect(() => {
    if (!reachable) return;
    void refresh();
    const timer = setInterval(() => void refresh(), TICK_MS);
    return () => clearInterval(timer);
  }, [reachable, refresh]);

  const verify = useCallback(
    async (credential: Credential, direction: 'in' | 'out'): Promise<VerifyResult> => {
      if (!gateId) throw new Error('No gate selected');
      if (reachable && !session.getState().offline) {
        try {
          const result = await unwrap(
            api.POST('/v1/estates/{estateId}/gate/verify', {
              params: { path: { estateId } },
              body: { gateId, direction, ...credential },
            }),
          );
          setApiDown(false);
          return { ...result, offline: false };
        } catch (error) {
          if (!isNetwork(error)) throw error;
          setApiDown(true);
        }
      }
      if (!cache) throw new Error('No offline cache');
      return verifyOffline(cache, credential, direction);
    },
    [cache, estateId, gateId, reachable],
  );

  /** Records an entry or exit: straight to the API when possible, otherwise into the sync queue. */
  const record = useCallback(
    async (input: NewGateEvent): Promise<{ queued: boolean }> => {
      if (!gateId) throw new Error('No gate selected');
      const state = session.getState();
      const event: QueuedEvent = {
        ...input,
        clientUuid: newIdempotencyKey(),
        gateId,
        occurredAt: new Date().toISOString(),
        ...(state.offline && state.user ? { offlineGuardUserId: state.user.id } : {}),
      };
      if (reachable && !state.offline) {
        try {
          await unwrap(
            api.POST('/v1/estates/{estateId}/gate/events', {
              params: { path: { estateId } },
              body: event,
            }),
          );
          setApiDown(false);
          return { queued: false };
        } catch (error) {
          if (!isNetwork(error)) throw error;
          setApiDown(true);
        }
      }
      offlineStore.enqueue(estateId, event);
      bump();
      return { queued: true };
    },
    [bump, estateId, gateId, reachable],
  );

  return {
    online,
    pendingCount,
    lastSyncAt,
    rejected,
    clearRejected: () => setRejected(0),
    cache,
    expected: cache?.expected ?? null,
    revokedPassIds: cache?.revokedPassIds ?? new Set<string>(),
    verify,
    record,
    refresh: () => refresh(true),
  };
}

export type GateSync = ReturnType<typeof useGateSync>;
