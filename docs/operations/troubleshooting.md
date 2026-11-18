# Troubleshooting

- **`Cannot find module '@safezone/…'` or missing types in an app**: packages are consumed from `dist/`. Run `pnpm build` (or `pnpm build --filter <pkg>`) after changing a package.
- **Backend exits with "Invalid environment configuration"**: check `apps/backend-api/.env` against the root `.env.example` and `src/config/env.ts`.
- **Port already in use**: defaults are 3000 (public-web), 3001 (management-web), 3002 (super-admin), 4000 (API), 4001 (realtime), 5432 (Postgres), 6379 (Redis), 1025/8025 (Mailpit), 9000 (RustFS storage).
- **Expo app cannot reach the API on a device**: set `EXPO_PUBLIC_API_URL` to your machine's LAN IP.
- **Metro cannot resolve a hoisted package**: keep `node-linker=hoisted` in `.npmrc`, then `pnpm install` and `npx expo start -c`.
- **Every API request takes seconds, or "Unable to start a transaction in the given time"**: on some Macs `localhost` resolves to IPv6 first and each new database connection waits about 1.5 s. Use `127.0.0.1` in `DATABASE_URL`, `DATABASE_REPLICA_URL`, `DATABASE_MIGRATION_URL` and `REDIS_URL`.
- **Homebrew Postgres will not start after a crash or restart** (`lock file "postmaster.pid" already exists` in its log, and the PID in that file belongs to another program): no Postgres is running, so move the stale `postmaster.pid` out of the data directory and let `brew services` start it again.
- **"Too many attempts. Wait a few minutes and try again." when signing in locally**: each phone may request 5 codes an hour (10 per IP). Clear the local counters with `pnpm dev:otp:reset`.
- **No sign-in code arrives**: with `MAIL_TRANSPORT=file`, run `pnpm dev:otp <phone>` (or look in `apps/backend-api/.dev-outbox/`); with Docker, open Mailpit at http://localhost:8025.
