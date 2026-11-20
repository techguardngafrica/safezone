import { defineConfig, devices } from '@playwright/test';
import { E2E } from './e2e/support/config';

/**
 * End-to-end flows for the Estate Management web app (management-web.md §10). The global setup starts
 * the real API, worker, realtime gateway and a production build of this app against a throwaway
 * database on the host (no Docker). See docs/operations/e2e-tests.md.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './e2e/support/global-setup.ts',
  // One stack, one worker: flows share the API and the worker queues, and the host is slow.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  outputDir: './e2e/.run/test-results',
  reporter: [['list'], ['html', { open: 'never', outputFolder: './e2e/.run/report' }]],
  use: {
    baseURL: E2E.webUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    acceptDownloads: true,
    timezoneId: 'Africa/Lagos',
    locale: 'en-NG',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
