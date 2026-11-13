# Module: Devices and Smart Estate (IoT)

> Safezone by Techguard · Module documentation · v0.1 (13 Nov 2026)
> Phase: 1 (gate device API design), 6 (IoT integrations) · Owner: Backend · Apps: management-web, super-admin, security-mobile

## 1. Responsibility

Devices integrates **connected hardware** with Safezone: registration, authentication, estate association, status and health monitoring, event ingestion, remote commands where supported, integration configuration and failure alerts. Estates can run Safezone fully without hardware; this module adds automation when they have it.

Phone-based gate devices (Security App) are registered through [security](security.md)/[identity](identity.md); this module covers dedicated hardware.

## 2. Target integrations (priority order)

1. QR scanners and **gate barrier controllers** (open on ALLOW).
2. RFID / tag readers for resident vehicles.
3. Number-plate recognition (ANPR) cameras.
4. CCTV event links (motion/alarm events with clip references, not continuous video storage).
5. Video intercoms.
6. Smart locks and biometric access devices.
7. Sensors: fire/smoke, flood, intrusion.
8. Utility monitoring: generator status and fuel, water tank level, electricity metering.
9. Smart lighting.

## 3. Capabilities

1. Device registration with type, vendor, model, serial, location (space/gate), estate.
2. Device authentication: per-device credentials (mTLS certificate or HMAC key), rotation, revocation.
3. Integration adapters per vendor protocol (HTTP webhooks, MQTT, vendor cloud APIs).
4. Event ingestion: normalised events (`plate_read`, `tag_read`, `barrier_opened`, `door_unlocked`, `alarm`, `sensor_reading`, `heartbeat`).
5. Rules: e.g. `plate_read` of a registered resident vehicle → open barrier + record gate event; `smoke_alarm` → create SOS (fire) for the unit/zone.
6. Remote commands: open barrier, unlock door (where supported, with permission and audit).
7. Health: heartbeats, last seen, battery, firmware; offline alerts.
8. Event log with retention.
9. Integration configuration UI and test tools.

## 4. Data model

| Table                 | Key columns                                                                                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `devices`             | `id`, `estate_id`, `type`, `vendor`, `model`, `serial`, `space_id`, `gate_id`, `integration_id`, `credential_ref`, `status` (active, offline, disabled), `firmware`, `last_seen_at` |
| `device_integrations` | `id`, `estate_id`, `vendor`, `protocol`, `config` (encrypted), `status`                                                                                                             |
| `device_events`       | `id`, `estate_id`, `device_id`, `type`, `payload`, `occurred_at`, `received_at` — partitioned by month                                                                              |
| `device_rules`        | `id`, `estate_id`, `trigger` (event type + conditions), `actions` (jsonb), `enabled`                                                                                                |
| `device_commands`     | `id`, `estate_id`, `device_id`, `command`, `requested_by`, `status`, `result`, `at`                                                                                                 |

## 5. Business rules

1. Devices only send data for their own estate; credentials are estate-bound.
2. Remote unlock/open commands require `device.command` permission and are audited with reason.
3. Automatic barrier opening only for ALLOW decisions; CHECK/DENY always need a guard.
4. A device offline > 10 minutes during operating hours raises an alert.
5. Sensor-triggered SOS is marked `source = device` and follows normal escalation.
6. CCTV: Safezone stores event metadata and links/clip references, not continuous footage (NDPA minimisation).

## 6. API

| Method         | Path                                                   | Purpose                           |
| -------------- | ------------------------------------------------------ | --------------------------------- |
| GET/POST/PATCH | `/v1/estates/:estateId/devices[/:id]`                  | Devices                           |
| POST           | `/v1/estates/:estateId/devices/:id/credentials/rotate` | Rotate                            |
| GET/POST       | `/v1/estates/:estateId/device-integrations`            | Integrations                      |
| GET/POST/PATCH | `/v1/estates/:estateId/device-rules`                   | Rules                             |
| POST           | `/v1/estates/:estateId/devices/:id/commands`           | Command                           |
| POST           | `/v1/devices/events`                                   | Device event ingest (device auth) |
| GET            | `/v1/estates/:estateId/device-events?deviceId=&type=`  | Event log                         |
| GET            | `/v1/platform/devices/health`                          | Fleet health                      |

## 7. Events

`devices.device.registered`, `devices.device.offline`, `devices.event.received`, `devices.command.executed`, `devices.rule.triggered`.

## 8. Acceptance criteria

- A registered resident plate read by an ANPR camera opens the barrier and records a gate event within 2 seconds.
- A device with revoked credentials cannot post events.
- A smoke alarm event creates a fire SOS for the mapped location.
