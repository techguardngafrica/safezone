import path from 'node:path';

/**
 * Ports and paths for the public-web e2e stack. They differ from `pnpm dev` (3000/4000) and from the
 * management-web harness (3101/4100), so all can run on one machine.
 */
const apiPort = Number(process.env.E2E_PUBLIC_API_PORT ?? 4200);
const realtimePort = Number(process.env.E2E_PUBLIC_REALTIME_PORT ?? 4201);
const webPort = Number(process.env.E2E_PUBLIC_WEB_PORT ?? 3200);

const webRoot = path.resolve(__dirname, '../..');
const runDir = path.join(webRoot, 'e2e', '.run');

export const E2E = {
  apiPort,
  realtimePort,
  webPort,
  // `localhost` for both, so the API's refresh cookie is same-site for the web app.
  apiUrl: `http://localhost:${apiPort}`,
  realtimeUrl: `http://localhost:${realtimePort}`,
  webUrl: `http://localhost:${webPort}`,
  webRoot,
  backendRoot: path.resolve(webRoot, '../backend-api'),
  repoRoot: path.resolve(webRoot, '../..'),
  runDir,
  logDir: path.join(runDir, 'logs'),
  outboxDir: path.join(runDir, 'outbox'),
  storageDir: path.join(runDir, 'storage'),
  stateFile: path.join(runDir, 'state.json'),
  /** Next.js output for the e2e build, apart from `.next` so it never clobbers a dev or prod build. */
  nextDistDir: '.next-e2e',
  /** Throwaway databases are named like this; nothing else is ever created or dropped. */
  databasePattern: /^safezone_e2e_pw_[0-9a-f]{16}$/,
  /** Fixed, test-only key material (never used outside this harness). */
  secrets: {
    JWT_ACCESS_SECRET: 'e2e-only-access-secret-0000000000000000000000',
    JWT_REFRESH_SECRET: 'e2e-only-refresh-secret-000000000000000000000',
    OTP_HMAC_SECRET: 'e2e-only-otp-secret-00000000000000000000000000',
    MFA_ENCRYPTION_KEY: Buffer.alloc(32, 21).toString('base64'),
    PASS_KEY_ENCRYPTION_KEY: Buffer.alloc(32, 22).toString('base64'),
  },
} as const;

/** Written by the global setup, read by fixtures in the test worker. */
export interface StackState {
  ownerUrl: string;
  redisUrl: string;
  databaseName: string;
}
