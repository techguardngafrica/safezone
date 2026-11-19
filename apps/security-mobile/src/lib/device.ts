import { createSafezoneClient } from '@safezone/api-client';
import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';
import type { SecretStore } from '../offline/pin-verifier';
import { config } from './config';

/**
 * This phone's registration as a shared gate device (ADR-0017). The credential is a secret: it lives
 * only in the OS keystore and goes to the API only in request bodies.
 */
export interface GateDeviceInfo {
  credential: string;
  deviceId: string;
  deviceName: string;
  estateId: string;
  estateName: string;
  gateId: string;
  gateName: string;
}

const DEVICE_KEY = 'safezone.security.device';
const KEYCHAIN = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY } as const;

/** SecureStore-backed secrets for the offline PIN verifiers. */
export const secretStore: SecretStore = {
  get: (key) => SecureStore.getItemAsync(key, KEYCHAIN),
  set: (key, value) => SecureStore.setItemAsync(key, value, KEYCHAIN),
  remove: (key) => SecureStore.deleteItemAsync(key, KEYCHAIN),
};

type State = { loaded: boolean; device: GateDeviceInfo | null };
let state: State = { loaded: false, device: null };
const listeners = new Set<() => void>();

function emit(next: State) {
  state = next;
  for (const listener of listeners) listener();
}

export const gateDevice = {
  async load(): Promise<void> {
    if (state.loaded) return;
    try {
      const raw = await SecureStore.getItemAsync(DEVICE_KEY, KEYCHAIN);
      emit({ loaded: true, device: raw ? (JSON.parse(raw) as GateDeviceInfo) : null });
    } catch {
      emit({ loaded: true, device: null });
    }
  },
  async save(device: GateDeviceInfo): Promise<void> {
    await SecureStore.setItemAsync(DEVICE_KEY, JSON.stringify(device), KEYCHAIN);
    emit({ loaded: true, device });
  },
  /** After deregistration: forget the credential and every offline PIN verifier. */
  async forget(knownGuardIds: readonly string[] = []): Promise<void> {
    await SecureStore.deleteItemAsync(DEVICE_KEY, KEYCHAIN);
    for (const userId of knownGuardIds)
      await secretStore.remove(`safezone.security.pinv.${userId}`).catch(() => undefined);
    emit({ loaded: true, device: null });
  },
  current: () => state.device,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getState: () => state,
};

export function useGateDevice(): State {
  return useSyncExternalStore(gateDevice.subscribe, gateDevice.getState);
}

/** Client for device-authenticated calls: never sends a guard's token. */
export const deviceApi = createSafezoneClient({
  baseUrl: config.apiBaseUrl,
  app: 'security-mobile',
  appVersion: config.appVersion,
});
