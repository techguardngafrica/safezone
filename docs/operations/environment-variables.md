# Environment Variables

## Security Rules

- Never commit `.env` or `.env.local` files.
- Never prefix server-only secrets (`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`) with `NEXT_PUBLIC_` or `EXPO_PUBLIC_`.

## Server-Only (`apps/backend-api/.env`)

- `NODE_ENV` (`development | test | staging | production`)
- `PORT` (default `4000`), `WORKER_PORT` (`4001`), `REALTIME_PORT` (`4002`)
- `DATABASE_URL` (required)
- `REDIS_URL` (required)
- `JWT_SECRET` (required, minimum 16 characters)
- `CORS_ORIGINS` (comma-separated allowed origins)

## Public Web (`NEXT_PUBLIC_*`)

- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_APP_NAME` / `NEXT_PUBLIC_SITE_URL`

## Public Mobile (`EXPO_PUBLIC_*`)

- `EXPO_PUBLIC_API_URL`
- `EXPO_PUBLIC_APP_SURFACE`

