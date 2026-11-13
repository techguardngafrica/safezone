# Module: Emergency and SOS

> Safezone by Techguard · Module documentation · v0.1 (13 Nov 2026)
> Phase: 1 · Owner: Backend · Apps: resident-mobile, security-mobile, management-mobile, management-web
> Criticality: **highest** — this module has its own queue, worker pool, monitoring and on-call paging.

## 1. Responsibility

Emergency owns SOS alerts from trigger to closure: triggering (resident or guard), cancellation countdown, classification, location capture, multi-channel fan-out to responders and contacts, acknowledgement, assignment, response tracking, escalation, resolution, false alarms, drills, emergency broadcasts and emergency history.

## 2. Capabilities

1. Trigger SOS from the Resident App (with household permission) or Security App.
2. SMS-based SOS when the phone has no data.
3. Configurable cancellation countdown (default 5 s, client-side; server accepts `cancel` within a grace period after trigger too).
4. Categories: security threat, medical emergency, fire, accident, suspicious activity, general.
5. Location capture (GPS with accuracy) + unit fallback.
6. Fan-out: realtime + push to on-duty guards and supervisor; push + SMS to managers per policy; SMS + optional voice call to the resident's external emergency contacts.
7. Acknowledgement (first responder claims), assignment, "responding", notes and photos.
8. Escalation rules with timers.
9. Resolution, false alarm marking, closure with notes.
10. Drill mode (alerts labelled DRILL, excluded from real stats, no external contact calls).
11. Emergency broadcasts from management to all members (push + SMS).
12. Live location updates during an active alert (every 15 s, stops on resolution).
13. History and response-time reporting.
14. Synthetic SOS monitoring on a canary estate.

## 3. States

```text
triggered ──> acknowledged ──> assigned ──> responding ──> resolved ──> closed
    │              │               │              │
    └──> cancelled (by triggerer within grace or confirmed false alarm before ack)
```

- `acknowledged` and `resolved` are tracked separately (business rule).
- `closed` means management or supervisor has completed the record (notes, category correction).

## 4. Data model

