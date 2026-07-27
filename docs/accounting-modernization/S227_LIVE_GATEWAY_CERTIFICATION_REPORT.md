# S227 — Balance Sheet & Income Statement — Live-Gateway Certification Report

Status: **DONE_PENDING_INTEGRATION**
Package: GOLDEN-R0-FLEET (Lane B, after S014 and the S227 Financial Statement Roll-Up Contract)
Date: 2026-07-28 (Final-R0 shared stack)

## 1. Scope

Implements S227 strictly against `S227_FINANCIAL_STATEMENT_ROLLUP_CONTRACT.md`
(accepted by the Product Owner prior to this implementation). Covers:

- `GET /api/v1/gl/reports/balance-sheet`
- `GET /api/v1/gl/reports/balance-sheet/export` (CSV)
- `GET /api/v1/gl/reports/income-statement`
- `GET /api/v1/gl/reports/income-statement/export` (CSV)
- New frontend screens: `apps/web/src/pages/goldenpath/BalanceSheet.tsx`,
  `apps/web/src/pages/goldenpath/IncomeStatement.tsx`

## 2. Why the existing gl-service.ts prototype was NOT reused

Per explicit PO instruction, the pre-existing `getBalanceSheet()`/
`getIncomeStatement()` methods in `services/gl-service/src/application/
gl-service.ts` were confirmed by code inspection to:

- re-query the ledger independently, bypassing `TrialBalanceService`
  (duplicated calculation logic, a second source of truth for the same
  numbers);
- never call the shared `money()` rounding helper;
- report `balanced: <boolean>` in a `200` response instead of hard-erroring,
  meaning a caller could silently receive and render an unbalanced statement.

