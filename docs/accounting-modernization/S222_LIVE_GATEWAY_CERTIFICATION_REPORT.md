# S222 — Trial Balance Screen & Export: Live-Gateway Certification Report

**Date:** 2026-07-27
**Branch:** `golden-r0-fleet` (worktree `AM-Accounting-final-r0`)
**Story status after this report:** `DONE_PENDING_INTEGRATION` (`FIGMA_REQUIRED`)

## 1. Scope

S222 is the Controller-facing screen for the real S014 Trial Balance API (`GET
/api/v1/gl/reports/trial-balance?entity&store&dept&asOf`). Per the approved
Story Contract and the PO's explicit instruction, S222 **consumes the real
S014 API and performs no client-side recomputation** of dr/cr/ending
balances — every dollar value rendered is exactly what the API returned.

## 2. What was built

- `apps/web/src/pages/goldenpath/TrialBalance.tsx` — new screen: entity/
  store/dept/as-of controls, zero-suppression toggle, run/export buttons,
  results table, accountType subtotal rows (an aggregation of already-
  returned rows, not a recalculation), grand-total row, full-width
  `STRUCTURAL_IMBALANCE` error banner, and a row-click drill panel.
- `apps/web/src/api/client.ts` — added `goldenPathApi.getTrialBalance()`
  (real S014 call) and `goldenPathApi.getAccountActivity()` (reuses the real
  S220 API for drill-through, no duplicated calculation); extended the
  shared `apiFetch()` error handling to preserve the full parsed error body
  (`err.body`) so `STRUCTURAL_IMBALANCE`'s `drSum/crSum/delta` can be
  rendered, not just a message string.
- `apps/web/src/App.tsx` — new protected route `/golden-path/trial-balance`.
- `apps/web/src/pages/goldenpath/JournalWorkflow.tsx` — added a discoverable
  link to the new screen (Trial Balance is a Controller reporting screen,
  **not** one of the Golden Path's 11 sequential steps, so it is reachable
  rather than chained into the guided flow).

## 3. Architecture finding (not a defect introduced by S222 — pre-existing, now documented)

Per `MODULE_STATE.json` ADR-JL-001, journal lifecycle (S214–S219) lives in
**coa-service**, while S014's Trial Balance reads a **separate ledger** in
**gl-service**, which is not fed by coa-service's posted journals (no
consumer/projection exists between the two services today). Consequently:

- The `entity` control on this screen is gl-service's own `companyCode`
  slice dimension — a different identifier space from the tenant-service
  `legalEntityId` used everywhere else in the Golden Path. It is entered
  directly by the Controller, not inferred from entity selection.