| Table                  | Key columns                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sos_alerts`           | `id`, `estate_id`, `triggered_by`, `trigger_role` (resident, guard), `household_id`, `space_id`, `category`, `is_drill`, `source` (app, sms, device), `status`, `triggered_at`, `acknowledged_at`, `acknowledged_by`, `assigned_to`, `responding_at`, `resolved_at`, `resolved_by`, `resolution`, `false_alarm`, `closed_at`, `closed_by`, `client_uuid` (idempotency) |
| `sos_locations`        | `id`, `estate_id`, `alert_id`, `lat`, `lng`, `accuracy_m`, `captured_at`                                                                                                                                                                                                                                                                                               |
| `sos_events`           | `id`, `estate_id`, `alert_id`, `type` (notified, delivered, acknowledged, assigned, escalated, note, photo, call, status_change), `actor_id`, `channel`, `payload`, `occurred_at` (timeline)                                                                                                                                                                           |
| `sos_notifications`    | `id`, `estate_id`, `alert_id`, `recipient_type` (guard, supervisor, manager, contact), `recipient_ref`, `channel` (realtime, push, sms, voice), `status` (queued, sent, delivered, failed), `provider_ref`, timestamps                                                                                                                                                 |
| `escalation_policies`  | `estate_id`, `steps` (jsonb `[ {after_s:60, notify:'next_guard'}, … ]`)                                                                                                                                                                                                                                                                                                |
| `emergency_broadcasts` | `id`, `estate_id`, `title`, `body`, `audience`, `channels`, `sent_by`, `sent_at`                                                                                                                                                                                                                                                                                       |
| `sms_sos_numbers`      | `estate_id`, `inbound_number`, `keyword`                                                                                                                                                                                                                                                                                                                               |

## 5. Fan-out design

1. `POST /sos` validates permission and idempotency, writes alert + location + outbox in one transaction, returns within 300 ms.
2. Outbox relay publishes to the `sos` queue (highest priority, dedicated worker pool).
3. Worker resolves recipients: on-duty guards (active shift sessions), supervisor, managers per policy, emergency contacts.
4. Sends **in parallel**: realtime emit to `estate:<id>:sos` and `user:<id>` rooms; Expo push (high priority, critical sound where allowed); SMS to managers per policy; SMS to emergency contacts (not in drills).
5. Delivery status tracked per recipient; Expo push receipts checked; failed push → SMS fallback.
6. Escalation timers scheduled as delayed jobs at policy steps; cancelled when acknowledged.
7. Target: trigger → first guard notified < 5 s (p95).

## 6. Escalation default

| After | If not acknowledged | Action                                                                |
| ----- | ------------------- | --------------------------------------------------------------------- |
| 60 s  | —                   | Notify next available guards and supervisor again (push + SMS)        |
| 120 s | —                   | Notify all managers (push + SMS); voice call to supervisor            |
| 180 s | —                   | Voice call to resident's emergency contacts; banner on management web |

Each step logs an `escalated` event. Estates can configure steps within limits (min 30 s between steps).

## 7. SMS SOS

- Each estate gets an inbound SMS keyword/number (e.g. `SOS <unit code>` to a short code or long number from the SMS provider).
- Inbound webhook matches the sender phone to a resident; creates alert with `source = sms`.
- Unknown sender → alert to supervisor with phone number only, marked unverified.

## 8. Business rules

1. Only users with `sos.trigger` can trigger; guards always can.
2. One active real alert per household at a time; repeated triggers attach to the existing alert as events.
3. Cancel allowed by the triggerer before acknowledgement; after acknowledgement only responders can resolve (false alarm).
4. Location is collected only from trigger until resolution.
5. Emergency contacts are notified for real alerts only, never drills.
6. Every state change and notification is recorded in the timeline.
7. Alerts and timelines are safety records: retained per retention schedule and never hard-deleted while within it, even if the estate is suspended.
8. Advertising never appears on any SOS screen.
9. Emergency broadcasts require `broadcast.emergency` and a confirmation step; they cannot be disabled by recipients.

## 9. API

| Method  | Path                                         | Purpose                   |
| ------- | -------------------------------------------- | ------------------------- |
| POST    | `/v1/estates/:estateId/sos`                  | Trigger (Idempotency-Key) |
| POST    | `/v1/estates/:estateId/sos/:id/cancel`       | Cancel                    |
| POST    | `/v1/estates/:estateId/sos/:id/location`     | Location update           |
| POST    | `/v1/estates/:estateId/sos/:id/acknowledge`  | Acknowledge               |
| POST    | `/v1/estates/:estateId/sos/:id/assign`       | Assign responder          |
| POST    | `/v1/estates/:estateId/sos/:id/responding`   | On the way                |
| POST    | `/v1/estates/:estateId/sos/:id/notes`        | Note/photo                |
| POST    | `/v1/estates/:estateId/sos/:id/resolve`      | Resolve / false alarm     |
| POST    | `/v1/estates/:estateId/sos/:id/close`        | Close record              |
| GET     | `/v1/estates/:estateId/sos?status=active`    | Active alerts             |
| GET     | `/v1/estates/:estateId/sos/:id`              | Detail + timeline         |
| GET/PUT | `/v1/estates/:estateId/escalation-policy`    | Policy                    |
| POST    | `/v1/estates/:estateId/sos/drills`           | Start drill               |
| POST    | `/v1/estates/:estateId/emergency-broadcasts` | Broadcast                 |
| POST    | `/v1/webhooks/sms-inbound`                   | SMS SOS                   |

## 10. Events

`emergency.alert.triggered`, `emergency.alert.cancelled`, `emergency.alert.acknowledged`, `emergency.alert.assigned`, `emergency.alert.escalated`, `emergency.alert.resolved`, `emergency.alert.closed`, `emergency.broadcast.sent`.

## 11. Monitoring

- Synthetic SOS every 15 min on a canary estate (drill flag, test recipients); page on-call if not delivered in 10 s.
- Metrics: trigger→first notified, trigger→acknowledged, acknowledged→resolved, delivery rate per channel, escalations per alert.
- Alert on: `sos` queue latency > 2 s, any failed fan-out, SMS provider error rate > 5%.

## 12. Reports

SOS count by category, drill vs real, median and p90 acknowledgement and resolution times, escalation rate, false alarm rate, by gate/zone and by shift.

## 13. Acceptance criteria

- With 2 guards on shift, an SOS shows on both gate devices and the supervisor's phone in < 5 s (p95, 4G).
- If nobody acknowledges, escalation steps fire at configured times and are visible in the timeline.
- A drill never contacts external emergency contacts.
- An SOS sent by SMS from a registered resident creates an alert linked to their unit.