The new `FinancialStatementService` instead **wraps** the already-certified
`TrialBalanceService.getReport()` and derives every Balance Sheet/Income
Statement figure from its already normal-balance-aware
`debitBalance`/`creditBalance` rows — there is exactly one calculation of
each dollar figure in the whole system (S014's), and structural imbalance is
a hard `500`, never a silent boolean flag.

## 3. Roll-up formula (implemented verbatim from the accepted contract)

```
signedNatural(row)              = row.debitBalance - row.creditBalance
totalAssets                     = Σ signedNatural(ASSET rows)
totalLiabilities                = -Σ signedNatural(LIABILITY rows)
totalEquity(excl. earnings)     = -Σ signedNatural(EQUITY rows)
totalRevenue                    = -Σ signedNatural(REVENUE rows)
totalExpense                    =  Σ signedNatural(EXPENSE rows)
netIncome = currentEarnings     = totalRevenue - totalExpense
totalEquity                     = totalEquity(excl. earnings) + currentEarnings
totalLiabilitiesAndEquity       = totalLiabilities + totalEquity
```

This is a uniform formula — contra accounts (e.g. Accumulated Depreciation,
`type=ASSET`/`normalBalance=CREDIT`) require **zero special-casing**: their
sign falls out naturally because `debitBalance`/`creditBalance` are already
normal-balance-aware per S014.

`COST_OF_SALES` and `DISTRIBUTION` account types are explicitly excluded from
both statements (reported in `excludedAccounts` as a diagnostic, never
silently folded into Expense or dropped without a trace). Any account type
outside the five statement types + the two excluded types throws
`UnclassifiedAccountTypeError` → hard `500 UNCLASSIFIED_ACCOUNT_TYPE` — never
silently ignored.

## 4. Unit test evidence

- `services/gl-service/tests/s227-rollup-contract.proof.test.ts` (2 tests,
  committed earlier in `eeda969`): proves A=L+E and IS↔BS tie and
  reconciliation to S014's own dr/cr footing on a 6-account fixture
  including a contra-asset.
- `services/gl-service/tests/financial-statement.service.test.ts` (5 tests,
  this segment): full BS/IS rollup with a contra-asset; `COST_OF_SALES`
  exclusion with diagnostic reporting; `UNCLASSIFIED_ACCOUNT_TYPE` hard-error
  proof; empty-slice zeroed statements; `FSStructuralImbalanceError` field
  shape.
- **gl-service full suite: 100/100 passing** (95 baseline + 5 new), 0
  regressions, `tsc --noEmit` clean.
- **auth-service full suite: 154/154 passing** (unaffected by the new
  permission migration), `tsc --noEmit` clean.
- **apps/web: `tsc --noEmit` clean, `npm run build` succeeds.**

## 5. Migration evidence

New auth-service migration `20260728040000_extend_authz_catalog_
financial_statements` adds the `report.fs.view` permission (catalog version
`1.9.0`) and grants it to `ADMIN`/`CONTROLLER`/`ACCOUNTANT` only — mirrors
the `report.tb.view` precedent exactly. `CLERK` does **not** receive it (used
as the real unauthorized-denial test subject below).

- Deployed to the shared Final-R0 Postgres via `prisma migrate deploy`:
  **16/16 auth-service migrations applied cleanly.**
- **Fresh-database reproducibility independently re-verified this segment**:
  created a throwaway database (`s227_fresh_check`) on the same Postgres
  instance and ran `prisma migrate deploy` against it from zero —
  **16/16 applied cleanly**, then dropped.
- gl-service required no new migration (33/33 unchanged; the new service
  only reads existing `TrialBalanceService` data, no new tables).

## 6. Live-gateway evidence (Tenant A, real gateway, real PostgreSQL)

All calls against the real shared stack (`api-gateway:13100` → `gl-service:
13020`), Tenant A `1cf31f14-cb0b-4261-a41d-f79953594c86`, real JWTs, real
`x-tenant-id` header.

| # | Scenario | Result |
|---|---|---|
| 1 | Positive Balance Sheet, entity=01, asOf=2026-02 | `200`. `assets.total=500` (Cash), `liabilities.total=0`, `equity.total=500` (`currentEarnings=500`), `totalLiabilitiesAndEquity=500`. **A = L + E holds.** `reconciledToTrialBalance={drSum:500,crSum:500}`. |
| 2 | Positive Income Statement, same slice | `200`. `revenue.total=500`, `expense.total=0`, `netIncome=500`. **Ties exactly to the Balance Sheet's `currentEarnings`.** |
| 3 | CSV export, Balance Sheet | `200`, `Content-Type: text/csv`, correctly formatted rows. |
| 4 | CSV export, Income Statement | `200`, `Content-Type: text/csv`, correctly formatted rows. |
| 5 | Empty slice (`entity=99`) | `200`, all totals zero, `excludedAccounts=[]`, no error. |
| 6 | No token | `401`. |
| 7 | Invalid token | `401`. |
| 8 | Cross-tenant (real Tenant B admin JWT + Tenant A `x-tenant-id` header) | `403 {"error":"Tenant ID mismatch"}`. |
| 9 | Unauthorized (scratch `CLERK`-role user, created via direct `psql -c`, deleted immediately after capture incl. its `session` row) | `403 FORBIDDEN "Missing required permission: report.fs.view"`, `reason:"NO_MATCHING_ROLE"`. |
| 10 | `COST_OF_SALES` exclusion — live, not just unit-tested | See Section 7. |

### 6.1 Real S007 audit evidence (verified via `psql` against `audit_outbox`)

```
doc_id                          | action    | count
---------------------------------+-----------+------
/reports/balance-sheet           | VIEWED    | 3
/reports/balance-sheet/export    | EXPORTED  | 1
/reports/income-statement        | VIEWED    | 2
/reports/income-statement/export | EXPORTED  | 1
```

All rows are tenant-scoped, actor-attributed, and `published_at` is set.
Export uses **dedicated `/export` sub-routes** (not a `?format=` query flag)
specifically so `resolveAudit()`'s static per-route audit-action mapping can
emit a genuinely distinct `EXPORTED` event rather than reusing `VIEWED` for a
different real-world action.

## 7. COST_OF_SALES exclusion — live proof, not just unit-tested

To prove the exclusion path on real, unmassaged data (not just a mocked
fixture), a real `COST_OF_SALES`-type account (`9999 Suspense`) was created
via `POST /api/v1/gl/accounts`, followed by a real posted $50 journal entry
(DR Suspense / CR Cash) — `TrialBalanceService` filters out zero-balance
rows, so a posting was required for the account to appear in any report.

Results:

- `GET /reports/trial-balance` for the slice correctly includes
  `9999 COST_OF_SALES Suspense` (`endingBalance=50`).
- `GET /reports/income-statement` for the same slice correctly **excludes**
  it from Expense (`netIncome` unaffected, `9999` reported only in
  `excludedAccounts` with `reason:"OUT_OF_SCOPE_ACCOUNT_TYPE"`).
- `GET /reports/balance-sheet` for the same slice correctly returned a real
  **`500 STRUCTURAL_IMBALANCE`** (`totalAssets=450` vs
  `totalLiabilitiesAndEquity=500`, `delta=-50`).

This is expected and correct, not a defect: excluding the `COST_OF_SALES`
account's $50 debit from Assets while Cash still reflects its $50 credit
creates a genuine imbalance. It proves the "never a forced-balanced
statement" hard-error path fires for real on live data whenever a real
ledger uses `COST_OF_SALES` accounting — an **honest, documented limitation**
of the approved contract's scope (COGS was never in scope for this basic
BS/IS), not something papered over.

