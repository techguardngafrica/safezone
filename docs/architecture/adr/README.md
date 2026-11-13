# Architecture decision records

Copy [0000-template.md](0000-template.md) to `NNNN-short-title.md`. One decision per file. Never edit an accepted ADR's decision; supersede it with a new one.

| ADR  | Title                                                                                      | Status                               |
| ---- | ------------------------------------------------------------------------------------------ | ------------------------------------ |
| 0001 | ORM and data access (Drizzle vs Prisma) — must support RLS and `SET LOCAL` per transaction | To write (Phase 0, task 1)           |
| 0002 | Hosting region and data residency (latency from Lagos vs NDPA transfer rules)              | To write                             |
| 0003 | SMS provider (sender ID, DND route, delivery rates)                                        | To write                             |
| 0004 | Monorepo package build strategy (compiled CommonJS packages consumed from `dist/`)         | To write — records the current setup |