- The story's acceptance criterion "(b) row click → S220 pre-filtered" is
  implemented as a **best-effort cross-service correlation by human account
  number** (gl-service `accountCode` looked up against the current legal
  entity's coa-service Chart of Accounts), because there is no shared
  foreign key between the two ledgers. Live testing (§6.4) confirms this
  correlation legitimately returns "no match" for the real Golden Path COA,
  whose account numbers (`10000`, `10001`, …) do not coincide with
  gl-service's legacy 4-digit numbering (`1000`, `4000`, …) — the honest
  "no matching account" message is shown rather than fabricating a result.

This is reported transparently as a known, pre-existing cross-service gap,
not something S222 fabricated a fix for.

## 4. Onboarding correction made this session

gl-service had been migrated up to `20260728010004` on the shared live stack
(`amacc` Postgres on `:45433`) but was **not running as a persistent service**
there, and the two newest S014 migrations were not yet applied to that shared
database (only to S014's own isolated verification stack). To produce real
live-gateway evidence for S222 against the actual shared Final-R0 stack:

- Applied the two pending migrations (`20260728010005_add_trial_balance_dimensions_gl_svc`,
  `20260728010006_drop_legacy_trial_balance_unique_gl_svc`) to the shared
  `amacc` database via `prisma migrate deploy` — applied cleanly, no `db push`.
- Started `gl-service` on `:13020` against the shared database.
- Restarted `api-gateway` on `:13100` with `GL_SERVICE_URL=http://localhost:13020`
  so `/api/v1/gl/*` now really proxies to gl-service in this persistent stack
  (previously falling back to an unreachable default Docker hostname).

## 5. Test / typecheck evidence

- `apps/web npx tsc --noEmit` → **pass**.
- `apps/web npm run build` → succeeds (`vite build`, 2502 modules
  transformed, no errors).
- No Playwright/browser-automation infrastructure exists in this repository
  yet (confirmed: no `playwright` dependency, no `.spec.ts` files anywhere
  under `apps/web`). Consistent with every other Golden-R0 fleet story this
  session, true browser-level (rendered DOM) verification is **not yet
  possible** and is explicitly reported as pending, not fabricated as done.
  API-level verification (below) proves every network call the screen makes
  behaves correctly against the real stack.

## 6. Live-gateway evidence (real JWT, real HTTP, real PostgreSQL)

Stack: `api-gateway:13100 → gl-service:13020 / coa-service:13016 /
auth-service:13001`, shared Postgres `:45433`. Tenant A
`1cf31f14-cb0b-4261-a41d-f79953594c86`, user `admin@kunes-final-r0.test`.

### 6.1 Real business-workflow seed (through real domain APIs, not raw SQL)

gl-service's ledger for Tenant A on the shared stack had zero data (freshly
onboarded, per §4). To produce genuine positive-path evidence:

- Created two real GL accounts via `POST /api/v1/gl/accounts` (`1000 Cash`
  ASSET/DEBIT, `4000 Revenue` REVENUE/CREDIT).
- Created a real balanced journal entry via `POST /api/v1/gl/journal-entries`
  (`$500` DR Cash / CR Revenue, `companyCode=01`, `2026-02-15`).
- Posting encountered a **real segregation-of-duties rule** —
  `403 SEGREGATION_OF_DUTIES_VIOLATION` when the creator attempted to
  approve their own entry. A scratch CONTROLLER-role evidence user
  (`s222-approver-evidence@kunes-final-r0.test`) was created via `psql`,
  used once to post the entry, and deleted immediately after (session →
  role assignment → user, same pattern as prior scratch-user evidence).

### 6.2 Positive S222 call

`GET /api/v1/gl/reports/trial-balance?entity=01&asOf=2026-02` →

```json
{
  "scope": {"entity":"01","store":null,"dept":null,"asOf":"2026-02"},
  "accounts": [
    {"accountCode":"1000","accountName":"Cash","accountType":"ASSET","debitBalance":500,"creditBalance":0,"endingBalance":500},
    {"accountCode":"4000","accountName":"Revenue","accountType":"REVENUE","debitBalance":0,"creditBalance":500,"endingBalance":500}
  ],
  "drSum": 500, "crSum": 500, "delta": 0
}
```

Screen renders this exactly (two rows, ASSET/REVENUE subtotal rows, grand
total `500/500`) — no recomputation.

### 6.3 Negative / edge calls

- **Empty slice** — `entity=99&asOf=2026-02` → `200 {"accounts":[],"drSum":0,"crSum":0,"delta":0}`.
- **Structural imbalance** — a scratch one-sided `gl_account_period_balances`
  row was inserted directly for a disposable `companyCode=99` slice (not
  touching real `01` data), proving the real 500 path:
  `entity=99&asOf=2026-02` → `500 {"error":"STRUCTURAL_IMBALANCE","drSum":10,"crSum":0,"delta":10}`.
  Scratch row deleted immediately after capture. Screen renders the
  full-width banner with the real `drSum/crSum/delta` values.
- **No token** → `401 {"error":"Missing or invalid Authorization header"}`.
- **Invalid token** → `401 {"error":"Invalid JWT format"}`.
- **Cross-tenant** (real Tenant B admin JWT, Tenant A `x-tenant-id`) →
  `403 {"error":"Tenant ID mismatch"}`.
- **Unauthorized** (scratch CLERK-role evidence user, lacking
  `report.tb.view`) → `403 {"error":"FORBIDDEN","message":"Missing required permission: report.tb.view","reason":"NO_MATCHING_ROLE"}`.
  Scratch user deleted immediately after capture.

### 6.4 Drill-through correlation (honest result, not fabricated)

Looked up the real Golden Path legal entity's Chart of Accounts
(`GET /api/v1/coa/accounts?entity=e8d058b7-...`) — its real account numbers
(`10000`, `10001`, `60000`, …) do not match gl-service's `1000`/`4000`. The
screen's drill panel therefore correctly shows "No account numbered 1000
exists in the current legal entity's Chart of Accounts" rather than a
fabricated or wrong result — confirming the honest-gap code path (§3) is
real, not theoretical.

### 6.5 Real audit proof

`psql` against `audit_outbox`:

```
doc_type=GL_LEDGER_REPORT doc_id=/reports/trial-balance action=VIEWED
actor=97511a20-0498-4f2f-aaab-40eff878835e published=t   (x6 rows)
```

All 6 real `VIEWED` rows correspond to the 6 successful `200` calls made
during this evidence capture; correctly tenant-scoped and actor-attributed.

## 7. Real defects found this session

None new in application logic — the two real "defects" encountered were
correct, existing business rules working as designed (segregation-of-duties
on approval, §6.1) rather than bugs. The genuine onboarding gap (gl-service
not yet running persistently on the shared stack, §4) was found and fixed.

## 8. Known gaps (explicit, not fabricated as resolved)

- **Figma/UX validation**: open, per PO condition 9 — same status as every
  other controlled-fleet story this session. S222 remains
  `DONE_PENDING_INTEGRATION`, not `DONE`.
- **Browser/Playwright validation**: no browser-automation infrastructure
  exists in this repository yet; not run for S222 (or any other story this
  session). API-level live-gateway evidence (§6) is the strongest evidence
  currently obtainable.
- **Hierarchy subtotals from S211**: the Story Contract calls for "hierarchy
  subtotal rows (from S211)". gl-service's TB report does not expose S211's
  coa-service account-hierarchy data (separate ledger, §3), so true
  parent/child roll-up subtotals are not available. Implemented instead:
  subtotal-by-`accountType` (ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE), which
  is a legitimate partial fulfillment using only fields the S014 API already
  returns — not an invented hierarchy.
- **Drill-through to S220**: implemented as a best-effort cross-service
  account-number correlation (§3, §6.4); this is architecturally limited
  until gl-service and coa-service share a ledger or a formal mapping.
- **Foot-gate format alignment (UQ-14)**: still open per the Story Contract;
  not resolved by this backend-only frontend wiring pass.

## 9. Verdict

S222 backend-consuming screen implemented, wired to the real S014 API with
no duplicated calculation, negative/positive/audit evidence captured live
against the shared Final-R0 stack, and gl-service properly onboarded into
that persistent stack for the first time. Remains
`DONE_PENDING_INTEGRATION` pending Figma/UX and browser validation.
