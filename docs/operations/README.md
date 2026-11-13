# Operations

## Environments

| Env        | Purpose                                          | Data                                             |
| ---------- | ------------------------------------------------ | ------------------------------------------------ |
| local/dev  | `pnpm infra:up` + `pnpm dev`; Shared integration | Fake providers, seed data; Sandbox provider keys |
| staging    | Release candidate, pilot rehearsal               | Sandbox keys, anonymised data                    |
| production | Live estates                                     | Real                                             |

## Runbooks to write before pilot go-live

- **SOS path degraded** — synthetic SOS failing, `sos` queue latency > 2 s, provider failure. (Highest priority.)
- SMS / WhatsApp / push provider outage and failover.
- Payment webhooks delayed or failing; reconciliation backlog.
- Queue backlog / dead-letter queue not empty.
- Database failover and point-in-time restore.
- Gate devices offline at an estate.
- Personal data breach (72-hour NDPC notification path).
- Support access ("view as") procedure.

## Service levels

API p95 < 500 ms · availability 99.9% · SOS trigger → first guard notified < 5 s · RPO < 15 min · RTO < 4 h.
