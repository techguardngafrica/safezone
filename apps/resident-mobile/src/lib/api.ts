import { createSafezoneClient } from '@safezone/api-client';
import { config } from './config';

/** Single API client for the Resident App. Phase 0 wires getAccessToken to expo-secure-store via @safezone/auth. */
export const api = createSafezoneClient({
  baseUrl: config.apiBaseUrl,
  app: 'resident-mobile',
  appVersion: config.appVersion,
  getAccessToken: () => null,
});
