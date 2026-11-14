# Module: Community and Communication

> Safezone by Techguard · Module documentation · v0.1 (13 Nov 2026)
> Phase: 1 (official announcements), 3 (channels, messaging, moderation, polls) · Owner: Backend · Apps: resident-mobile, management-web, management-mobile

## 1. Responsibility

Community provides **structured, moderated communication** inside an estate instead of one large group chat: official estate announcements, building-level communities, estate-wide channels, resident-created channels, private messaging, polls, and the moderation and governance tools around them.

## 2. Capabilities

### Official communication (Phase 1)

1. Announcements to estate, buildings, specific units, or roles; scheduled; attachments; channels (in-app, push, SMS, email).
2. Visually distinct from resident conversation; read receipts (aggregate count).
3. Emergency broadcasts (owned by [emergency](emergency.md), displayed here).

### Channels (Phase 3)

4. **Building channels** created automatically per building; membership synced from active occupancy.
5. **Estate-wide channels**: General, Security Updates, Events and Activities, Suggestions, Management Announcements, Community Support, Buy and Sell (configurable set).
6. **Resident-created channels**: interest-based (sports, parents, book club, car owners, business networking…), public / restricted / invite-only; approval if estate requires.
7. Channel roles: owner, moderator, member.
8. Messages: text, images, files, replies (threads), reactions, mentions, edit (15 min) and delete own message.
9. Channel search and message search within joined channels.
10. Notifications per channel (all, mentions, muted).
11. **Private messaging** (one-to-one) when the estate enables it; blocking; abuse reporting.
12. **Polls** with options, deadline, anonymous or named, audience.

### Moderation (Phase 3)

13. Report message / channel / user, with reasons.
14. Moderation queue; actions: remove content, warn, mute (duration), remove from channel, suspend channel, ban from community (estate-level).
15. Moderator assignments (estate staff or trusted residents).
16. Configurable community guidelines shown on first use.
17. Appeals for removals and bans.
18. Moderation audit log.

## 3. Data model

| Table                                   | Key columns                                                                                                                                                                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `announcements`                         | `id`, `estate_id`, `title`, `body`, `audience` (jsonb), `channels`, `attachments`, `category`, `scheduled_at`, `published_at`, `author_id`, `status`                                                                                                         |
| `announcement_reads`                    | `announcement_id`, `user_id`, `read_at`                                                                                                                                                                                                                      |
| `channels`                              | `id`, `estate_id`, `type` (building, estate, resident, direct), `space_id` (building), `name`, `description`, `category`, `privacy` (public, restricted, invite_only), `status` (pending_approval, active, suspended, archived), `created_by`, `approved_by` |
| `channel_members`                       | `channel_id`, `user_id`, `role` (owner, moderator, member), `notify` (all, mentions, none), `joined_at`, `muted_until`, `source` (auto_occupancy, joined, invited)                                                                                           |
| `messages`                              | `id`, `estate_id`, `channel_id`, `author_id`, `body`, `reply_to_id`, `attachments`, `mentions`, `edited_at`, `deleted_at`, `removed_by_moderation`, `created_at` — partitioned by month                                                                      |
| `message_reactions`                     | `message_id`, `user_id`, `emoji`                                                                                                                                                                                                                             |
| `user_blocks`                           | `estate_id`, `blocker_id`, `blocked_id`                                                                                                                                                                                                                      |
| `reports`                               | `id`, `estate_id`, `target_type` (message, channel, user), `target_id`, `reason`, `details`, `reported_by`, `status` (open, actioned, dismissed), `handled_by`                                                                                               |
| `moderation_actions`                    | `id`, `estate_id`, `action`, `target_type`, `target_id`, `reason`, `duration`, `moderator_id`, `appeal_status`                                                                                                                                               |
| `polls` / `poll_options` / `poll_votes` | Poll definition, options, one vote per user (or per household if configured)                                                                                                                                                                                 |

## 4. Business rules

