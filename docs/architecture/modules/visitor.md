# Module: Visitor Management

> Safezone by Techguard · Module documentation · v0.1 (13 Nov 2026)
> Phase: 1 · Owner: Backend · Apps: resident-mobile, security-mobile, public-web (pass page), management-web, management-mobile

## 1. Responsibility

Visitor owns everything about **people and vehicles coming into the estate who do not live there**: invitations, access passes (QR and PIN), validity rules, walk-in requests, gate entry and exit records, deliveries, contractors, domestic staff passes, events, restricted visitors and offline verification.

## 2. Capabilities

1. Visitor invitations by residents (with household permission) and by managers.
2. Pass types: one-time, multi-entry (N entries), recurring (days/hours), event (guest list), domestic staff (long-term), contractor (linked to work order), delivery.
3. Multiple visitors per invitation.
4. Credentials: QR code (signed token) and 6-digit PIN; pass link for the visitor (public-web `/p/:token`).
5. Delivery of passes by SMS/WhatsApp or share sheet.
6. Validity checks: time window, gate, estate, uses remaining, revocation, restricted list.
7. Walk-in visitor requests with resident approval and timeout.
8. Entry and exit records, with optional photo and vehicle.
9. Overstay detection.
10. Expected visitor lists per gate and shift.
11. Offline verification (Ed25519 signatures, cached revocation list) and sync.
12. Restricted visitors (estate-only blacklist).
13. Visitor history and reports.

## 3. Pass token design

- Each estate has an Ed25519 signing key pair (private key in the vault/KMS; public key distributed to gate devices). Keys rotate yearly with overlap.
- QR payload (compact, base64url): `{v:1, p:<passId>, e:<estateId>, g:[gateIds]|*, nb:<notBefore>, na:<notAfter>, n:<maxUses>, k:<keyId>}` + signature. Target QR size ≤ 200 bytes.
- PIN: 6 digits, unique among active passes in the estate; PIN verification needs the expected list (cached offline) or the API.
- The public pass link uses a separate random token, never the signed payload.

## 4. Data model

| Table                 | Key columns                                                                                                                                                                                                                                                                                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `visitor_invitations` | `id`, `estate_id`, `host_user_id`, `host_household_id`, `space_id`, `type`, `purpose`, `notes`, `created_by`, `created_at`                                                                                                                                                                                                                                  |
| `visitor_passes`      | `id`, `estate_id`, `invitation_id`, `visitor_name`, `visitor_phone`, `vehicle_plate`, `pin_hash`, `pin_lookup` (HMAC for uniqueness), `public_token`, `valid_from`, `valid_to`, `recurrence` (jsonb), `gate_ids`, `max_uses`, `uses_count`, `status` (scheduled, active, used, expired, revoked), `revoked_at`, `revoked_by`, `revocation_reason`, `key_id` |
| `gate_events`         | `id`, `estate_id`, `gate_id`, `pass_id` (nullable), `walkin_id` (nullable), `direction` (in, out), `visitor_name`, `vehicle_plate`, `photo_file_id`, `decision` (allow, deny, override), `decision_reason`, `guard_user_id`, `device_id`, `client_uuid` (unique), `occurred_at` (device time), `received_at`                                                | partitioned by month |
| `walkin_requests`     | `id`, `estate_id`, `gate_id`, `space_id`, `visitor_name`, `visitor_phone`, `purpose`, `vehicle_plate`, `photo_file_id`, `status` (pending, approved, rejected, timed_out, cancelled), `responded_by`, `responded_at`, `expires_at`, `guard_user_id`                                                                                                         |
| `restricted_visitors` | `id`, `estate_id`, `name`, `phone`, `plate`, `photo_file_id`, `reason`, `added_by`, `expires_at`                                                                                                                                                                                                                                                            |
| `event_guest_lists`   | `id`, `estate_id`, `pass_id`, `guest_name`, `checked_in_at`                                                                                                                                                                                                                                                                                                 |
| `estate_signing_keys` | `id`, `estate_id`, `public_key`, `kms_key_ref`, `active_from`, `active_to`                                                                                                                                                                                                                                                                                  |

