# Troubleshooting

- **`Cannot find module '@safezone/…'` or missing types in an app**: packages are consumed from `dist/`. Run `pnpm build` (or `pnpm build --filter <pkg>`) after changing a package.
- **Backend exits with "Invalid environment configuration"**: check `apps/backend-api/.env` against the root `.env.example` and `src/config/env.ts`.
- **Port already in use**: defaults are 3000 (public-web), 3001 (management-web), 3002 (super-admin), 4000 (API), 4001 (realtime), 5432 (Postgres), 6379 (Redis), 1025/8025 (Mailpit), 9000/9001 (MinIO).
- **Expo app cannot reach the API on a device**: set `EXPO_PUBLIC_API_URL` to your machine's LAN IP.
- **Metro cannot resolve a hoisted package**: keep `node-linker=hoisted` in `.npmrc`, then `pnpm install` and `npx expo start -c`.
