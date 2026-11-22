import { readFileSync } from 'node:fs';
import { test as base, expect, type Page } from '@playwright/test';
import { t } from '@safezone/i18n';
import pg from 'pg';
import { apiSignIn, type ApiSession, captureOtp, type DeviceKind } from './api';
import { E2E, type StackState } from './config';
import { clearRateLimits } from './redis';
import { builtInRoleId, Seeder, type SeededUser, uuidv7 } from './seed';

export { expect, t };

interface Stack {
  state: StackState;
  seed: Seeder;
}

interface Fixtures {
  seed: Seeder;
  /** Signs a seeded user in through the API (OTP from the file outbox, TOTP when seeded). */
  apiAs(user: SeededUser, device?: DeviceKind): Promise<ApiSession>;
  /** Signs a user without MFA in through the real sign-in screen on the current page. */
  signIn(page: Page, user: SeededUser): Promise<void>;
  /** A Techguard platform administrator (vendor.approve) with MFA, signed in through the API. */
  techguard(): Promise<ApiSession>;
}

export const test = base.extend<Fixtures, { stack: Stack }>({
  stack: [
    // eslint-disable-next-line no-empty-pattern -- Playwright fixtures must destructure their dependencies.
    async ({}, use) => {
      const state = JSON.parse(readFileSync(E2E.stateFile, 'utf8')) as StackState;
      const owner = new pg.Pool({ connectionString: state.ownerUrl, max: 2 });
      await use({ state, seed: new Seeder(owner) });
      await owner.end();
    },
    { scope: 'worker' },
  ],

  seed: async ({ stack }, use) => use(stack.seed),

  apiAs: async ({ stack }, use) =>
    use((user, device) => apiSignIn(stack.state.redisUrl, user, device)),

  signIn: async ({ stack }, use) =>
    use(async (page, user) => {
      await clearRateLimits(stack.state.redisUrl);
      await page.getByLabel(t('auth.phone.label'), { exact: true }).fill(user.national);
      const code = await captureOtp(user.phone, () =>
        page.getByRole('button', { name: t('auth.sendCode') }).click(),
      );
      await page.getByLabel(t('auth.otp.label'), { exact: true }).fill(code);
      await page.getByRole('button', { name: t('auth.verify') }).click();
    }),

  techguard: async ({ stack }, use) =>
    use(async () => {
      const user = await stack.seed.user('Tobi Techguard', { mfa: true });
      await stack.seed.query(
        `insert into platform.role_assignments (id, user_id, role_id, estate_id, reason)
         values ($1, $2, $3, null, 'e2e seed')`,
        [uuidv7(), user.id, builtInRoleId('platform_administrator')],
      );
      return apiSignIn(stack.state.redisUrl, user, 'web');
    }),
});
