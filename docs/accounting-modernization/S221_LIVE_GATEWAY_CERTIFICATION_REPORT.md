# S221 GL Search — Live Gateway Certification Report

**Story**: S221 GL Search
**Package**: GOLDEN-R0-FLEET (Lane A, after S220)
**Date**: 2026-07-27
**Status**: `DONE_PENDING_INTEGRATION` (backend/authorization/audit/migration/live-gateway evidence complete; capped per PO condition 9 pending Figma/UX/business validation — S221 is `FIGMA_REQUIRED`, same class as S220)

## 1. Scope and Story Contract

Per the approved `GOLDEN_R0_STORY_CONTRACT_MATRIX.md` (lines 205-238), S221 is a
cross-account ledger search: criteria = amount/amountRange, date range, source
code, memo (contains), poster, and document reference; permission
`inquiry.search`; results reuse "the S220 column set + accountNumber"; saved
searches (`{name, criteria}`) must be persistable and re-runnable (BR221-2);
results must respect the same scoping/masking as S220 (BR221-1); no CSV export
is defined in the approved contract (not implemented — documented scope
decision, see §4); the 1M-line ≤2s performance target is a `PROPOSED_TARGET`,
not re-verified here (no load-test infrastructure exists in this repo; not
fabricated as measured).

Per the PO's Lane A kickoff message (S220/S221 concurrent lanes), an optional
debit/credit `direction` filter was additionally required — this is not listed
in the Story Contract's criteria field but is implemented per the PO's
explicit instruction, documented as an interpretation beyond the literal
contract text (see §4).

## 2. Design decisions (documented, not fabricated)

1. **Frozen result contract**: `GLSearchResultRow` = S220's `ActivityLineView`
   shape (`journalEntryId, journalNumber, entryDate, source, store, dept,
   controlNumber, applyNumber, memo, dr, cr`) plus `accountId`/`accountNumber`
   (search spans multiple accounts, so identifying which account each row
   belongs to is required), minus `runningBalance` (not well-defined across a
   cross-account result set — a documented omission, not an oversight).
2. **`docRef` mapping**: no `docRef` column exists on `JournalLine`/
   `JournalEntry`. The closest existing fields (already part of S220's frozen
   contract) are `controlNumber` and `applyNumber`; a `docRef` search matches
   either — a documented interpretation.
