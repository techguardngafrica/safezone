# ADR-0010: Visitor pass credentials and gate event storage

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** Sunday Etom Eni
- **Affects:** visitor module, security-mobile (offline verification), public-web pass page, `KeyVault` adapter

## Context

visitor.md §3 asks for Ed25519-signed QR codes (≤ 200 bytes), 6-digit PINs unique among active passes, a public pass link with its own token, offline verification, and gate events partitioned by month. Several details were open: where private keys live, how PINs stay unique when "active" depends on the clock, and whether to partition gate events now.

## Decision

1. **QR token** is binary, then base64url: `v(1) | passId(16) | estateId(16) | notBefore(4) | notAfter(4) | maxUses(2) | keyIndex(2) | Ed25519 signature(64)`, 109 bytes and 146 characters. Gate restrictions are not in the token; devices check them against the expected list. Ed25519 is deterministic, so the server re-signs on demand and stores no token.
2. **Signing keys:** one key pair per estate in `tenant.estate_signing_keys`, created on first pass. The private key is wrapped by the `KeyVault` adapter (local AES-256-GCM with `PASS_KEY_ENCRYPTION_KEY`; a KMS adapter can replace it). Devices fetch public keys from `GET …/gate/keys`.
3. **PIN:** stored wrapped by the same `KeyVault` (the host and the pass page must be able to show it again) and looked up by `HMAC(OTP_HMAC_SECRET, "visitor-pin:v1:<estate>:<pin>")`. Uniqueness among live passes is checked when issuing; an index predicate cannot use the clock. If two live passes ever share a PIN, verification answers CHECK (`ambiguous_pin`), never ALLOW. The offline list carries `sha256(passId ":" pin)` per pass; a 6-digit PIN is guessable from it, which is accepted because the list lives only on registered gate devices and covers the next 24 hours.
4. **Pass page token** is `base64url(estateId(16) | HMAC(passId)[0..24])`, 54 characters. It carries its estate (so the lookup runs under that estate's RLS context) and is derived, never stored; only its SHA-256 is stored.
5. **Gate events are not partitioned yet.** `tenant.gate_events` is append-only (trigger), idempotent on `(estate_id, client_uuid)` and indexed on `(estate_id, occurred_at)`. Prisma does not model declarative partitions cleanly, and pilot volumes (thousands of events per estate per day) do not need them. Convert to monthly range partitions on `occurred_at` (with the unique key extended to include it) before the table passes 50 million rows or the first estate passes 20,000 events a day, whichever comes first.
6. **Statuses** `scheduled`, `active`, `expired` and `used` are computed from the window and use count when read, so no minute job is needed; `revoked` is stored.
7. **Walk-ins** time out on read (and are then stored as `timed_out`); a timeout never admits anyone.

## Consequences

- No live credential (QR, pass link, invitation link) is stored in the database or the outbox.
- Rotating `PASS_KEY_ENCRYPTION_KEY` needs a re-wrap job (not built). Rotating `OTP_HMAC_SECRET` invalidates open pass links and PIN lookups.
- The partitioning change is a planned migration with a clear trigger, not an emergency.
