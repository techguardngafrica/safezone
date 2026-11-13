# Deployment

To be written in Phase 0, after the hosting-region ADR (latency from Lagos vs NDPA transfer rules).

Planned layout:

```text
deployment/
├── terraform/
│   ├── modules/          # network, postgres, redis, object storage, cdn, container services, secrets
│   └── envs/
│       ├── dev/
│       ├── staging/
│       └── production/   # separate cloud accounts per environment
└── scripts/              # migration job, smoke tests, rollback helpers
```

Runtime services from one `backend-api` image: `api`, `worker` (including the isolated SOS worker pool) and `realtime`, each scaled on its own signal (backend-api.md §1). Web apps deploy as Next.js containers or to a managed Next.js host. Mobile apps ship through EAS Build and EAS Update.
