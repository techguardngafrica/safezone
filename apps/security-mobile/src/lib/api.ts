import { createSafezoneClient } from '@safezone/api-client';
import { config } from './config';

/**
 * API client for the Security App. Auth is a registered device credential + guard PIN shift session
 * (identity.md §5.3), not a personal phone sign-in.
 */
export const api = createSafezoneClient({
  baseUrl: config.apiBaseUrl,
  app: 'security-mobile',
  appVersion: config.appVersion,
  getAccessToken: () => null,
});
