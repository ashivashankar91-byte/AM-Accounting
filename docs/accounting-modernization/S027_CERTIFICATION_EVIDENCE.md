# S027 Certification Evidence — Schedule Aging Engine

**Status:** `S027_INTEGRATED_AND_CERTIFIED` (backend/database — see Integration Record below for exact scope)
**Source branch:** `r1-s026-s027-schedule-engine-v2`, certified at `62b5a39`.
**Depends on:** S026 (`fce3c4e`), same branch, integrated together.
**Implementation commit:** `5b6f577`
**Live browser/database certification closure commit (source branch):** `1297228` (corrective fixes) — see sections 6-11.
**Integrated into `r1-integration`:** 2026-07-30 — see the `integrate(r1): add S026 schedule engine and S027 aging` commit for the full integration record.
**Governed by:** `docs/accounting-modernization/S026_S027_IMPLEMENTATION_CONTRACT.md`
**Date:** 2026-07-30

This document is the S027 evidence record. It does **not** claim S028/S029
status, and does **not** claim final R1 or production-readiness
certification.

## Integration Record (r1-integration, 2026-07-30)

Integrated together with S026 (S027 depends directly on the S026 open-item
model). Auth-service's renumbered `1.20.0` catalog entry, the full
schedule-service migration chain, and the complete schedule-service test
suite (including S027's 13 tests: 11 unit + 2 live-database) are covered by
S026's Integration Record above. Same disclosure applies here: the S027
Playwright journey was **not re-executed** against a full isolated
integration-branch browser stack this pass (Docker outage, not a code
defect) — it passed 2/2 on the source branch's own isolated stack against
byte-identical code, and should be re-run against `r1-integration` once
Docker is available.

## 1. Accepted Scope

- Aging is built **exclusively** from S026's `ScheduleOpenItem.remainingBalance`
  (never re-derives from raw `ScheduleDetail` lines) — reconciles to S026
  totals by construction.
- Deterministic as-of-date calculation; age = `asOfDate − (dueDate ??
  transactionDate)` in days, matching `schedprn.cbl`'s documented
  Julian-date-diff approach.
- Accepted aging-bucket classification, **configurable per tenant**
  (`ScheduleAgingBucketConfig`) — not hard-coded. Default Current / 1-30 /
  31-60 / 61-90 / 90+, extending the legacy `CUR/OVR30/OVR60/OVR90`
  convention with the standard AR 1-30 split (no source documents legacy's
  exact boundaries).
- Correct handling of open, partially-applied (ages on remaining balance,
  not original amount), closed (excluded), future-due (negative age →
  Current), and overdue items.
- Tenant isolation via the RLS already covering `schedule_open_items`
  (S026) plus new RLS on `schedule_aging_bucket_configs`.
- Aging totals reconcile **exactly** to S026 open balances — proven by an
  explicit `reconciliation` block in every API response, computed from a
  second, independent DB aggregate query, not merely the same in-memory sum
  restated.
- API (`GET /api/v1/schedules/:id/aging-report`, cross-schedule sibling, and
  `GET`/`PUT /api/v1/schedules/aging-bucket-config`) and a user-facing Aging
  Report tab (bucket totals, item table, reconciliation badge, as-of-date
  and Control# filters) in the S026 operator UI.
- Empty (no aged items), loading, error, and discrepancy (reconciliation
  mismatch, rendered as a red banner rather than hidden) states.

## 2. Explicitly Excluded Scope

- S028/S029 — not started.
- Statement generation / dunning letters (S030 scope, R2).
- Any change to S019/S020, gl-service, or `r1-integration`.

## 3. Schema & Migrations

`services/schedule-service/prisma/migrations/`:
- `20260730020000_s027_aging_bucket_config` — `schedule_aging_bucket_configs`
  (per-tenant, `buckets` JSONB, `updated_at`/`updated_by`).
- `20260730020001_add_rls_policies_aging_config_schedule_svc` — RLS on that
  table.

`services/auth-service/prisma/migrations/20260730020000_extend_authz_catalog_s027_aging`
— catalog version `1.19.0`, `schedule.aging.view` (ADMIN/CONTROLLER/ACCOUNTANT),
`schedule.aging.config` (ADMIN/CONTROLLER only).

## 4. APIs

```
GET /api/v1/schedules/:id/aging-report        — bucketed report for one schedule
GET /api/v1/schedules/aging-report             — cross-schedule
GET /api/v1/schedules/aging-bucket-config      — tenant's buckets (or default)
PUT /api/v1/schedules/aging-bucket-config      — set tenant's buckets
```

Query filters: `asOfDate`, `controlNumber`, `glAccountNumber` (+ `scheduleNumber`
on the cross-schedule route). All require `x-tenant-id` (400) and JWT (401),
permission-gated per section 1.

## 5. Test Totals (as of the live browser certification closure, commit `1297228`)

- Focused (mocked) unit tests: 11 (`aging-service.test.ts`) — bucket-config
  fallback/validation, classification by age, partial-item aging on
  remaining balance, reconciliation match/mismatch (the mismatch case
  explicitly forces the two totals apart to prove the check is a real
  comparison, not a tautology), future-due (negative age), and filter
  pass-through.
- Live-database tests (real, fully isolated Postgres — see S026 evidence
  section 8 for the full Gate 1 topology, shared by both stories): 2
  (`live-db/aging-live.test.ts`) — a closed item is excluded and the
  report's `grandTotal` matches a fresh independent
  `scheduleOpenItem.aggregate()` query exactly; a real tenant-specific
  bucket-config override (persisted via `AgingService.setBucketConfig`
  against the live DB) changes an item's classification. Both use real
  S026 data created through the real posting-event path, not fixtures
  written directly into the aging tables.
- Combined schedule-service suite including S027: **87/87 passing** against
  the fully isolated Gate 1 Postgres instance.
- `tsc --noEmit` (schedule-service, `apps/web`, `auth-service`): clean.
- `apps/web` `vite build`: clean (production build succeeds).
- `apps/web` vitest: 41/41 passing (pre-existing suite, unaffected).
- `auth-service` vitest: 154/154 passing (unaffected — migration-only change).
- Fresh migration replay from empty (all 6 schedule-service migrations,
  S026+S027 combined): zero schema drift, reconfirmed in this closure pass
  both before and after the corrective code fix (schema-neutral).

## 6. Gate 2 — Isolated Live Browser Stack

Full topology (postgres/redis/rabbitmq/auth-service/gl-service/
schedule-service/api-gateway/web, compose project `s026s027cert2`, unique
ports, fixture seeding, secrets handling, and the `outbox_events`
environment accommodation) is documented once in
`S026_CERTIFICATION_EVIDENCE.md` section 9 — S027's Aging Report tab runs
in the same page (`ScheduleOpenItems.tsx`) against the same stack, so it is
not duplicated here.

## 7. Playwright — S027 Result

`tests/e2e/s027-schedule-aging.spec.ts`, executed against the Gate 2 stack
(`BASE_URL=http://localhost:61174`): **2/2 passing**, reproduced clean on
two consecutive runs after the corrective fixes in this closure (commit
`1297228`). Fixture data: `AGINGFIX01` (schedule `78`) seeded with one
partially-applied item (`S027FIXPRT`, 100.00 → 60.00 remaining) and one
fully-closed item (`S027FIXCLS`) via the same `OpenItemService
.processPostingEvent` production code path used for S026's fixture,
independent of the S026 spec's own fixture (dedicated schedule/control#)
so this spec does not depend on run order. Confirmed live through the real
API before the browser run: bucket totals, partial-item aging on remaining
balance (not original amount), closed-item exclusion, and the
reconciliation block (`{"agingTotal":"60.00","openItemTotal":"60.00",
"matches":true}`) — all matched the unit-test predictions exactly.

## 8. Defects Found and Corrected (this closure pass)

None specific to the aging report's own logic — the two production defects
found in this closure pass (audit `docId` consistency, a missing React
list `key`) were both in S026's open-item code/UI, not S027's aging code,
though the missing `key` prop was on the same `OpenItemsTab` component the
Aging Report tab's page shell also renders (see
`S026_CERTIFICATION_EVIDENCE.md` section 11 for full detail — both defects
and the Playwright/environment findings apply to this same page/session).
`AgingService`/`aging-report` API responses were correct on first live
verification.

## 9. UQ-18 Status

Unchanged from S026's evidence (section 12 there): `schedule_key =
(tenantId, scheduleNumber, controlNumber)` remains
`INTERIM_ACCEPTED_IMPLEMENTATION_ASSUMPTION`, not permanently closed.

## 10. Auth Catalog Version Collision (documented, not fixed here)

S027's own catalog version `1.19.0` (`20260730020000_extend_authz_catalog_s027_aging`)
does not itself collide with anything observed from this worktree. See
`S026_CERTIFICATION_EVIDENCE.md` section 13 for the full
`AUTH_CATALOG_VERSION_RENUMBERING_REQUIRED_DURING_SELECTIVE_INTEGRATION`
record (S026 `1.18.0` vs. a reported sibling-branch S038 `1.18.0`).

## 11. Known Limitations

- Aging currently exposes only day-count-based buckets; no dollar-weighted
  or percentage-of-total bucket view (not requested by the accepted story
  contract).

## 12. References

- `docs/accounting-modernization/S026_S027_IMPLEMENTATION_CONTRACT.md`
- `docs/accounting-modernization/S026_CERTIFICATION_EVIDENCE.md`
- `docs/cobol-extractions/schedprn.extraction.md`
- Canonical backlog: `S027` — `docs/accounting-modernization/AutoMate2_Accounting_Backlog_Package_v1.1.zip:out/canonical_registry.json`
