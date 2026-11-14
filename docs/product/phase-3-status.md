# Phase 3 status: Community and Facilities

> Started 14 Nov 2026. Scope: [implementation plan, Phase 3](implementation-plan.md). Goal: replace estate WhatsApp groups with structured, moderated channels.

Phase 3 **backend core** is built; no Phase 3 screens are built yet.

| Area                                                                                               | Backend     | Notes                                                                                                              |
| -------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------ |
| Building, estate and resident channels, messages, reactions, mentions, search                      | Done        | Membership derived from occupancy ([ADR-0015](../architecture/adr/0015-phase-3-community-facilities-documents.md)) |
| Private messaging (off by default), blocking                                                       | Done        |                                                                                                                    |
| Reports, moderation queue and actions, audit log, appeals, guidelines                              | Done        |                                                                                                                    |
| Polls                                                                                              | Done        |                                                                                                                    |
| Facilities, availability, bookings, approvals, payments, cancellations, blackouts, damage, reports | Done        | Deposits and guest passes not built                                                                                |
| Documents: folders, visibility, versions, expiry, access history                                   | Done        |                                                                                                                    |
| Realtime delivery (Socket.IO rooms, typing)                                                        | Not started | Clients use REST for now                                                                                           |
| Apps (channels, bookings, documents screens)                                                       | Not started |                                                                                                                    |