## 5. Pass states

```text
scheduled ──(valid_from reached)──> active ──(uses exhausted)──> used
    │                                  │
    │                                  └──(valid_to passed)──> expired
    └──────────(host or manager revokes)──────────> revoked
```

Recurring passes stay `active` across occurrences; validation checks the current occurrence window.

## 6. Verification algorithm (server and device)

1. Decode QR; check signature with `key_id` public key (device) or load pass by id (server).
2. Check `estate_id` = this estate.
3. Check gate ∈ `gate_ids` (or all).
4. Check now within window (± estate grace, default 15 min → AMBER).
5. Check not revoked (server: status; device: revocation list).
6. Check uses remaining (server authoritative; device uses local count + last sync).
7. Check visitor/plate against restricted list.
8. Return ALLOW / CHECK (with reasons) / DENY (with reason).

## 7. Business rules

1. Only users with `visitor.invite` (household permission) or management roles can create passes.
2. Max pass duration per estate setting (default 30 days; staff passes up to 12 months with approval).
3. Revocation takes effect immediately online and on devices at next revocation sync (target ≤ 5 min; pushed via realtime when connected).
4. Ending an occupancy revokes the household's recurring and staff passes.
5. Walk-in approval timeout per estate setting (default 180 s); on timeout the guard may call or deny, never auto-allow.
6. Guard override of DENY/CHECK requires a reason and is flagged to the supervisor.
7. Gate events are append-only; corrections are new events.
8. Offline events sync with device time; if device time differs from server by > 5 minutes, events are flagged.
9. Restricted visitors are per estate only (cross-estate sharing not allowed until legal approval).
10. Visitor photos only if the estate enables it; retained per retention schedule (default 90 days).

## 8. API

| Method          | Path                                                     | Purpose                                 |
| --------------- | -------------------------------------------------------- | --------------------------------------- |
| POST            | `/v1/estates/:estateId/visitor-invitations`              | Create invitation + passes              |
| GET             | `/v1/estates/:estateId/visitor-passes?mine=true&status=` | List passes                             |
| GET             | `/v1/estates/:estateId/visitor-passes/:id`               | Pass detail (incl. QR payload for host) |
| POST            | `/v1/estates/:estateId/visitor-passes/:id/share`         | Send via SMS/WhatsApp                   |
| PATCH           | `/v1/estates/:estateId/visitor-passes/:id`               | Edit window (if unused)                 |
| POST            | `/v1/estates/:estateId/visitor-passes/:id/revoke`        | Revoke                                  |
| GET             | `/v1/public/passes/:publicToken`                         | Visitor pass page data                  |
| POST            | `/v1/estates/:estateId/gate/verify`                      | Verify QR/PIN online                    |
| POST            | `/v1/estates/:estateId/gate/events`                      | Record entry/exit                       |
| POST            | `/v1/estates/:estateId/gate/sync`                        | Batch sync offline events               |
| GET             | `/v1/estates/:estateId/gate/expected?gateId=&from=&to=`  | Expected list for device                |
| GET             | `/v1/estates/:estateId/gate/revocations?since=`          | Revocation list delta                   |
| GET             | `/v1/estates/:estateId/gate/keys`                        | Public keys                             |
| POST            | `/v1/estates/:estateId/walkins`                          | Guard creates walk-in request           |
| POST            | `/v1/estates/:estateId/walkins/:id/approve` · `/reject`  | Host responds                           |
| GET             | `/v1/estates/:estateId/gate/inside`                      | Visitors currently inside               |
| GET             | `/v1/estates/:estateId/gate/events?filters`              | Visitor log (management)                |
| GET/POST/DELETE | `/v1/estates/:estateId/restricted-visitors[/:id]`        | Restricted list                         |

## 9. Events and realtime

Events: `visitor.pass.created`, `visitor.pass.revoked`, `visitor.pass.expired`, `visitor.gate.entered`, `visitor.gate.exited`, `visitor.gate.denied`, `visitor.gate.override`, `visitor.walkin.requested`, `visitor.walkin.approved`, `visitor.walkin.rejected`, `visitor.walkin.timed_out`, `visitor.overstay.detected`.

