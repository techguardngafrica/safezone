import { createAuthApi, createSafezoneClient } from '@safezone/api-client';
import { SessionController, type SessionStorage, type StoredSession } from '@safezone/auth';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { config } from './config';

const KEY = 'safezone.session';

/** Tokens live only in the OS keychain/keystore (AGENTS.md §6.1), never in AsyncStorage or logs. */
const secureStorage: SessionStorage = {
  async get() {
    const value = await SecureStore.getItemAsync(KEY);
    if (!value) return null;
    try {
      return JSON.parse(value) as StoredSession;
    } catch {
      return null;
    }
  },
  async set(session) {
    await SecureStore.setItemAsync(KEY, JSON.stringify(session), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },
  async clear() {
    await SecureStore.deleteItemAsync(KEY);
  },
};

const device = {
  app: 'management-mobile' as const,
  platform: Platform.OS === 'ios' ? ('ios' as const) : ('android' as const),
  appVersion: config.appVersion,
};

/**
 * Estate Management mobile session: phone + OTP, then TOTP MFA for staff; tokens in SecureStore.
 */
export const session = new SessionController(
  createAuthApi(
    createSafezoneClient({
      baseUrl: config.apiBaseUrl,
      app: device.app,
      appVersion: config.appVersion,
    }),
    device,
  ),
  secureStorage,
  true,
);

/** API client for signed-in calls: attaches the access token and ends the session on 401. */
export const api = createSafezoneClient({
  baseUrl: config.apiBaseUrl,
  app: device.app,
  appVersion: config.appVersion,
  getAccessToken: session.getAccessToken,
  onUnauthorized: session.handleUnauthorized,
});
