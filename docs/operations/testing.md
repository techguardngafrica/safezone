# Testing

| Where                  | Tool                                          | Command                                                                                |
| ---------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------- |
| Packages, backend      | Vitest                                        | `pnpm test` (or `--filter <pkg>`)                                                      |
| Backend integration    | Vitest + Testcontainers (real Postgres/Redis) | `pnpm test:integration` (needs Docker)                                                 |
| Tenant isolation suite | Vitest, `apps/backend-api/test/isolation`     | `pnpm --filter @safezone/backend-api test:isolation` (also part of `test:integration`) |
| Web apps               | Playwright                                    | To add with the first web feature                                                      |
| Mobile apps            | Maestro                                       | To add with the first mobile feature                                                   |

Minimum tests per change type are in [AGENTS.md §8](../../AGENTS.md).

## Backend integration harness

- `test/integration/support/database.ts`: Postgres 17, real migrations as the owner, a client as `safezone_app`.
- `test/integration/support/app.ts`: the full API (Postgres + Redis) with fake SMS and email, in-memory storage by default; `signIn()` runs the real OTP flow.
- File tests use an S3-compatible container that verifies signatures (`rustfs/rustfs`), because MinIO community images are no longer published.
- The isolation suite discovers routes from the running app: every route must declare access and a contract, every non-public route must return 401 anonymously, and every estate route must refuse another estate's administrator.
