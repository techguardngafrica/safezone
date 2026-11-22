# End-to-end tests (management-web)

Playwright flows for the Estate Management web app, one per main path in
[management-web.md §10](../architecture/apps/management-web.md#10-testing). They drive a production build of
`apps/management-web` against the real API, worker and realtime processes and a throwaway database. No
Docker: PostgreSQL and Redis run on the host, as in [local development](local-development.md).

```bash
pnpm --filter @safezone/management-web e2e
```

The first run on a machine also needs the browser once:

```bash
pnpm --filter @safezone/management-web exec playwright install chromium
```

## What a run does

The global setup in `apps/management-web/e2e/support/global-setup.ts`:

1. Builds the backend (`pnpm --filter @safezone/backend-api build`) and a production build of
   management-web into `.next-e2e` (never `.next`), pointed at the e2e ports. About a minute.
2. Creates `safezone_e2e_<16 hex>` on the host server, applies the real migrations as the owner and seeds the
   built-in roles with the backend's own `dist/scripts/seed.js`. Databases left by a crashed run with that
   name pattern are dropped first; no other database is opened, so the local `safezone` database is safe.
3. Flushes Redis database index 14 (never index 0, which `pnpm dev` uses).
4. Starts the API (4100), worker, realtime gateway (4101) and `next start` (3101). The backend processes run
   from `e2e/.run/`, so `apps/backend-api/.env` is not loaded: every setting comes from the harness, with
   `MAIL_TRANSPORT=file`, `STORAGE_DRIVER=local`, fake SMS and payments, and fixed test-only secrets.
5. After the flows, stops every process and drops the database.

Ports differ from `pnpm dev` (3001/4000/4001), so both can run at once. If a port is busy the run stops with
a clear message.

## Flows

| Spec                       | Main path                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| `bulk-import.spec.ts`      | Download template, dry run with an error row, confirm, worker result counts, history        |
| `setup-wizard.spec.ts`     | Mark the verified steps done (unit, gate, supervisor, SOS policy), go live                  |
| `approve-resident.spec.ts` | A tenant's join request from the Resident App is approved from the queue                    |
| `live-gate.spec.ts`        | A guard's check-in of an invited visitor appears live in activity and inside                |
| `sos-console.spec.ts`      | A resident's SOS arrives live, is acknowledged, then resolved with a note                   |
| `billing-payment.spec.ts`  | Maker-checker: accountant prepares, administrator approves the run; office payment approved |
| `work-order.spec.ts`       | Create a work order, add material, the job is completed, management verifies                |
| `moderation.spec.ts`       | A reported message is removed from the moderation queue                                     |

Each test gets its own estate and Estate Administrator, so flows do not depend on each other or on order.
Data the flow is not about (units, residents, passes, charges) is created through the real API with
`apiAs()`; only rows with no API (the estate, staff accounts) are inserted directly
(`e2e/support/seed.ts`).

## Sign-in

Staff sign in through the real screens: phone number, the OTP code that the fake SMS sender writes to the
file outbox (`e2e/.run/outbox/`), then a TOTP code generated from a secret the harness seeded for that user
(encrypted with the run's `MFA_ENCRYPTION_KEY`, exactly as enrolment stores it). The API accepts each
30-second step once per user, so every test signs in fresh users and the TOTP helper moves to the next
step when one was already used. Rate-limit counters (`rl:*` in Redis index 14) are cleared before each
sign-in because every request comes from 127.0.0.1.

## Options

| Variable                                            | Default                                                         | Use                                            |
| --------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------- |
| `E2E_SKIP_BUILD=1`                                  | off                                                             | Reuse the last backend and `.next-e2e` builds  |
| `E2E_PG_ADMIN_URL`                                  | `DATABASE_MIGRATION_URL` from the backend `.env`, db `postgres` | Superuser that may create and drop databases   |
| `E2E_PG_APP_PASSWORD`                               | password in the backend `.env` `DATABASE_URL`                   | `safezone_app` password (empty for trust auth) |
| `E2E_REDIS_URL`                                     | backend `REDIS_URL` with index `/14`                            | Any index except 0                             |
| `E2E_API_PORT`, `E2E_REALTIME_PORT`, `E2E_WEB_PORT` | 4100, 4101, 3101                                                | Change if a port is taken                      |

Run one flow with `pnpm --filter @safezone/management-web e2e bulk-import`, or the Playwright UI with
`pnpm --filter @safezone/management-web e2e:ui`. The `safezone_app` role must already exist on the server
(it does after `pnpm db:app-role` for local development).

## When a flow fails

- `apps/management-web/e2e/.run/logs/` has the output of every build and process (`api.log`, `worker.log`,
  `realtime.log`, `web.log`, `migrate.log`).
- `e2e/.run/test-results/<test>/` has a screenshot, the page snapshot and a trace:
  `pnpm --filter @safezone/management-web exec playwright show-trace <path>/trace.zip`.
- `e2e/.run/report/` is the HTML report.

Selectors use roles and the English strings from `@safezone/i18n` (`t('import.runDryRun')`), so copy
changes in the catalogue do not break the flows, while renamed or removed controls do.

## Public Web (Vendor Portal)

`apps/public-web` has the same harness, adapted (`apps/public-web/e2e/`):

```bash
pnpm --filter @safezone/public-web e2e
```

- Ports 4200 (API) and 3200 (web) by default (`E2E_PUBLIC_API_PORT`, `E2E_PUBLIC_WEB_PORT`), so it can run beside `pnpm dev` and the management-web harness.
- Throwaway databases are named `safezone_e2e_pw_<random>`; the sweep touches only those names.
- No realtime process: the portal does not use it.
- Flows: `vendor-apply` (sign in, application with client-side checks, overview) and `vendor-order` (accept, fake-provider payment, start, message, complete, earnings).
