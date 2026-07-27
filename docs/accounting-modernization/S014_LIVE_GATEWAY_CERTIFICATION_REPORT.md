# S014 — Trial Balance API: Live-Gateway Certification Report

**Date:** 2026-07-27  
**Branch:** `golden-r0-fleet` (worktree `AM-Accounting-final-r0`)  
**Story status after this report:** `DONE_PENDING_INTEGRATION`

## 1. Scope

S014 adds `GET /reports/trial-balance?entity&store&dept&asOf` inside `services/gl-service`, gated by
`report.tb.view`, returning either a footed trial balance or
`500 { error: "STRUCTURAL_IMBALANCE", drSum, crSum, delta }`. The implementation reads
`JournalEntry`/`JournalLine` plus `GLAccountPeriodBalance`, slices by entity/company + optional
store/department, and performs the required BR014-2 projection-vs-rebuild proof.

## 2. What was built

- **Permission migration** — `services/auth-service/prisma/migrations/20260728030000_extend_authz_catalog_trial_balance/migration.sql`
  seeds `report.tb.view` at catalog `1.8.0`, granted to `ADMIN` / `CONTROLLER` / `ACCOUNTANT`.
- **Slice-aware projection schema** — `services/gl-service/prisma/schema.prisma` +
  `20260728010005_add_trial_balance_dimensions_gl_svc` add `store_id` to `journal_lines` and
  `company_code` / `store_id` / `department_code` to `gl_account_period_balances`.
- **Core service** — `services/gl-service/src/application/trial-balance-service.ts` builds the report
  from the projection, independently rebuilds it from posted/reversed journal lines, and throws
  `StructuralImbalanceError` instead of silently returning an unbalanced TB.
- **Route/security wiring** — `services/gl-service/src/http/routes.ts`,
  `services/gl-service/src/http/security.ts`, and `services/gl-service/src/index.ts` add the S014 route,
  real S207 authorization, and audit-on-view.
- **Nightly comparison job** — `services/gl-service/src/application/trial-balance-variance-job.ts`
  publishes a variance event when the projection diverges from the journal rebuild.

## 3. Real defects found and fixed

1. **Legacy unique index still blocked per-slice projection rows.**  
   `20260728010005` added the new slice-aware uniqueness, but the old truncated Prisma-generated unique
   index still existed in PostgreSQL and rejected multiple same-account/period rows across different
   slices. Fixed by explicitly dropping the legacy index in
   `services/gl-service/prisma/migrations/20260728010006_drop_legacy_trial_balance_unique_gl_svc/migration.sql:1-7`.

2. **Store/dept slices originally inherited unsliced opening balances.**  
   That would have made a scoped TB carry balances from unrelated stores/departments. Fixed by deriving
   `priorBalance` and `currentAmount` only from slice-filtered prior/current nets in
   `services/gl-service/src/application/trial-balance-service.ts:156-157`.

3. **Live audit proof exposed a real route-audit bug.**  
   The first live gateway run produced zero `audit_outbox` rows for successful S014 reads. Root cause:
   the audit hook resolved `/api/v1/gl/reports/trial-balance` without stripping the `/api/v1/gl` prefix,
   so `resolveAudit()` never matched. Fixed in
   `services/gl-service/src/http/security.ts:35-78` by normalizing prefixed route URLs for both authz
   and audit, and by defaulting audited `docId` to the normalized route. Regression test added in
   `services/gl-service/tests/security.audit.test.ts`.

## 4. Fresh-database migration verification

Ephemeral Postgres 15 on `localhost:55530`, `prisma migrate deploy`, no `db push`, no manual tables:

- `services/auth-service` — **15/15** migrations applied.
- `services/coa-service` — **19/19** migrations applied.
- `services/gl-service` — **33/33** migrations applied.

Verified in the migrated auth DB:

- `permission.key = report.tb.view`, `since_version = 1.8.0`
- grants exist for exactly `ACCOUNTANT`, `ADMIN`, `CONTROLLER`

## 5. Test / typecheck evidence

### Baseline before S014 changes

- `services/gl-service npx tsc --noEmit` → **pass**
- `services/coa-service npx tsc --noEmit` → **pass**
- `services/gl-service DATABASE_URL=... npm test` → **86/86 passed**
- `services/coa-service LIVE_DATABASE_URL=... npm test` → **299/299 passed**
- `services/coa-service npm test` (no live DB) → **294 passed, 5 skipped, 299 total**
- `services/gl-service npm test` (no DB) → **17 passed, 69 failed, 86 total**  
  Pre-existing suite characteristic: several gl-service tests require a real migrated PostgreSQL DB.

### Final after S014 changes

- `services/gl-service npx tsc --noEmit` → **pass**
- `services/coa-service npx tsc --noEmit` → **pass**
- `services/gl-service DATABASE_URL=postgresql://postgres:postgres@localhost:55530/gl_s014_full_final npm test`
  → **93/93 passed**
