# Module: Audit and Accountability

> Safezone by Techguard · Module documentation · v0.1 (13 Nov 2026)
> Phase: 0 · Owner: Backend · Apps: management-web (estate audit log), super-admin (platform audit log)

## 1. Responsibility

Audit records **who did what, to which resource, when, from where and in which role**, in an append-only store, for every important action across the platform. It powers estate and platform audit logs, compliance evidence, support-access transparency and investigations.

## 2. What is audited (minimum)

User creation; role assignments and revocations; permission and custom role changes; property ownership changes; resident approvals and rejections; visitor access decisions and guard overrides; SOS activation, acknowledgement, escalation and resolution; financial transactions, refunds, waivers, invoice adjustments, billing runs; maintenance assignments; document access and downloads; community moderation actions; advertisement approvals, campaign activations and suspensions, advertising payments; estate approvals, suspensions, deactivations; support access sessions and every action within them; data exports; platform administrative interventions; settings changes; authentication security events (MFA reset, phone change, lockouts).

## 3. Record shape

| Field                                                | Notes                                                                |
| ---------------------------------------------------- | -------------------------------------------------------------------- |
| `id`                                                 | UUIDv7                                                               |
| `occurred_at`                                        | Server time                                                          |
| `estate_id`                                          | Null for platform-level actions                                      |
| `actor_type`                                         | user, guard_device, system, provider_webhook, platform_staff         |
| `actor_id`                                           | User id / device id                                                  |
| `acting_role`                                        | Role key used for the action                                         |
| `support_session_id`                                 | Set when a platform agent acts inside an estate                      |
| `action`                                             | e.g. `resident.approve`, `invoice.waive`, `ad.campaign.activate`     |
| `resource_type`, `resource_id`                       | Target                                                               |
| `before`, `after`                                    | JSON diff of changed fields (personal data minimised; secrets never) |
| `reason`                                             | Required for sensitive actions                                       |
| `ip`, `user_agent`, `device_id`, `app`, `request_id` | Context                                                              |
| `hash`, `prev_hash`                                  | Hash chain per estate for tamper evidence                            |

## 4. Design

- Written from the **outbox** by the worker, not on the request hot path; actions are audited because the outbox row commits with the state change.
- Table `audit_events` is append-only: application role has `INSERT` and `SELECT` only; no `UPDATE`/`DELETE`.
- Partitioned by month; older partitions moved to cheaper storage after 13 months but remain queryable.
- Hash chain: each record's `hash = sha256(prev_hash + canonical_json(record))`, per estate stream; daily anchor hash stored separately for verification.
- Platform-level stream for cross-tenant actions.

## 5. Capabilities

1. Estate audit log (filter by actor, action, resource, date) for Estate Owner/Administrator.
2. Resource history panels in UIs (e.g. invoice history, resident history).
3. Support-access transparency: estates see every support session and action.
4. Platform audit log for Techguard compliance and security.
5. Export of audit records (itself audited).
6. Integrity verification job (recompute chain, compare anchors).

## 6. Business rules

1. Sensitive actions require a `reason` (waivers, refunds, overrides, suspensions, support access, deletions, exports).
2. Audit records are kept for at least 6 years for financial actions and per retention schedule for others (agreed with DPO).
3. Viewing the audit log is itself audited.
4. Personal data in `before/after` is limited to identifiers and changed fields; documents and messages are referenced, not copied.

## 7. API

| Method | Path                                                                    | Purpose                |
| ------ | ----------------------------------------------------------------------- | ---------------------- |
| GET    | `/v1/estates/:estateId/audit-events?actor=&action=&resource=&from=&to=` | Estate audit log       |
| GET    | `/v1/estates/:estateId/audit-events/resource/:type/:id`                 | Resource history       |
| GET    | `/v1/estates/:estateId/support-sessions`                                | Support access history |
| GET    | `/v1/platform/audit-events`                                             | Platform audit log     |
| POST   | `/v1/platform/audit-events/verify?estateId=&date=`                      | Integrity check        |

## 8. Acceptance criteria

- Every action in section 2 produces exactly one audit record with actor, action, resource and time.
- Attempting an `UPDATE` on `audit_events` with the app role fails.
- A support agent's actions in an estate appear in that estate's audit log, tagged with the support session.
