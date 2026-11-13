# Domain modules

One folder per domain module. Each owns its tables and exposes behaviour only through its service and events (AGENTS.md §5.1). Build them in phase order; the spec for each is in `docs/architecture/modules/<module>.md`.

```text
modules/<module>/
├── <module>.module.ts
├── <module>.controller.ts   # REST endpoints, each with @Can('<permission>') or @Public()
├── <module>.service.ts      # public interface used by other modules
├── domain/                  # entities, value objects, state machines, rules (pure)
├── repositories/            # this module's tables only
├── jobs/                    # BullMQ processors
├── events/                  # emitted event types + handlers for consumed events
├── dto/                     # request/response schemas re-exported from @safezone/schemas
└── *.test.ts
```

| Order | Module                    | Phase | Spec                                                                       |
| ----- | ------------------------- | ----- | -------------------------------------------------------------------------- |
| 1     | identity                  | 0     | [identity.md](../../../../docs/architecture/modules/identity.md)           |
| 2     | authz                     | 0     | [authz.md](../../../../docs/architecture/modules/authz.md)                 |
| 3     | tenancy                   | 0–1   | [tenancy.md](../../../../docs/architecture/modules/tenancy.md)             |
| 4     | audit                     | 0     | [audit.md](../../../../docs/architecture/modules/audit.md)                 |
| 5     | notifications             | 0–1   | [notifications.md](../../../../docs/architecture/modules/notifications.md) |
| 6     | documents (file service)  | 0     | [documents.md](../../../../docs/architecture/modules/documents.md)         |
| 7     | platform                  | 0–1   | [platform.md](../../../../docs/architecture/modules/platform.md)           |
| 8     | property                  | 1     | [property.md](../../../../docs/architecture/modules/property.md)           |
| 9     | occupancy                 | 1     | [occupancy.md](../../../../docs/architecture/modules/occupancy.md)         |
| 10    | visitor                   | 1     | [visitor.md](../../../../docs/architecture/modules/visitor.md)             |
| 11    | security                  | 1     | [security.md](../../../../docs/architecture/modules/security.md)           |
| 12    | emergency                 | 1     | [emergency.md](../../../../docs/architecture/modules/emergency.md)         |
| 13    | community (announcements) | 1     | [community.md](../../../../docs/architecture/modules/community.md)         |
| 14    | analytics                 | 1+    | [analytics.md](../../../../docs/architecture/modules/analytics.md)         |
| 15    | billing                   | 2     | [billing.md](../../../../docs/architecture/modules/billing.md)             |
| 16    | payments                  | 2     | [payments.md](../../../../docs/architecture/modules/payments.md)           |
| 17    | utilities                 | 2     | [utilities.md](../../../../docs/architecture/modules/utilities.md)         |
| 18    | maintenance               | 2     | [maintenance.md](../../../../docs/architecture/modules/maintenance.md)     |
| 19    | facilities                | 3     | [facilities.md](../../../../docs/architecture/modules/facilities.md)       |
| 20    | governance                | 3, 5  | [governance.md](../../../../docs/architecture/modules/governance.md)       |
| 21    | marketplace               | 4     | [marketplace.md](../../../../docs/architecture/modules/marketplace.md)     |
| 22    | advertising               | 4     | [advertising.md](../../../../docs/architecture/modules/advertising.md)     |
| 23    | procurement               | 5     | [procurement.md](../../../../docs/architecture/modules/procurement.md)     |
| 24    | workforce                 | 1, 5  | [workforce.md](../../../../docs/architecture/modules/workforce.md)         |
| 25    | devices                   | 6     | [devices.md](../../../../docs/architecture/modules/devices.md)             |
