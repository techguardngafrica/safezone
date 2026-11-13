import Constants from 'expo-constants';

interface Extra {
  apiBaseUrl?: string;
  realtimeUrl?: string;
}

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

export const config = {
  apiBaseUrl: extra.apiBaseUrl ?? 'http://localhost:4000',
  realtimeUrl: extra.realtimeUrl ?? 'ws://localhost:4001',
  appVersion: Constants.expoConfig?.version ?? '0.0.0',
} as const;
