# Testing

| Where                  | Tool                                          | Command                              |
| ---------------------- | --------------------------------------------- | ------------------------------------ |
| Packages, backend      | Vitest                                        | `pnpm test` (or `--filter <pkg>`)    |
| Backend integration    | Vitest + Testcontainers (real Postgres/Redis) | Phase 0 task 2                       |
| Tenant isolation suite | Vitest, `apps/backend-api/test/isolation`     | Phase 0 task 14                      |
| Web apps               | Playwright                                    | To add with the first web feature    |
| Mobile apps            | Maestro                                       | To add with the first mobile feature |

Minimum tests per change type are in [AGENTS.md §8](../../AGENTS.md).
