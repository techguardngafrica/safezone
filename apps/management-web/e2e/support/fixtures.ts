import { readFileSync } from 'node:fs';
import { test as base, expect, type Page } from '@playwright/test';
import { t } from '@safezone/i18n';
import pg from 'pg';
import { apiSignIn, type ApiSession, captureOtp, type DeviceKind } from './api';
import { E2E, type StackState } from './config';
import { clearRateLimits } from './redis';
import { type EstateStatus, Seeder, type SeededUser, totpCode } from './seed';

export { expect, t };

interface Stack {
  state: StackState;
  seed: Seeder;
}

export interface EstateWorld {
  estateId: string;
  /** Estate Administrator with a seeded authenticator. */
  admin: SeededUser;
  /** Another staff member of this estate with a built-in role and a seeded authenticator. */
  seedStaff(roleKey: string, fullName: string): Promise<SeededUser>;
  /** A resident (no MFA) with an active membership and a built-in resident role. */
  seedResident(fullName: string, roleKey?: string): Promise<SeededUser>;
  /** Goes to a path under /<estateId>/ (e.g. `estate/import`), signed in as the administrator. */
  open(path: string): Promise<void>;
}

interface Fixtures {
  seed: Seeder;
  /** Signs a seeded user in through the API (OTP from the file outbox, TOTP from the seeded secret). */
  apiAs(user: SeededUser, device?: DeviceKind): Promise<ApiSession>;
  /** Signs a seeded user in through the real sign-in screen on the current page. */
  signIn(page: Page, user: SeededUser): Promise<void>;
  /** A fresh estate (active unless the test overrides `estateStatus`) with its administrator. */
  estate: EstateWorld;
  estateStatus: EstateStatus;
}

async function signInThroughUi(page: Page, redisUrl: string, user: SeededUser): Promise<void> {
  await clearRateLimits(redisUrl);
  await page.getByLabel(t('auth.phone.label'), { exact: true }).fill(user.national);
  const code = await captureOtp(user.phone, () =>
    page.getByRole('button', { name: t('auth.sendCode') }).click(),
  );
  await page.getByLabel(t('auth.otp.label'), { exact: true }).fill(code);
  await page.getByRole('button', { name: t('auth.verify') }).click();
  await expect(page.getByRole('heading', { name: t('auth.mfa.title') })).toBeVisible();
  if (!user.totpSecret) throw new Error(`${user.fullName} has no seeded authenticator`);
  await page.getByLabel(t('auth.otp.label'), { exact: true }).fill(await totpCode(user.totpSecret));
  await page.getByRole('button', { name: t('auth.mfa.verify') }).click();
  await expect(page.getByRole('heading', { name: t('auth.mfa.title') })).toBeHidden();
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
    use((page, user) => signInThroughUi(page, stack.state.redisUrl, user)),

  estateStatus: ['active', { option: true }],

  estate: async ({ stack, page, estateStatus }, use, testInfo) => {
    const estateId = await stack.seed.estate(`E2E ${testInfo.title}`.slice(0, 80), estateStatus);
    const admin = await stack.seed.staff(estateId, 'estate_administrator', 'Ada Administrator');
    let signedIn = false;
    await use({
      estateId,
      admin,
      seedStaff: (roleKey, fullName) => stack.seed.staff(estateId, roleKey, fullName),
      async seedResident(fullName, roleKey = 'tenant') {
        const user = await stack.seed.user(fullName);
        await stack.seed.member(estateId, user.id, roleKey);
        return user;
      },
      async open(path: string) {
        await page.goto(`/${estateId}/${path}`);
        if (!signedIn) {
          // The estate shell shows the sign-in flow in place until the session is fully signed in.
          await signInThroughUi(page, stack.state.redisUrl, admin);
          signedIn = true;
        }
      },
    });
  },
});
