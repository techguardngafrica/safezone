# Builds one image for all three backend processes.
# Select the process at runtime: APP_PROCESS=api|worker|realtime (command below maps it to dist/<entry>.js).
# Build from the repo root:
#   docker build -f infrastructure/docker/backend-api.Dockerfile -t safezone/backend-api .

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@2 prune @safezone/backend-api --docker

FROM base AS builder
COPY --from=pruner /repo/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ .
RUN pnpm turbo run build --filter=@safezone/backend-api...
RUN pnpm --filter=@safezone/backend-api deploy --prod --legacy /app

FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S safezone && adduser -S safezone -G safezone
COPY --from=builder --chown=safezone:safezone /app .
USER safezone
EXPOSE 4000 4001
CMD ["sh", "-c", "case \"$APP_PROCESS\" in worker) exec node dist/worker.js ;; realtime) exec node dist/realtime.js ;; *) exec node dist/main.js ;; esac"]