**Cleanup**: the evidence entry was then reversed via the real
`POST /journal-entries/:id/reverse` → `POST /post` workflow (the reversal
itself auto-posted via the documented 30-second `AgentReviewTimeoutJob`,
matching the previously-accepted `PO-DEC-001` auto-approve rule). Re-running
`GET /reports/balance-sheet` and `GET /reports/trial-balance` afterward
confirmed `entity=01` is restored to a genuinely balanced state
(`totalLiabilitiesAndEquity=500`, TB `drSum=crSum=500, delta=0`) for other
stories continuing to use the shared stack. This restoration was a real,
auditable double-entry reversal, not a data-cleanup `DELETE`.

## 8. Reconciliation to S014

Both statements' `reconciledToTrialBalance.{drSum,crSum}` are taken directly
from the same `TrialBalanceService.getReport()` call already proven correct
under S014 certification — this is a same-service, structural reconciliation
(not a fabricated cross-service one). Per ADR-JL-001 (already documented
under S222/S014), gl-service and coa-service remain separate ledgers, so no
cross-service reconciliation is claimed here.

## 9. Defects found and fixed

**None found in application logic.** The only gap discovered was a genuine
missing authorization-catalog entry (`report.fs.view` had no permission/grant
migration prior to this work) — a scope gap, not a code defect, closed via
the new migration in Section 5.

## 10. Frontend

- `apps/web/src/pages/goldenpath/BalanceSheet.tsx` and
  `IncomeStatement.tsx` consume `goldenPathApi.getBalanceSheet()` /
  `getIncomeStatement()` / `exportBalanceSheet()` / `exportIncomeStatement()`
  — every asset/liability/equity/revenue/expense/net-income figure rendered
  is exactly what the API returned; **no calculation is duplicated
  client-side.**
- States implemented: empty (no report run yet), loading (`busy`),
  positive render with a `BALANCED`/`NOT BALANCED` badge, `401`/`403`
  authorization error banner, `500 STRUCTURAL_IMBALANCE` full-width banner,
  `500 UNCLASSIFIED_ACCOUNT_TYPE` full-width banner, `excludedAccounts`
  diagnostic panel.
- Routes wired: `/golden-path/balance-sheet`, `/golden-path/income-statement`
  (same reachability model as S222's `/golden-path/trial-balance` — direct
  Controller reporting screens, not sequential Golden Path steps), with
  cross-links between Trial Balance / Balance Sheet / Income Statement.
- `apps/web` `tsc --noEmit` clean; `npm run build` succeeds (no new
  TypeScript or bundling errors).

## 11. Remaining blockers (why S227 is capped at DONE_PENDING_INTEGRATION)

- Package-wide Figma/SME/UX validation remains open (`FIGMA_REQUIRED`),
  per PO condition 9 — no UI in this package has been built without a
  Figma artifact.
- No browser/Playwright automation infrastructure exists in this repository
  yet; browser Golden Path validation for S227 remains outstanding.
- `COST_OF_SALES`/`DISTRIBUTION` remain explicitly out of scope for this
  basic BS/IS; a real ledger using COGS accounting will legitimately hit
  `STRUCTURAL_IMBALANCE` until a scoped v2 (or equivalent contract
  amendment) brings COGS into the statement.
- gl-service/coa-service remain separate ledgers (ADR-JL-001); S227's
  reconciliation to S014 is same-service only.

## 12. Working-tree status

All backend files (service, routes, security, DI registration, unit tests,
auth-service migration) were committed separately in this segment. Frontend
files and this report/tracking-doc updates are committed in the phases that
follow this report.
