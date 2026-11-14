# ADR-0009: Spaces tree as a text materialised path

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** Sunday Etom Eni
- **Affects:** property module, `tenant.spaces`, anything that asks "all units in X"

## Context

property.md §3 proposes `spaces.path` as `ltree` with a GiST index. Prisma (ADR-0001) cannot read, write or filter `ltree` columns except through raw SQL, so every create, move and search would bypass the typed client. The queries we need are simple: children of a node, everything below a node, and moving a subtree.

## Decision

1. `path` is `text`: the dot-joined, dash-free UUIDs of the node's ancestors and itself (`<id>.<id>.<id>`), with `depth` stored next to it. Labels are hex, so they never contain `LIKE` wildcards.
2. "Everything below X" is `path LIKE '<X.path>.%'` (Prisma `startsWith`), served by a partial btree index `(estate_id, path text_pattern_ops) WHERE archived_at IS NULL`. The index is partial so Prisma's drift check ignores it, as it does the other expression and partial indexes.
3. Moving a subtree is one `UPDATE … SET path = <new prefix> || substr(path, …), depth = depth + Δ` inside the same transaction as the parent change (property.md §4.7).
4. Integrity rules Prisma cannot express are in the migration: type and unit-field `CHECK`s, unit codes unique per estate (case-insensitive, live units only), other codes unique among live siblings, `external_ref` unique per estate.
5. Placement rules (which type may sit under which, maximum depth 8) live in `modules/property/domain/spaces.ts`.

## Consequences

- No extension to install; works on the stock `postgres:17-alpine` image and any managed Postgres.
- Paths are longer than `ltree` labels (33 characters per level); at depth 8 that is under 270 bytes.
- We lose `ltree` operators such as `~` pattern queries; none are needed so far. Revisit if reporting needs them.
