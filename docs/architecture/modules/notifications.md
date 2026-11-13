# Module: Notifications

> Safezone by Techguard · Module documentation · v0.1 (13 Nov 2026)
> Phase: 0 (core), 1 (all channels) · Owner: Backend · Used by: every module

## 1. Responsibility

Notifications delivers messages to people across **in-app, push, SMS, WhatsApp, email and voice**, with templates, user preferences, priorities, retries, fallbacks, delivery tracking, cost tracking and history. Modules request a notification by **intent** (e.g. `visitor.arrived`); this module decides channels, renders templates and sends.

## 2. Channels and providers

| Channel  | Provider                                                     | Typical use                                           |
| -------- | ------------------------------------------------------------ | ----------------------------------------------------- |
| In-app   | Safezone (DB + realtime)                                     | Everything; notification centre                       |
| Push     | **Expo Notifications** (Expo push service → FCM/APNs)        | Most alerts                                           |
| SMS      | Termii or Africa's Talking (DND route, registered sender ID) | OTP, SOS, emergency broadcasts, pass links, fallbacks |
| WhatsApp | Meta WhatsApp Cloud API (utility templates)                  | Pass links, receipts, reminders (cheaper than SMS)    |
| Email    | **Zoho SMTP**                                                | Receipts, statements, onboarding, reports             |
| Voice    | Africa's Talking Voice or Twilio                             | SOS escalation calls                                  |

## 3. Capabilities

1. Notification intents catalogue with default channels and priority.
2. Templates per intent × channel × locale, with variables; estate overrides for selected intents.
3. User preferences per category and channel; non-optional categories enforced (SOS, emergency broadcasts, payment confirmations, security approvals).
4. Priority lanes: critical (SOS), high (walk-ins, OTP), normal, bulk (reminders, announcements).
5. Fan-out to audiences (users, households, roles, buildings, estate).
6. Fallback chains (e.g. push → SMS if no receipt in 30 s for critical).
7. Delivery tracking: queued, sent, delivered, failed, read (in-app).
8. Expo push receipts processing; invalid tokens removed.
9. Retry with backoff; dead-letter.
10. Quiet hours for non-critical bulk sends (estate default 21:00–07:00).
11. Scheduled notifications.
12. Cost tracking per estate and channel (SMS, voice, WhatsApp).
13. Notification history and in-app centre.
14. Unsubscribe links for email; WhatsApp opt-in records.

## 4. Data model

| Table                      | Key columns                                                                                                                                     |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `notification_intents`     | `key`, `category`, `default_channels`, `priority`, `mandatory` (bool) — seeded from code                                                        |
| `notification_templates`   | `id`, `intent_key`, `channel`, `locale`, `estate_id` (null = platform default), `subject`, `body`, `provider_template_id` (WhatsApp), `version` |
| `notification_preferences` | `user_id`, `estate_id`, `category`, `channel`, `enabled`                                                                                        |
| `notifications`            | `id`, `estate_id`, `user_id`, `intent_key`, `payload`, `priority`, `created_at`, `read_at` (in-app record) — partitioned by month               |
| `notification_deliveries`  | `id`, `notification_id`, `channel`, `provider`, `to_address`, `status`, `provider_ref`, `error`, `cost_kobo`, `sent_at`, `delivered_at`         |
| `push_tokens`              | `user_id`, `device_id`, `app`, `expo_token`, `last_seen_at`, `invalid_at`                                                                       |
| `whatsapp_optins`          | `user_id`, `phone`, `opted_in_at`, `source`                                                                                                     |

## 5. Sending flow

1. Module calls `notifications.send({intent, recipients, data, estateId, dedupeKey})` (inside its transaction → outbox).
2. Worker expands audiences to users (respecting membership and privacy).
3. For each user: resolve channels = intent defaults ∩ preferences (mandatory channels always on).
4. Render templates (locale fallback to English).
5. Enqueue per channel on the right priority queue.
6. Channel workers call provider adapters; record delivery.
7. Webhooks / receipts update status; failures trigger fallback where configured.

## 6. Business rules

1. SOS and emergency broadcasts ignore preferences and quiet hours.
2. Bulk sends (announcements, reminders) are throttled per estate to respect provider limits.
3. SMS content ≤ 160 GSM-7 characters where possible; long messages split with cost noted.
4. No personal data of others in SMS beyond what the intent needs (e.g. visitor first name).
5. WhatsApp only for users with an opt-in record and only with approved utility templates.
6. Email from `no-reply@` with reply-to the estate's contact where relevant; SPF/DKIM/DMARC configured for the sending domain on Zoho.
7. Dedupe key prevents duplicate sends within 10 minutes.
8. Free-plan SMS caps per estate (configurable) for non-critical intents; critical intents never capped.

## 7. API

| Method  | Path                                                            | Purpose                            |
| ------- | --------------------------------------------------------------- | ---------------------------------- |
| GET     | `/v1/me/notifications?cursor=`                                  | Notification centre                |
| POST    | `/v1/me/notifications/:id/read` · `/read-all`                   | Mark read                          |
| GET/PUT | `/v1/me/notification-preferences`                               | Preferences                        |
| POST    | `/v1/me/push-tokens`                                            | Register Expo push token           |
| DELETE  | `/v1/me/push-tokens/:id`                                        | Remove                             |
| GET/PUT | `/v1/estates/:estateId/notification-templates/:intent`          | Estate overrides (allowed intents) |
| GET     | `/v1/estates/:estateId/notification-usage?month=`               | Cost and volume                    |
| POST    | `/v1/webhooks/sms/:provider` · `/whatsapp` · `/voice/:provider` | Delivery receipts                  |

## 8. Events

Consumes almost all domain events. Emits `notifications.delivery.failed`, `notifications.provider.degraded`.

## 9. Jobs

- `notifications.push.receipts` — every minute, checks Expo receipts.
- `notifications.fallback` — delayed checks for critical messages.
- `notifications.scheduled` — sends due scheduled notifications.
- `notifications.cleanup` — purge per retention (in-app 12 months, delivery logs 24 months).

## 10. Monitoring

Delivery rate and latency per channel and provider; provider error rates; SMS spend per estate per day; alert if critical delivery rate < 99%.

## 11. Acceptance criteria

- A user who turns off maintenance push still gets SOS and emergency broadcasts.
- An Expo push that returns `DeviceNotRegistered` removes the token and falls back to SMS for critical intents.
- Monthly usage per estate shows SMS count and cost correctly.
