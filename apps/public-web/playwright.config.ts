import { defineConfig, devices } from '@playwright/test';
import { E2E } from './e2e/support/config';

/**
 * End-to-end flows for Public Web (public-web.md §12): the Vendor Portal. The global setup starts the
 * real API, worker and a production build of this app against a throwaway database on the host (no
 * Docker), like the management-web harness. See docs/operations/e2e-tests.md.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './e2e/support/global-setup.ts',
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
    timezoneId: 'Africa/Lagos',
    locale: 'en-NG',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
