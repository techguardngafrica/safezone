# ADR-0015: Community channels, facilities and documents

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** Sunday Etom Eni
- **Affects:** community, facilities, documents, billing, files, property, occupancy

## Context

Phase 3 replaces estate WhatsApp groups with moderated channels, adds facility bookings and document management. The docs leave open how building membership stays in sync, how overlapping bookings are prevented, how bookings are paid and refunded through the ledger, and who may download documents.

## Decision

### Community (community.md)

1. **Building channels** exist per building or block (nearest ancestor of the unit), created on demand. **Membership is derived** from active household membership at query time, so move-ins and move-outs apply instantly with no sync job (rules 1–2). Owners join only when `community.owners_in_building_channels` is on.
2. **History window:** in building channels a member reads messages from the date they joined their household there, so a new tenant cannot read the previous household's conversation (rule 8). Estate channels show full history.
3. **Estate channels** (General, Security Updates, Events and Activities, Suggestions, Management Announcements, Community Support, Buy and Sell) are seeded on first use; Security Updates and Management Announcements are staff-only for posting.
4. Resident channels: public (join), restricted (request, owner or moderator accepts) and invite-only; approval follows `community.channel_approval`. Direct messages need `community.private_messaging` and are refused when either side blocked the other (`FEATURE_NOT_ENABLED`, `USER_BLOCKED`).
5. Members accept `community.guidelines` before posting. Messages are never deleted (trigger); own deletes and moderator removals show a placeholder, content is kept (rule 7). Edits within 15 minutes. Author names only, never phone numbers.
6. Notifications: members opted into `all`, plus mentioned members, by push. Derived channels default to mentions-only to avoid floods in 5,000-member channels.
7. Moderation: one call acts and closes all open reports on the target. Mute and ban are estate-wide (community profile), plus removal from a channel and channel suspension. Appeals are decided by a different moderator; overturning restores the message or lifts the mute or ban.
8. Polls are official (`announcement.publish`), estate or spaces audience, one vote per user or per household (unique voter key), results after voting or closing; voters list only for named polls.
9. Exports include channels, moderation actions and polls, **not resident messages** (platform.md §6: only with a legal basis).
10. **Realtime emits (Socket.IO rooms) are not built**; clients fetch over REST.

### Facilities (facilities.md)

11. **No overlap is enforced in the database** by a trigger that locks the facility row and rejects any live booking whose `[starts_at, blocked_until)` overlaps another (`blocked_until` = end + buffer). Two simultaneous requests: one succeeds, one gets `BOOKING_CONFLICT`. This avoids the `btree_gist` extension, which Prisma's drift check does not model.
12. Rules (hours in WAT, duration, advance window, guests, weekly and monthly household limits, blackouts, arrears block via `facilities.block_with_arrears_kobo`) are pure functions; managers may override with a recorded reason.
13. **Payment through billing:** a priced booking issues an invoice (`facility_booking`) payable by normal checkout; the hold lasts 30 minutes. `billing.invoice.paid` (routed to the `facilities` queue) confirms the booking; a one-minute sweep releases expired holds (credit note cancels the invoice), completes past bookings and sends 24-hour reminders.
14. **Refunds on cancellation** follow the policy at cancellation time and go to the payer's credit (`Dr income adjustments / Cr payer credit`), from which payments can refund to card. Blackouts cancel affected bookings with full refunds. Damage charges are separate invoices. **Deposits and guest passes are not built.**

### Documents (documents.md)

15. Visibility rules: managers only, all residents, roles, spaces (units at or below), households, or one user. Documents decides visibility and asks the files module for a 5-minute link through `FilesService.grantedDownloadUrl` (still requires a clean scan, always audited). Versions and the access log are append-only; archiving hides a document but keeps versions. Expiry reminders at 30 and 7 days and on the day run in the occupancy daily job.

## Consequences

- Community membership can never drift from occupancy, at the cost of per-request lookups (acceptable at estate scale; cache later if needed).
- Booking money stays in the estate's ledger and never bypasses billing or payments.
- Open: realtime delivery, message partitioning by month, booking deposits and guest passes, policy acknowledgements (governance, Phase 5).