3. **Fail-closed on a fully-empty search**: the approved contract's negative
   criterion (c) says "over-broad search paginates, never silently times
   out" — but a *fully unfiltered* search (zero criteria at all) is a
   materially different, worse failure mode (an unbounded full-ledger scan
   with no selective predicate whatsoever, against a ledger the contract's own
   performance section sizes at potentially 1M+ lines). `SearchCriteriaRequiredError`
   (400) is thrown when zero criteria are supplied — a conservative,
   documented interpretation consistent with this fleet's existing
   fail-closed convention (e.g. S220's `RangeRequiredError`), not a literal
   contract requirement.
4. **Audit-on-search**: the approved S221 contract states "None specific
   beyond package-wide convention" for events. Following the S220/S224
   precedent (unconditional audit-on-view for read/inquiry stories), every
   `search()` execution (including one invoked via `runSavedSearch()`) emits
   exactly one `audit.viewed`/`SEARCHED` event, transactionally coupled to the
   coa-service outbox write per BR7-1. Saved-search CRUD (save/list/delete) is
   **not** separately audited — those actions manage a search *definition*,
   not ledger-data exposure; ledger-data exposure is always captured via the
   `search()` call itself regardless of how it was invoked.
5. **No CSV export**: the approved Story Contract does not define an export
   action for S221 (field 12 does not mention an export button; field 13 says
   "None events produced/consumed"). Not implemented — a documented scope
   decision, distinct from the PO's earlier two-lane message which mentioned
   "export where defined in the Story Contract" (conditional language; the
   condition is not met here).
6. **Saved-search ownership**: `SavedGlSearch` rows are scoped to
   `(tenantId, createdBy)` — a saved search is visible only to the user who
   created it, not to every user in the tenant. A documented privacy-by-default
   design choice; the contract does not specify sharing semantics.
7. **AND-combination bug found and fixed before any live call**: an early
   draft of `buildWhere()` combined every criterion's `OR` clause under one
   shared top-level `OR` key; because JS object-spread lets a later key
   silently overwrite an earlier one, supplying more than one criterion at
   once (e.g. `sourceCode` + `amount` + `docRef` together) would have silently
   dropped all but the last-spread criterion — a real defect caught by
   code-review-before-execution, not live. Fixed by combining each criterion's
   own `OR` clause into an `AND` array instead, so multiple criteria are always
   combined with AND semantics and no clause is ever dropped. A dedicated
   regression test (`"combines multiple criteria with AND semantics (not
   silently dropping any of them)"`) proves this.

## 3. Implementation

- `services/coa-service/src/application/gl-search-service.ts` — `GLSearchService`:
  `search()`, `saveSearch()`, `listSavedSearches()`, `deleteSavedSearch()`,
  `runSavedSearch()`.
- `services/coa-service/src/http/gl-search-routes.ts` — `GET /inquiry/search`,
  `POST /inquiry/searches`, `GET /inquiry/searches`,
  `GET /inquiry/searches/:id/run`, `DELETE /inquiry/searches/:id`, all gated
  by `requireSearchPermission('inquiry.search')`, mounted under the
  already-gateway-routed `/api/v1/coa` prefix (no new gateway route needed).
- New Prisma model `SavedGlSearch` (table `saved_gl_search`), migrations:
  - `services/coa-service/prisma/migrations/20260728000002_add_saved_gl_search/`
  - `services/coa-service/prisma/migrations/20260728000003_add_rls_saved_gl_search/`
    (standard 4-policy tenant-isolation pattern, `FORCE ROW LEVEL SECURITY`).
- New auth-service permission migration:
  `services/auth-service/prisma/migrations/20260728020000_extend_authz_catalog_gl_search/`
  — seeds catalog v1.7.0, permission `inquiry.search`, granted to
  ADMIN/CONTROLLER/ACCOUNTANT (same set as `inquiry.account.view`; CLERK
  excluded for the same documented reason as S220).
- DI/route registration added in `services/coa-service/src/index.ts`.

## 4. Fresh-database migration reproducibility

Ephemeral Postgres 15 (Docker, port 55531, since torn down):

```
npx prisma migrate deploy   # coa-service: 19/19 migrations applied cleanly, including
                             # 20260728000002_add_saved_gl_search and
                             # 20260728000003_add_rls_saved_gl_search
```

Verified via `psql`: `saved_gl_search.relrowsecurity = t`,
`relforcerowsecurity = t`, and all 4 tenant-isolation policies
(SELECT/INSERT/UPDATE/DELETE) present.

## 5. Test evidence (exact, no rounding)

Full coa-service suite run against the same fresh ephemeral database (so the
previously-corrected live-DB suite is executed for real, not left
`describe.skipIf`-gated — per this fleet's established convention):

```
Test Files  20 passed (20)
     Tests  323 passed (323)
```

Breakdown of the delta from S220's certified 299/299 baseline:
- **+20** new tests in `tests/gl-search.test.ts` (fail-closed validation ×3,
  amount exact/direction/range, date range, sourceCode, postedBy,
  memoContains dual-field, docRef dual-field, AND-combination regression,
  cross-tenant isolation, frozen-shape assertion, pagination determinism,
  audit-event assertion, saved-search save/list/run/delete round-trip,
  duplicate-name rejection, not-found/cross-tenant saved-search rejection,
  re-run page/pageSize override).
- **+4** new cases in `tests/authz-guard-integration.test.ts` (S221 —
  `inquiry.search`: 401 no token, 403 no permission, 200 allowed,
  cross-tenant denial) — same generic guard-mechanism table used by every
  other coa-service route file.
- All 299 previously-certified tests still pass unchanged (0 regressions).
- 0 skipped.

`tsc --noEmit`: clean.

## 6. Live-gateway evidence (2026-07-27, real Final-R0 stack)

Stack: `api-gateway:13100` → `auth-service:13001` / `coa-service:13016`
(restarted to pick up the new routes/migrations) against the shared Postgres
on `45433`. Tenant A `1cf31f14-cb0b-4261-a41d-f79953594c86` (real ADJ-source
journal data, 18 lines across 9 entries dated 2026-01-15..20, "Golden Path"
memo text).

| # | Scenario | Result |
|---|---|---|
| 1 | Positive: `sourceCode=ADJ`, paginated | 200, real 18 total results across 6 pages, real journalNumbers/accountNumbers/amounts |
| 2 | Positive: `memoContains=Golden` | 200, real matching rows |
| 3 | Positive: `amount=50&direction=DEBIT` | 200, 8 total results, all `dr=50, cr=0` (direction filter proven to actually restrict the side) |
| 4 | Positive: `startDate=2026-01-15&endDate=2026-01-20` | 200, 10 total results |
| 5 | Validation failure: no criteria at all | 400 `SEARCH_CRITERIA_REQUIRED` |
| 6 | Validation failure: inverted date range | 400 `INVALID_RANGE` |
| 7 | Unauthorized: no token | 401 |
| 8 | Unauthorized: invalid token | 401 `Invalid JWT signature` |
| 9 | Unauthorized: scratch CLERK-role user (created, tested, deleted) | 403 `Missing required permission: inquiry.search` |
| 10 | Cross-tenant: Tenant B ADMIN token against `x-tenant-id: <Tenant A>` | 403 `Tenant ID mismatch` |
| 11 | Cross-tenant: Tenant B ADMIN searching its own tenant for ADJ | 200, 0 results (no cross-tenant leak) |
| 12 | Saved search: create | 201, real row |
| 13 | Saved search: list | 200, contains the created row |
| 14 | Saved search: re-run with `pageSize` override | 200, persisted criteria preserved, override applied |
| 15 | Saved search: delete | 204 |
| 16 | Saved search: list after delete | 200, empty |
| 17 | Saved search: duplicate name | 409 `DUPLICATE_SEARCH_NAME` |

Real S007 audit evidence confirmed via `psql` against `audit_outbox`:

```
doc_type='GL_SEARCH' AND action='SEARCHED'  →  7 rows
  6 rows tenant_id = Tenant A (this evidence run's searches)
  1 row  tenant_id = Tenant B (the cross-tenant own-tenant search, scenario 11)
all published_at IS NOT NULL (outbox drainer confirmed still functioning)
actor correctly attributed to the real calling user's id (no synthetic identity)
```

Scratch evidence user (`s221-noperm-evidence@kunes-final-r0.test`, CLERK role,
Tenant A) was deleted (session, role assignment, user row) immediately after
capturing scenario 9.

## 7. Reconciliation to S220

S221's positive scenarios (1-4) were run against the same real Tenant A
ledger data (`ADJ` source, "Golden Path" memo, account `10001` among others)
already certified live under S220 — the individual line amounts, account
numbers, and journal numbers returned by S221's cross-account search visibly
match what S220's single-account inquiry independently reports for account
`10001`/`60592`/`60335`/etc. on the same dates (e.g. the `ADJ-2026-01-000010`
entry's `10001`/`60592` line pair appears identically in both S220's per-account
activity view and S221's search results). No numeric discrepancy found.

## 8. Verdict

`S221_LIVE_GATEWAY_CERTIFICATION_PASSED` at the technical/backend level.
Story status set to `DONE_PENDING_INTEGRATION` (not `DONE`) per PO condition 9
— S221 is `FIGMA_REQUIRED` and package-wide Figma/SME/UX validation remains
open, same class of gap as S220/S224/S202/S004A.
