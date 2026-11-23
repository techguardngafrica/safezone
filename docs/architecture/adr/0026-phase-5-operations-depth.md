# ADR-0026: Phase 5 — Operations Depth architecture

- **Status:** Accepted
- **Date:** 2026-11-23
- **Deciders:** Engineering, Product

## Context

Phase 5 adds six operational capabilities for large residential estates and property management companies:

1. Full accounting & general ledger (`billing.md` Phase 5)
2. Procurement & inventory (`procurement.md`)
3. Workforce & HR (`workforce.md`)
4. Governance (`governance.md`)
5. Security operations depth: cross-estate security companies & QR/NFC patrols (`security.md` Phase 5)
6. Deeper analytics & reporting (`analytics.md`)

All six must uphold tenant isolation (`AGENTS.md §5.2`), strict module table ownership (`AGENTS.md §5.1`), append-only financial/safety records (`AGENTS.md §5.4`), and NDPA/privacy constraints (`AGENTS.md §6`).

## Decisions

### 1. Accounting extends the Phase 2 ledger via `LedgerService`

A dedicated `src/modules/accounting` module owns the new Phase 5 tables (`financial_periods`, `budgets`, `budget_lines`, `expenses`, `payables`, `payable_payments`, `bank_statements`, `bank_statement_lines`) and posts all balanced double-entry journals exclusively through `billing`'s exported `LedgerService`. No cross-module table queries are introduced.

### 2. Procurement integrates with Accounting and Maintenance via exported services

Three-way matched supplier invoices (PO vs. GRN vs. invoice within configurable tolerance, default ±2%) call `PayablesService.createFromProcurement()` in the same transaction. Issuing inventory stock to a maintenance work order calls `MaintenanceService` to record material cost.

### 3. Field-level encryption for salary records

`tenant.salary_records` stores `basic`, `allowances`, and `deductions` (integer kobo) in an AES-256-GCM encrypted payload wrapped by the existing `KeyVault` (`src/integrations/keys/key-vault.ts`) with a dedicated domain context (`salary:<estateId>:<staffId>`). Access is restricted strictly to roles holding `payroll.view` (`estate_owner` and `estate_accountant` by default; excluded from `estate_manager`).

### 4. Secret ballot non-traceability

Governance voting splits voter eligibility/deduplication (`tenant.motion_ballot_receipts`, keyed on `motion_id` + `voter_key` = `unit:<id>` or `user:<id>`) from cast choices (`tenant.motion_votes`). For `ballot = 'secret'`, `motion_votes` stores `voter_user_id = NULL` and `unit_id = NULL`, making it impossible for any API or management report to link a secret ballot to a voter.

### 5. Cross-estate security companies and offline patrols

`platform.security_companies`, `platform.security_company_guards`, and `platform.estate_security_contracts` live in the `platform` schema behind the `security_companies` DB context. Patrol routes, QR/NFC checkpoints, runs, and append-only patrol logs live in `tenant.*` with RLS. Guards on kiosk gate sessions hold `patrol.scan` and can record checkpoint scans offline for later sync.

### 6. Analytics read models and small-number suppression

An `analytics` PostgreSQL schema holds estate-scoped read-model projections (`rm_gate_daily`, `rm_sos_metrics`, `rm_collections_monthly`, `rm_maintenance_sla`, `rm_community_daily` with RLS on `estate_id`), platform aggregates (`rm_platform_daily`), and PII-stripped `product_events` (13-month retention). Cross-estate/platform cohorts below the configurable suppression threshold (default 200 users) are suppressed.

## Consequences

- `packages/permissions` gains Phase 5 permissions and updates built-in estate and platform roles.
- `packages/schemas` adds Phase 5 feature keys (`accounting`, `procurement`, `workforce`, `governance`, `patrols`, `analytics`) enabled on the free `core` plan.
- `DB_CONTEXTS` adds `security_companies` and `analytics`.
- BullMQ adds `procurement`, `workforce`, `governance`, `patrols`, and `analytics` queues while keeping `sos` strictly isolated.