1. Building channel membership = users with active occupancy in that building (owners optional by setting); leaving the building removes membership.
2. Residents never gain access to building channels outside their authorised property associations.
3. Private messaging only between members of the same estate, only if enabled; blocked users cannot message.
4. New resident channels need approval when `community.channel_approval` is on.
5. Official announcements can only be posted by `announcement.publish` holders and are labelled "Official".
6. Sponsored posts (from [advertising](advertising.md)) are labelled "Sponsored", appear only in the community feed placement, never inside private messages or building channels unless the estate allows.
7. Removed messages show "Removed by moderator" to members; content kept for audit for the retention period.
8. Members of a channel see history from their join date (building/estate channels) or full history (resident channels, configurable).
9. Muted members can read but not post until `muted_until`.
10. Phone numbers are not exposed in community profiles unless the user allows it.

## 5. Realtime

- Room `channel:<id>`: new messages, edits, deletes, reactions, typing (throttled).
- Clients fetch history over REST with cursor pagination (newest first, 50 per page).
- Delivery: realtime for connected users; push per notification preference for others.

## 6. API

| Method       | Path                                                                   | Purpose                  |
| ------------ | ---------------------------------------------------------------------- | ------------------------ |
| POST         | `/v1/estates/:estateId/announcements`                                  | Create / schedule        |
| GET          | `/v1/estates/:estateId/announcements`                                  | List (audience-filtered) |
| GET          | `/v1/estates/:estateId/channels?mine=true`                             | My channels              |
| POST         | `/v1/estates/:estateId/channels`                                       | Create channel           |
| POST         | `/v1/estates/:estateId/channels/:id/approve` · `/suspend` · `/archive` | Management               |
| POST/DELETE  | `/v1/estates/:estateId/channels/:id/members[/:userId]`                 | Join / invite / remove   |
| GET          | `/v1/estates/:estateId/channels/:id/messages?cursor=`                  | History                  |
| POST         | `/v1/estates/:estateId/channels/:id/messages`                          | Post                     |
| PATCH/DELETE | `/v1/estates/:estateId/messages/:id`                                   | Edit / delete own        |
| POST         | `/v1/estates/:estateId/messages/:id/reactions`                         | React                    |
| POST         | `/v1/estates/:estateId/direct-channels`                                | Start DM                 |
| POST         | `/v1/estates/:estateId/reports`                                        | Report                   |
| GET          | `/v1/estates/:estateId/moderation/queue`                               | Queue                    |
| POST         | `/v1/estates/:estateId/moderation/actions`                             | Act                      |
| POST         | `/v1/estates/:estateId/moderation/actions/:id/appeal`                  | Appeal                   |
| POST/GET     | `/v1/estates/:estateId/polls[/:id]`, `/polls/:id/votes`                | Polls                    |

## 7. Events

`community.announcement.published`, `community.channel.created`, `community.channel.approved`, `community.message.posted`, `community.message.removed`, `community.report.created`, `community.moderation.actioned`, `community.poll.closed`.

Consumes: `occupancy.occupancy.started/ended` (building membership), `property.space.created` (new building channel).

## 8. Performance

- Message post → delivered to online members < 1 s.
- History page load < 300 ms.
- Supports 5,000 members in an estate-wide channel.

## 9. Acceptance criteria

- A new tenant appears in their building channel automatically on approval and disappears on move-out.
- With private messaging disabled, the DM endpoints return `FEATURE_NOT_ENABLED`.
- A reported message can be removed from the moderation queue in two taps, and the action appears in the moderation audit log.

## 12. Phase 1 implementation notes

Built in `src/modules/community`: official announcements only. `POST /v1/estates/:estateId/announcements` (`announcement.publish`; audience the estate or chosen spaces, resolved to units at publication; `important` also goes by SMS), `GET …/announcements` (what the reader's units cover; `all=true` for management with recipient counts), `POST …/announcements/:id/read`. Every item is labelled official. Scheduling, attachments, role audiences and email are not built.
