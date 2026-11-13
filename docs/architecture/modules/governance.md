# Module: Governance

> Safezone by Techguard · Module documentation · v0.1 (13 Nov 2026)
> Phase: 3 (polls via community), 5 (full governance) · Owner: Backend · Apps: management-web, management-mobile, resident-mobile

## 1. Responsibility

Governance supports how an estate is **run collectively**: policies, rules and regulations, the estate constitution, management committee records, annual general meetings and other meetings, agendas and minutes, resident voting, resolutions, policy acknowledgements, dispute resolution and governance history.

## 2. Capabilities

1. Policies and rules: publish, version, require acknowledgement from residents (and optionally staff).
2. Estate constitution and bye-laws as versioned governance documents.
3. Management committee: members, positions (chair, secretary, treasurer…), terms, history.
4. Meetings: type (AGM, EGM, committee, town hall), date, venue or online link, agenda, attendees, quorum rules, notices sent.
5. Minutes: draft, approve, publish; action items with owners and due dates.
6. Voting: motions with options, eligibility (one vote per unit / per owner / per resident), voting window, secret or open ballot, proxy votes (if allowed), quorum and threshold rules; results.
7. Resolutions: recorded outcomes linked to votes and minutes.
8. Policy acknowledgements tracking and reminders.
9. Disputes: logged disputes between residents or with management, mediation notes, outcomes (privacy-restricted).
10. Governance history and exports.

## 3. Data model

| Table                     | Key columns                                                                                                                                                                                                                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `policies`                | `id`, `estate_id`, `title`, `category`, `current_version_id`, `requires_ack`, `audience`, `status`                                                                                                                                                                                           |
| `policy_versions`         | `id`, `policy_id`, `document_id`, `version`, `effective_on`, `published_by`                                                                                                                                                                                                                  |
| `policy_acknowledgements` | `policy_version_id`, `user_id`, `acknowledged_at`                                                                                                                                                                                                                                            |
| `committee_members`       | `id`, `estate_id`, `user_id`, `position`, `term_start`, `term_end`                                                                                                                                                                                                                           |
| `meetings`                | `id`, `estate_id`, `type`, `title`, `starts_at`, `location`, `online_link`, `agenda` (jsonb), `quorum_rule`, `status` (scheduled, held, cancelled), `notice_sent_at`                                                                                                                         |
| `meeting_attendance`      | `meeting_id`, `user_id`, `unit_id`, `present`, `proxy_for`                                                                                                                                                                                                                                   |
| `minutes`                 | `id`, `meeting_id`, `document_id`, `status` (draft, approved, published), `approved_by`                                                                                                                                                                                                      |
| `action_items`            | `id`, `meeting_id`, `title`, `owner_id`, `due_on`, `status`                                                                                                                                                                                                                                  |
| `motions`                 | `id`, `estate_id`, `meeting_id` (nullable), `title`, `description`, `options`, `eligibility` (per_unit, per_owner, per_resident), `ballot` (secret, open), `opens_at`, `closes_at`, `quorum`, `threshold` (simple, two_thirds, custom), `status` (draft, open, closed, passed, failed, void) |
| `votes`                   | `id`, `motion_id`, `voter_user_id`, `unit_id`, `option`, `proxy_by`, `cast_at` (secret ballots store voter in a separate eligibility table and vote without user link)                                                                                                                       |
| `resolutions`             | `id`, `estate_id`, `motion_id`, `text`, `adopted_on`                                                                                                                                                                                                                                         |
| `disputes`                | `id`, `estate_id`, `parties`, `summary`, `status`, `handler_id`, `outcome`                                                                                                                                                                                                                   |

## 4. Business rules

1. Only eligible voters (per `eligibility`) can vote; one vote per eligible unit/owner/resident.
2. Secret ballots record that a voter voted (to prevent double voting) separately from the vote choice.
3. Results visible only after close (unless open ballot with live results enabled).
4. Votes cannot be changed after the window closes; within the window, re-voting replaces the previous vote if allowed.
5. Quorum and threshold computed at close; result recorded with counts.
6. Minutes become visible to residents only after approval.
7. Disputes are visible only to parties and handlers.
8. Policy updates requiring acknowledgement re-prompt affected users on next app open.

## 5. API

| Method         | Path                                                        | Purpose             |
| -------------- | ----------------------------------------------------------- | ------------------- |
| GET/POST/PATCH | `/v1/estates/:estateId/policies[/:id]`                      | Policies            |
| POST           | `/v1/estates/:estateId/policies/:id/versions`               | Publish version     |
| POST           | `/v1/estates/:estateId/policy-versions/:id/acknowledge`     | Acknowledge         |
| GET/POST/PATCH | `/v1/estates/:estateId/committee`                           | Committee           |
| GET/POST/PATCH | `/v1/estates/:estateId/meetings[/:id]`                      | Meetings            |
| POST           | `/v1/estates/:estateId/meetings/:id/notice` · `/attendance` | Notice / attendance |
| POST/PATCH     | `/v1/estates/:estateId/meetings/:id/minutes`                | Minutes             |
| GET/POST       | `/v1/estates/:estateId/motions[/:id]`                       | Motions             |
| POST           | `/v1/estates/:estateId/motions/:id/votes`                   | Vote                |
| GET            | `/v1/estates/:estateId/motions/:id/results`                 | Results             |
| GET/POST/PATCH | `/v1/estates/:estateId/disputes[/:id]`                      | Disputes            |

## 6. Events

`governance.policy.published`, `governance.meeting.scheduled`, `governance.minutes.published`, `governance.motion.opened`, `governance.motion.closed`, `governance.resolution.adopted`.

## 7. Acceptance criteria

- A per-unit vote allows exactly one vote per unit regardless of how many residents live there.
- A secret ballot cannot be traced to a voter by any API or management report.
- Residents are prompted to acknowledge a new mandatory policy and acknowledgements are reportable.
