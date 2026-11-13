import Constants from 'expo-constants';

interface Extra {
  apiBaseUrl?: string;
  realtimeUrl?: string;
}

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

/** EXPO_PUBLIC_* values (see .env.example) win over app.json `extra`, which holds local defaults. */
export const config = {
  apiBaseUrl: process.env.EXPO_PUBLIC_API_URL ?? extra.apiBaseUrl ?? 'http://localhost:4000',
  realtimeUrl: process.env.EXPO_PUBLIC_REALTIME_URL ?? extra.realtimeUrl ?? 'ws://localhost:4001',
  appVersion: Constants.expoConfig?.version ?? '0.0.0',
} as const;