Realtime rooms: `estate:<id>:gate:<gateId>` (live feed, revocations), `user:<hostId>` (walk-in request, arrival).

## 10. Jobs

- `visitor.pass.lifecycle` — activate/expire passes (every minute).
- `visitor.walkin.timeout` — delayed job per request.
- `visitor.overstay.check` — every 15 minutes.
- `visitor.revocations.publish` — on revocation.
- `visitor.photos.purge` — daily per retention.

## 11. Notifications

Host: visitor arrived/left, walk-in request (high priority), pass shared confirmation, overstay. Visitor: pass link (SMS/WhatsApp), pass revoked/changed. Supervisor: guard override, walk-in timeouts above threshold.

## 12. Performance

- Online verify p95 < 300 ms.
- Expected list for a gate < 200 KB for a 2,000-unit estate.
- Morning peak: 10 verifications/second per gate sustained.

## 13. Acceptance criteria

- A pass revoked online is denied by an offline device after its next revocation sync, and by an online device immediately.
- Offline entries recorded during a 2-hour outage sync without duplicates.
- A walk-in request reaches the host within 3 seconds and times out at the configured interval.
- Every gate decision has a guard, device, time and reason recorded.

## 14. Phase 1 implementation notes

Built in `src/modules/visitor` (credentials in [ADR-0010](../adr/0010-visitor-pass-credentials.md)):

- Pass types: `one_time`, `multi_entry`, `recurring` (days and hours in WAT), `domestic_staff` (schedule from the approved staff record, up to 366 days), `delivery`, `event`. Contractor passes are not built.
- **Event passes and guest lists (20 Nov 2026):** an invitation of type `event` carries `event: { name, guests[] }` (1 to 300 names) instead of `visitors`, and creates **one** pass (QR and PIN for the event, no use limit within the window) plus `tenant.event_guests` rows. Guards list event passes around now for their gate (`GET …/gate/event-passes?gateId=`, 12 hours either side) and check a guest off (`POST …/event-guests/:id/check-in`, `gate.verify`): the pass must pass the same entry rules as a scan at that gate, each guest checks in once, and an entry gate event is recorded against the pass. Hosts read the list with check-in times (`GET …/visitor-passes/:id/guests`). Check-in needs a connection; offline, guards still verify the event pass and record entries by name.
- **Deliveries (20 Nov 2026):** `tenant.gate_deliveries` records a parcel left at the gate for a unit (`POST …/deliveries`, `gate.verify`), notifies the household (`visitor.delivery_at_gate`), and is closed once as `collected` (with who took it) or `returned` (`POST …/deliveries/:id/close`). `GET …/deliveries` lists everything for guards and only the caller's households' parcels for residents. A courier who must come in goes through a walk-in or a resident's delivery pass as before.
- Hosts: `POST …/visitor-invitations` (one pass per visitor, returns QR, PIN and pass link), `GET …/visitor-passes`, `GET …/visitor-passes/:id`, `POST …/:id/revoke`, `POST …/:id/share` (SMS from the worker). Visitor page: `GET /v1/public/passes/:token` (rate-limited; credentials hidden once revoked, used or expired). Editing a pass window is not built (revoke and re-issue).
- Gate (`gate.verify`): `POST …/gate/verify`, `POST …/gate/events` (idempotent on `clientUuid`; denials and overrides need a reason; overrides audited), `POST …/gate/sync` (offline batches, clock skew flagged), `GET …/gate/expected`, `GET …/gate/revocations`, `GET …/gate/keys`, `GET …/gate/inside`, walk-ins (`POST …/walkins`; host `POST …/walkins/:id/approve|reject`; `GET …/walkins/:id`). Management: `GET …/gate/events`, restricted list (`GET/POST/DELETE …/restricted-visitors`).
- Worker (`gate` queue): pass shares and revocation of a household's passes when its occupancy ends.
- **Not yet built:** realtime pushes to gate devices, overstay detection, photo capture and purge, supervisor alerts for overrides, gate-device identity (guards sign in as users today).