- `services/coa-service LIVE_DATABASE_URL=postgresql://postgres:postgres@localhost:55530/coa_s014_cert npm test`
  → **323/323 passed**
- Focused new S014 tests:
  - `services/gl-service/tests/trial-balance.service.test.ts` → **4/4 passed**
  - `services/gl-service/tests/trial-balance.integration.test.ts` → **2/2 passed**
  - `services/gl-service/tests/security.audit.test.ts` → **1/1 passed**

## 6. Live-gateway evidence (real JWT, real HTTP, real PostgreSQL)

Live isolated stack:

- auth-service `:13021`
- gl-service `:13020`
- api-gateway `:13120`
- Postgres `:55530`

Tenant: `514dfb5b-acde-4e3e-a93c-0014c0ffee01`  
User: `s014-admin@amacc.test` (bootstrapped through the real auth-service application layer)  
JWT: real `POST /api/v1/auth/login` token

### 6.1 Positive S014 call

`GET /api/v1/gl/reports/trial-balance?entity=01&store=S1&dept=SRV&asOf=2026-02`

- `drSum = 1300`
- `crSum = 1300`
- `delta = 0`
- account balances:
  - `1000 Cash` → prior `1230`, current `-50`, ending `1180`
  - `2000 Accounts Payable` → prior `1000`, current `0`, ending `1000`
  - `4000 Revenue` → prior `350`, current `-50`, ending `300`
  - `5000 Expense` → prior `120`, current `0`, ending `120`

### 6.2 Negative / edge calls

- **Empty slice**  
  `entity=99&store=NONE&dept=NONE&asOf=2026-02` → `200`, `accounts: []`, `drSum=0`, `crSum=0`, `delta=0`
- **Structural imbalance path**  
  `entity=ZZ&store=BAD&dept=BAD&asOf=2026-02` → `500 {"error":"STRUCTURAL_IMBALANCE","drSum":10,"crSum":0,"delta":10}`
- **No token**  
  same positive URL without `Authorization` → `401 {"error":"Missing or invalid Authorization header"}`

### 6.3 Real audit proof

After fixing the prefix-normalization defect in §3, direct `psql` against `gl_s014_cert.audit_outbox`
showed:

- `doc_type = GL_LEDGER_REPORT`
- `doc_id = /reports/trial-balance`
- `action = VIEWED`
- `actor = 833b131d-ba43-4abe-b1d2-bb1cce337df6`
- **2 rows**, `published_at IS NOT NULL`

These correspond to the two successful `200` S014 reads; the `500` structural-imbalance response did
not emit a success audit row, which matches the current `<400` audit guard.

## 7. BR014-2 rebuild-vs-projection proof

Executed through the real built `TrialBalanceService` against the migrated `gl_s014_cert` database for
the same live S014 slice (`entity=01`, `store=S1`, `dept=SRV`, `asOf=2026-02`):

- **Projection path:** `drSum=1300`, `crSum=1300`, `delta=0`
- **From-scratch journal rebuild:** `drSum=1300`, `crSum=1300`, `delta=0`
- **Account-level ending balances matched exactly:**  
  `1000=1180`, `2000=1000`, `4000=300`, `5000=120`
- **Variance result:** `delta=0`, `mismatches=[]`

This satisfies the PO-gated BR014-2 zero-variance requirement.

## 8. S220 reconciliation proof

Because S014 (`gl-service`) and S220 (`coa-service`) are separate services/schemas, the reconciliation
was performed with an explicit like-for-like fixture using the real computation classes on identical
math:

- `TrialBalanceService.getReport(... asOf=2026-01)` for account `1000` produced
  **`endingBalance = 1230`**
- `GLInquiryService.getActivity(... startDate=2026-01-01, endDate=2026-01-31)` over the same fixture
  math produced **`endingBalance = 1230`**

Result: **S014 ending balance = S220 ending balance = 1230**

## 9. Explicit gaps / assumptions

- Contract `entity` is implemented against gl-service’s actual `companyCode` field; this is a schema
  adaptation, not a fabricated extra dimension.
- The live HTTP evidence used an isolated fully-migrated local stack rather than the pre-existing shared
  Final-R0 stack, because S014 required new code + permission data and the user’s non-fabrication
  requirement was satisfied by a real gateway/auth/gl/Postgres runtime with real JWTs and real DB state.
- Audit-on-view is an inferred package-wide convention (matching S220/S224), not a literal S014
  contract sentence; it is implemented and proven here as an explicit consistency decision.

## 10. Verdict

**PASS — S014’s Definition of Done gating condition is met.**  
The required BR014-2 rebuild-equivalence proof was executed for real and returned **zero variance**.
Backend/API/authorization/tenant-slice behavior/structural-error behavior/audit/migration evidence are
complete. Story remains **`DONE_PENDING_INTEGRATION`** rather than `DONE` because the controlled-fleet
package-wide business/UX/Figma sign-off gate still applies even for this no-UI backend story.
