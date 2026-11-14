# Architecture decision records

Copy [0000-template.md](0000-template.md) to `NNNN-short-title.md`. One decision per file. Never edit an accepted ADR's decision; supersede it with a new one.

| ADR                                 | Title                                                                                   | Status                               |
| ----------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------ |
| [0001](0001-orm-and-data-access.md) | ORM and data access: Prisma + adapter-pg, `withTenant` with transaction-scoped settings | Accepted                             |
| 0002                                | Hosting region and data residency (latency from Lagos vs NDPA transfer rules)           | To write                             |
| 0003                                | SMS provider (sender ID, DND route, delivery rates)                                     | To write                             |
| 0004                                | Monorepo package build strategy (compiled CommonJS packages consumed from `dist/`)      | To write — records the current setup |
