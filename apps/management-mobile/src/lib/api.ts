import { createSafezoneClient } from '@safezone/api-client';
import { config } from './config';

/** Single API client for the Estate Management mobile app. Staff sign-in requires MFA (identity.md). */
export const api = createSafezoneClient({
  baseUrl: config.apiBaseUrl,
  app: 'management-mobile',
  appVersion: config.appVersion,
  getAccessToken: () => null,
});
