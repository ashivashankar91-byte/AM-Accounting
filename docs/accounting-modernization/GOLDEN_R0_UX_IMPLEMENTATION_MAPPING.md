# Golden R0 — UX Implementation-Mapping Pass (S220, S221, S014/S222, S227)

**Date:** 2026-07-28
**Scope:** S220 (GL Inquiry), S221 (GL Search), S014/S222 (Trial Balance), S227
(Balance Sheet), S227 (Income Statement).
**Method:** Repository-evidence-only. Five independent deep-dive passes (one
per screen) each verified frontend routing, gateway routing, backend
endpoints, request/response contracts, permissions, audit events, error
contracts, tenant/entity scoping, filters, drill-down, and test evidence
directly against **current committed code** — not against prior certification
docs, which were treated as claims to re-verify, not ground truth.
**Explicitly out of scope:** no redesign, no frontend implementation, no
story-status changes, no application-code changes. Where evidence
contradicted an existing doc, the contradiction is called out below rather
than silently resolved.

This document does not authorize promotion of any story to `DONE`. It is
engineering evidence supporting the (still-pending) Figma/UX/SME sign-off
gate described in `GOLDEN_R0_UX_SELF_REVIEW.md` and
`KNOWN_LIMITATIONS_REGISTER.md` (rows 6–7).

---

## 1. Screen-by-screen mapping tables

### 1.1 S220 — GL Inquiry

| # | Item | Evidence |
|---|---|---|
| 1 | Frontend route | `/accounting/inquiry/gl` → `GLInquiry` (`apps/web/src/App.tsx:602`, import line 84). **No** standalone `/golden-path/gl-inquiry` route exists. |
| 2 | Frontend component | `apps/web/src/pages/accounting/GLInquiry.tsx` (1482 lines) is routed but calls the **legacy** `glApi.getGLInquiry` → `GET /api/v1/gl/inquiry` (gl-service), not the real S220 backend. The real S220 backend is consumed only inside the Trial Balance drill-through panel (`apps/web/src/pages/goldenpath/TrialBalance.tsx:129`), not by a dedicated inquiry screen. |
| 3 | Gateway route | `/api/v1/coa` → `coa-service:3016`, no rewrite (`services/api-gateway/src/index.ts:61`). Matches `gl-inquiry-routes.ts` registration exactly. |
| 4 | Backend endpoint | `GET /api/v1/coa/inquiry/accounts/:id/activity` and `GET /api/v1/coa/inquiry/accounts/:id/activity:export` (`services/coa-service/src/http/gl-inquiry-routes.ts:82-120`). |
| 5 | Request fields | `periodCode?, preset?, startDate?, endDate?, storeId?, deptCode?, page?, pageSize?` (`gl-inquiry-routes.ts:59-68`, zod). |
| 6 | Response contract | `AccountActivityView { account, range, filters, beginningBalance, endingBalance, periodDebitActivity, periodCreditActivity, lines[], pagination }` (`gl-inquiry-service.ts:101-117`). |
| 7 | Pagination/sorting | `page`/`pageSize`, default 100, max 500 clamped. Sort fixed server-side (`entryDate asc, journalNumber asc, lineIndex asc`) — not client-selectable. |
| 8 | Export | `GET .../activity:export` → CSV, `Content-Disposition: attachment` (`gl-inquiry-routes.ts:101`). |
| 9 | S207 permission | `inquiry.account.view` (`gl-inquiry-routes.ts:30`) — ADMIN/CONTROLLER/ACCOUNTANT only. |
| 10 | S007 audit event | `audit.viewed` / `audit.exported`, `docType: 'GL_ACCOUNT_INQUIRY'`, emitted transactionally on every call (`gl-inquiry-service.ts:402-453`) — real, not a gap. |
| 11 | Error codes | `400 RANGE_REQUIRED`, `400 RANGE_CONFLICT`, `400 INVALID_RANGE`, `400 UNKNOWN_PRESET`, `404 ACCOUNT_NOT_FOUND`, `404 PERIOD_NOT_FOUND`, `400 VALIDATION_ERROR`, `400 BAD_REQUEST` (missing tenant header), plus upstream `401`/`403`. |
| 12 | Tenant/entity scoping | `x-tenant-id` required (400 if missing); every query includes `tenantId`; cross-tenant access → `404` (no existence leak). Store/dept are optional filters, not RLS dimensions. |
| 13 | Filters | `periodCode, preset (OPEN_MONTH only), startDate/endDate, storeId, deptCode`. **Gap:** `sourceCode` is named in `GOLDEN_R0_STORY_CONTRACT_MATRIX.md:184` but absent from code. |
| 14 | Drill-down | Lines carry `journalNumber` (drill key into S217 `GET /journals/:number`). Actual wired direction is TB→GL Inquiry (see Gap Matrix — this call is currently broken). |
| 15 | Test evidence | Unit: `services/coa-service/tests/gl-inquiry.test.ts` (13 `it()` blocks). E2E: `tests/e2e/golden-path.spec.ts:174-184` only asserts drill-panel *visibility*, not content — **no dedicated Playwright spec for S220 itself.** |

**GL Inquiry preset catalogue:** only `OPEN_MONTH` is implemented server-side. The old `GLInquiry.tsx` prototype defines 12 client-side-only preset labels with no backend wiring (cosmetic).

### 1.2 S221 — GL Search (incl. saved-search CRUD)

| # | Item | Evidence |
|---|---|---|
| 1 | Frontend route | `/golden-path/gl-search` (`apps/web/src/App.tsx:545`). |
| 2 | Frontend component | `apps/web/src/pages/goldenpath/GLSearch.tsx` — wired, calls `goldenPathApi.searchGL()` only. **No UI at all** for saved-search create/list/run/delete, even though the backend fully supports all four. |
| 3 | Gateway route | `/api/v1/coa` → `coa-service:3016`, no rewrite (`services/api-gateway/src/index.ts:61`) — matches. |
| 4 | Backend endpoints | `GET /inquiry/search` (102); `POST /inquiry/searches` (113); `GET /inquiry/searches` (124); `GET /inquiry/searches/:id/run` (134); `DELETE /inquiry/searches/:id` (150) — all in `gl-search-routes.ts`. **No PUT/PATCH update endpoint exists.** |
| 5 | Request fields | Search: `entityId, amount, amountMin, amountMax, direction, startDate, endDate, sourceCode, memoContains, postedBy, docRef, page, pageSize`. Create: `{name, criteria}`. |
| 6 | Response contract | `GLSearchResult{criteria, results[], pagination}`; saved-search views `{id, name, criteria, createdAt, updatedAt}`. |
| 7 | Pagination/sorting | `page`/`pageSize`, default 100, max 500. Fixed sort (`entryDate desc, journalNumber desc, lineIndex asc`). |
| 8 | Export | **None** — confirmed absent in code and in the story contract. |
| 9 | S207 permission | Single key `inquiry.search` covers all 5 endpoints, including saved-search writes — ADMIN/CONTROLLER/ACCOUNTANT. |
| 10 | S007 audit events | Search: `audit.viewed`/`GL_SEARCH`/`SEARCHED`. Saved-search create: `audit.saved_search.created`/`GL_SAVED_SEARCH`/`CREATED`. Saved-search delete: `audit.saved_search.deleted`/`DELETED`. Both create/delete audit paths were added by commit `8bb96b0` ("real S007 audit coverage for S221 saved-search CRUD"). |
| 11 | Error codes | `400 SEARCH_CRITERIA_REQUIRED`, `400 INVALID_RANGE`, `400 VALIDATION_ERROR`, `400 BAD_REQUEST`, `404 SAVED_SEARCH_NOT_FOUND`, `409 DUPLICATE_SEARCH_NAME`, plus upstream `401`/`403`. |
| 12 | Tenant/entity scoping | Search: `tenantId` on both `journalLine`/`entry` + RLS. Saved search: `@@unique([tenantId, createdBy, name])` — **user-scoped within tenant**, not tenant-wide-shared. |
| 13 | Filters | `entityId, amount/amountMin/amountMax, direction, startDate+endDate, sourceCode, memoContains, postedBy, docRef`. |
| 14 | Drill-down | Result rows carry `journalNumber` (S217) and `accountId` (S220) as drill keys, but `GLSearch.tsx` renders them as **plain table cells, not links** — no clickable drill-through wired. |
| 15 | Test evidence | Unit: `services/coa-service/tests/gl-search.test.ts` (20 `it()` blocks, covers saved-search save/list/run/delete/duplicate-name/not-found). Authz: `authz-guard-integration.test.ts:157` covers plain search only. E2E: `golden-path.spec.ts:191-197` covers search only — **zero Playwright coverage of saved-search CRUD.** |

**Saved-search CRUD verdict:** CREATE ✅ real persistence, READ (list) ✅, READ (run) ✅, DELETE ✅ real persistence — all transactional, none stubbed. **UPDATE does not exist** (no route, no service method) — genuinely unimplemented, not a stub.

### 1.3 S014 (Trial Balance API) / S222 (Trial Balance screen)

| # | Item | Evidence |
|---|---|---|
| 1 | Frontend route | `/golden-path/trial-balance` (`App.tsx:544`) — real screen. A second, separately-routed legacy screen also exists at `/accounting/reports/gl-trial-balance` (`App.tsx:580`). |
| 2 | Frontend component | `apps/web/src/pages/goldenpath/TrialBalance.tsx` — wired to real S014 API. Legacy `GLTrialBalance.tsx` is also live/routed but calls a different, older `/trial-balance?year&month` endpoint and has a **broken export button** (calls a nonexistent `/api/v1/gl/trial-balance/export` route). |
| 3 | Gateway route | `/api/v1/gl` → `gl-service:3010`, rateLimit 100 (`api-gateway/src/index.ts:50`). |
| 4 | Backend endpoint | `GET /api/v1/gl/reports/trial-balance` (`services/gl-service/src/http/routes.ts:648`) → `TrialBalanceService.getReport`. |
| 5 | Request fields | `entity`(or `company`), `store?`, `dept?`, `asOf` (required, `YYYY-MM`). |
| 6 | Response contract | `{scope, accounts: TrialBalanceRow[], drSum, crSum, delta}`; each row: `accountId, accountCode, accountName, accountType, normalBalance, priorBalance, currentAmount, endingBalance, debitBalance, creditBalance`. |
| 7 | Pagination/sorting | None — full list returned, always sorted `accountCode ASC`. Zero-balance suppression is a **client-side** re-filter only. |
| 8 | Export | **No backend export endpoint exists.** CSV is built entirely client-side from the already-fetched JSON (`TrialBalance.tsx:39-57`) — no network call, no `EXPORTED` audit event. This differs from the real server-side export pattern used by Balance Sheet/Income Statement. |
| 9 | S207 permission | `report.tb.view` (`services/gl-service/src/http/security.ts:12`) — ADMIN/CONTROLLER/ACCOUNTANT. |
| 10 | S007 audit event | `audit.viewed` / `GL_LEDGER_REPORT` on view only — no `EXPORTED` event (export is client-side, see item 8). |
| 11 | Error codes | `400 MISSING_ENTITY`; `500 STRUCTURAL_IMBALANCE {drSum, crSum, delta}` when `|delta| > 0.005`; upstream `401`. **Gap:** an invalid `asOf` fails the zod regex with no registered error handler, defaulting to a raw, unhandled `500` instead of a clean `400`. |
| 12 | Tenant/entity scoping | `x-tenant-id` required; `entity`/`company` mandatory-filtered. Gate-service's `companyCode` dimension is architecturally separate from tenant-service's `legalEntityId` used elsewhere (per `ADR-JL-001_SEPARATE_LEDGER_LIMITATION.md`). |
| 13 | Filters — store/dept | **Confirmed fully supported**, not entity-only: `storeId`/`departmentCode` are real columns and real query filters (`trial-balance-service.ts:227-269`; `gl-service/prisma/schema.prisma:128-129, 235-237`). By contrast, the legacy `GLTrialBalance.tsx` has a `department` UI field that is **never passed** into its query — non-functional. |
| 14 | Drill-down | `drillToInquiry()` (`TrialBalance.tsx:111-134`) does a best-effort cross-service correlation: looks up a coa-service account by `accountNumber`, then calls S220's GL Inquiry endpoint. Not an FK relationship — mismatches render `tb-drill-error`. |
| 15 | Test evidence | `services/gl-service/tests/trial-balance.service.test.ts` and `trial-balance.integration.test.ts` (BR014-2 zero-variance proof, structural-imbalance throw, store/dept slicing). E2E: `golden-path.spec.ts:176-207` (grand-total assertion), `golden-path-negative.spec.ts:215-246` (`tb-structural-imbalance-banner`). |

**Live-stack status (load-bearing fact):** `docker-compose.yml` defines `gl-service` as a normal compose service, and `S014_LIVE_GATEWAY_CERTIFICATION_REPORT.md`/`S222_LIVE_GATEWAY_CERTIFICATION_REPORT.md` document a real live-gateway proof — but on custom, non-default ports spun up specifically for certification, not confirmed identical to the default always-on stack. **API_CONFIRMATION_REQUIRED.**

### 1.4 S227 — Balance Sheet

| # | Item | Evidence |
|---|---|---|
| 1 | Frontend route | `/golden-path/balance-sheet` (`App.tsx:551`). |
| 2 | Frontend component | `apps/web/src/pages/goldenpath/BalanceSheet.tsx` — fully wired, no dead legacy duplicate found. |
| 3 | Gateway route | `/api/v1/gl` → `gl-service:3010`. (The separate `/api/v1/gl/fs` and `/api/v1/fs` prefixes route to the unrelated `fs-service:3015` and are **not** used by Balance Sheet — resolved precisely by path-prefix matching.) |
| 4 | Backend endpoint | `GET /reports/balance-sheet` + `GET /reports/balance-sheet/export` (`services/gl-service/src/http/routes.ts:710-786`) → `FinancialStatementService.getBalanceSheet()`. |
| 5 | Request fields | `entity`(or `company`), `store?`, `dept?`, `asOf` (required, `YYYY-MM`). |
| 6 | Response contract | `{scope, assets:{rows,total}, liabilities:{rows,total}, equity:{rows,total,currentEarnings}, totalLiabilitiesAndEquity, excludedAccounts[], reconciledToTrialBalance:{drSum,crSum}}`. |
| 7 | Pagination/sorting | None — deterministic stable sort by `accountCode`. |
| 8 | Export | `GET /reports/balance-sheet/export` → real server-side CSV, `Content-Disposition: attachment`. Frontend both previews (`bs-csv-preview`) and downloads. |
| 9 | S207 permission | `report.fs.view` (shared with Income Statement) — ADMIN/CONTROLLER/ACCOUNTANT. |
| 10 | S007 audit event | `audit.viewed`/`audit.exported`, `GL_LEDGER_REPORT` — live-proven (3 VIEWED + 2 EXPORTED rows per MODULE_STATE.json). |
| 11 | Error codes | `400 MISSING_ENTITY`; `500 STRUCTURAL_IMBALANCE {error, totalAssets, totalLiabilitiesAndEquity, delta}` (thrown when assets ≠ liabilities+equity); `500 UNCLASSIFIED_ACCOUNT_TYPE {error, accounts[]}`. |
| 12 | Tenant/entity/store/dept scoping | Full `tenantId` scoping; `store`/`dept` are real filters at the S014 query layer — store/department-level Balance Sheets are genuinely supported. |
| 13 | Filters — YTD/comparative | **Confirmed absent.** `asOf` is a single-month snapshot; no `compareTo`/prior-period param exists anywhere. Documented as an intentional out-of-scope item in `S227_FINANCIAL_STATEMENT_ROLLUP_CONTRACT.md` §7. |
| 14 | Drill-down | **None.** No per-row link from a BS line item to GL Inquiry, Trial Balance, or journal detail — only static page-level nav links. |
| 15 | Test evidence | `services/gl-service/tests/s227-rollup-contract.proof.test.ts` (live-DB proof); `golden-path.spec.ts:214-239` (happy path + export filename); `golden-path-negative.spec.ts:248-258` (`bs-unclassified-banner` only). **No Playwright test exercises the BS-specific `bs-structural-imbalance-banner`** — only manually/live-proven per the certification report, and only the Trial Balance's equivalent banner is automated. |

**`excludedAccounts` composition:** `EXCLUDED_TYPES = {COST_OF_SALES, DISTRIBUTION}` — any such account is excluded with `reason: 'OUT_OF_SCOPE_ACCOUNT_TYPE'`, matching `KNOWN_LIMITATIONS_REGISTER.md` row 3 exactly.

### 1.5 S227 — Income Statement

| # | Item | Evidence |
|---|---|---|
| 1 | Frontend route | `/golden-path/income-statement` (`App.tsx:552`). |
| 2 | Frontend component | `apps/web/src/pages/goldenpath/IncomeStatement.tsx` — fully wired. |
| 3 | Gateway route | `/api/v1/gl` → `gl-service:3010` — same resolution as Balance Sheet; `fs-service` is not touched. |
| 4 | Backend endpoint | `GET /reports/income-statement` + `GET /reports/income-statement/export` (`routes.ts:792-848`) → `FinancialStatementService.getIncomeStatement()`. |
| 5 | Request fields | `entity`(or `company`), `store?`, `dept?`, `asOf` (required). |
| 6 | Response contract | `{scope, revenue:{rows,total}, expense:{rows,total}, netIncome, excludedAccounts[]}`. No `reconciledToTrialBalance` field (BS-only). |
| 7 | Pagination/sorting | None — sorted by `accountCode`. |
| 8 | Export | `GET /reports/income-statement/export` → real server-side CSV including a synthetic `NET_INCOME` row. |
| 9 | S207 permission | `report.fs.view` — same key as Balance Sheet, no IS-specific permission. |
| 10 | S007 audit event | `audit.viewed`/`audit.exported`, `GL_LEDGER_REPORT` — shared handler with BS. |
| 11 | Error codes | `400 MISSING_ENTITY`; `500 UNCLASSIFIED_ACCOUNT_TYPE {error, accounts[]}`; `500 STRUCTURAL_IMBALANCE {error, drSum, crSum, delta}` — **corrected (Income Statement refinement, 2026-07-28):** this row previously stated `STRUCTURAL_IMBALANCE` is never thrown by `getIncomeStatement()`. That was inaccurate: it conflated the TB-level check with the FS-level check. `getIncomeStatement()` calls `TrialBalanceService.getReport()` first, exactly like `getBalanceSheet()` does, so the TB-level `StructuralImbalanceError` (`{drSum, crSum, delta}`) is genuinely reachable from Income Statement. Only the FS-level `FSStructuralImbalanceError` (`{totalAssets, totalLiabilitiesAndEquity, delta}` — assets vs liabilities+equity) has no Income-Statement equivalent, since Income Statement has no analogous cross-total invariant; that check exists only in `getBalanceSheet()`. Both the export route and the view route now defensively catch both shapes for governed-response-shape parity with Balance Sheet, even though the FS-level shape is not reachable from Income Statement today. COST_OF_SALES/DISTRIBUTION accounts are excluded as diagnostics with `netIncome` unaffected, no error. This narrows `KNOWN_LIMITATIONS_REGISTER.md` row 3's wording, which is accurate for BS but doesn't apply to IS the same way. |
| 12 | Tenant/entity/store/dept scoping | Same as Balance Sheet — full tenant scoping, real store/dept filters inherited from the shared S014 query layer. |
| 13 | Filters — YTD/comparative/%-of-revenue | **All three confirmed absent.** Single-month `asOf` only (contract §7, explicit out-of-scope); no comparative-period param; no %-of-revenue field anywhere in `StatementRow`, the rollup contract, or the component (a `GP %` calculation exists only in the unrelated, non-Golden-Path `apps/web/src/pages/accounting/FinancialStatements.tsx`). |
| 14 | Drill-down | **None** — same as Balance Sheet; only static page-level nav links exist. |
| 15 | Test evidence | `services/gl-service/tests/financial-statement.service.test.ts` (5 `it` blocks, unit-level); `golden-path.spec.ts:221-225` (`is-net-income` visible); `golden-path-negative.spec.ts:258-264` (`is-unclassified-banner`). |

**Net-income presentation:** no BALANCED/NOT BALANCED badge exists for IS (unlike BS's `bs-balanced-badge`) — instead `is-net-income` is color-coded green/red by sign (`IncomeStatement.tsx:161-169`), consistent with the concept of "balanced" not applying to an income statement.

---

## 2. Design-to-code gap matrix

| Gap (register ID) | Screen(s) | Type | Severity | Notes |
|---|---|---|---|---|
| TB drill-through hardcodes `preset=CURRENT_MONTH`; backend only accepts `preset=OPEN_MONTH` → **deterministic 400 on every real drill-through invocation** (UXMAP-03) | S220 (via S222) | Functional defect | **High** | Masked in CI because `golden-path.spec.ts:174-184` only asserts panel *visibility*, not that real data loads. Surfaces to users as `tb-drill-error` every time. |
| No backend Trial Balance export endpoint; CSV is client-built with no audit trail | S014/S222 | Contract inconsistency | Medium | Breaks the export/audit symmetry that Balance Sheet and Income Statement both have. |
| Legacy `GLTrialBalance.tsx` export button calls a nonexistent route (`/api/v1/gl/trial-balance/export`) | S014/S222 (legacy screen) | Broken UI, live-routed | Medium | Screen is reachable at `/accounting/reports/gl-trial-balance`; department filter on the same screen is also non-functional (state not passed to query). |
| `GLInquiry.tsx` is live/routed but calls a disconnected legacy gl-service endpoint instead of the real S220 coa-service backend | S220 (legacy screen) | Orphaned integration | Medium | Real S220 API is only reachable indirectly, via the TB drill-through panel. |
| No frontend UI at all for saved-search create/list/run/delete | S221 | Missing UI | Medium | Backend is fully built and audited; this is pure frontend scope, consistent with "no Figma pass yet." |
| Saved-search UPDATE has no route or service method | S221 | Missing feature | Low–Medium | Not a stub — genuinely never built. Delete+recreate is the only path today. |
| No drill-down links rendered from GL Search results, despite carrying real drill keys | S221 | Missing UI wiring | Low | `journalNumber`/`accountId` present in the data, not rendered as links. |
| No drill-down from Balance Sheet or Income Statement line items | S227 (BS+IS) | Missing feature / scope | Low–Medium | No acceptance criterion found requiring it — needs a product decision. |
| No comparative-period or YTD support | S227 (BS+IS) | Scope gap (documented) | Low | Explicitly called out as out-of-scope in the rollup contract — disclosed, not hidden. |
| No percentage-of-revenue column | S227 (IS) | Scope gap | Low | No evidence it was ever planned for R0. |
| Invalid `asOf` returns an unhandled 500 instead of a clean 400 | S014/S222 | Error-contract gap | Medium | No zod/error handler registered in gl-service; violates the "clean error contract" pattern used elsewhere. |
| `KNOWN_LIMITATIONS_REGISTER.md` row 1 miscategorizes S220 as a gl-service screen (it's coa-service) | S220 | Doc staleness | Low | Doc-only fix. |
| `S221_LIVE_GATEWAY_CERTIFICATION_REPORT.md` still claims saved-search CRUD is unaudited — contradicted by commit `8bb96b0` (same-day fix) | S221 | Doc staleness | Low | Doc-only fix; code is actually ahead of the doc. |
| `GOLDEN_R0_STORY_CONTRACT_MATRIX.md` / `GOLDEN_R0_STORY_CONTRACT_GAPS.md` describe S227 as untracked / prototype-only | S227 (BS+IS) | Doc staleness | Low | Both docs predate the real `FinancialStatementService` implementation and certification evidence. |
| No automated Playwright test for the BS-specific `bs-structural-imbalance-banner` | S227 (BS) | Test-coverage gap | Low | Only manually/live-proven; TB has an equivalent automated test, BS does not. |
| No dedicated Playwright spec for S220 or for saved-search CRUD (S221) | S220, S221 | Test-coverage gap | Low | Existing E2E coverage is incidental (drill-panel visibility only) or entirely absent. |
| gl-service's presence in the *default* deployed stack (vs. only ad hoc certification runs) is not independently confirmed | S014/S222/S227 (all gl-service-backed) | Deployment confirmation | Medium | Certification evidence used custom, non-default ports. |

---

## 3. Updated decision register (22 items)

**Namespace note:** `decisions/DECISION_REGISTER.md`'s local open-questions
table only goes up to UQ-05, but `GOLDEN_R0_STORY_CONTRACT_GAPS.md`
separately references backlog-numbered items UQ-14, UQ-15, UQ-21, etc. from
the original 22-item validation-report numbering (a different namespace —
e.g. `decisions/UQ-15_AUDIT_RETENTION_WORM.md` is that backlog's audit
retention/WORM question, unrelated to this pass). To avoid colliding with
either existing sequence, every item surfaced by this pass is filed under a
new `UXMAP-NN` prefix, both here and as appended rows in
`decisions/DECISION_REGISTER.md`.

| ID | Item | Screen(s) | Classification |
|---|---|---|---|
| UXMAP-01 | `KNOWN_LIMITATIONS_REGISTER.md` miscategorizes S220 as a gl-service screen | S220 | API_CONFIRMATION_REQUIRED |
| UXMAP-02 | Retire, rewire, or leave `GLInquiry.tsx` (legacy, disconnected from real S220 backend) | S220 | PRODUCT_DECISION_REQUIRED |
| UXMAP-03 | TB→GL-Inquiry drill-through preset mismatch (`CURRENT_MONTH` vs `OPEN_MONTH`) — deterministic failure | S220/S222 | KNOWN_GOLDEN_R0_LIMITATION *(flagged as an active defect, not a scope gap — recommend fixing ahead of the others)* |
| UXMAP-04 | GL Inquiry preset catalogue: only 1 of ~12 contract-named presets implemented | S220 | SME_DECISION_REQUIRED |
| UXMAP-05 | `sourceCode` filter named in story contract but absent from S220 code | S220 | API_CONFIRMATION_REQUIRED |
| UXMAP-06 | S217 journal-detail response shape (S220 drill-down target) not verified in this pass | S220 | API_CONFIRMATION_REQUIRED |
| UXMAP-07 | No dedicated Playwright coverage of the S220 endpoint itself | S220 | KNOWN_GOLDEN_R0_LIMITATION |
| UXMAP-08 | Saved-search UPDATE missing entirely (no route/service method) | S221 | PRODUCT_DECISION_REQUIRED |
| UXMAP-09 | No frontend UI for saved-search create/list/run/delete | S221 | KNOWN_GOLDEN_R0_LIMITATION |
| UXMAP-10 | `S221_LIVE_GATEWAY_CERTIFICATION_REPORT.md` stale re: saved-search audit coverage (contradicted by commit `8bb96b0`) | S221 | API_CONFIRMATION_REQUIRED |
| UXMAP-11 | No drill-down links rendered in GL Search UI despite drill keys being present in the data | S221 | KNOWN_GOLDEN_R0_LIMITATION |
| UXMAP-12 | No negative/permission E2E coverage for saved-search-write endpoints | S221 | KNOWN_GOLDEN_R0_LIMITATION |
| UXMAP-13 | No backend Trial Balance export endpoint / no export audit trail | S014/S222 | PRODUCT_DECISION_REQUIRED |
| UXMAP-14 | Legacy `GLTrialBalance.tsx`: broken export link + dead department filter | S014/S222 | PRODUCT_DECISION_REQUIRED |
| UXMAP-15 | Invalid `asOf` throws unhandled 500 instead of clean 400 | S014/S222 | API_CONFIRMATION_REQUIRED |
| UXMAP-16 | gl-service default-stack deployment status not independently confirmed | S014/S222/S227 | API_CONFIRMATION_REQUIRED |
| UXMAP-17 | `GOLDEN_R0_STORY_CONTRACT_MATRIX.md`/`GAPS.md` stale re: S227 implementation status | S227 (BS+IS) | KNOWN_GOLDEN_R0_LIMITATION |
| UXMAP-18 | No automated test for BS-specific `STRUCTURAL_IMBALANCE` banner | S227 (BS) | KNOWN_GOLDEN_R0_LIMITATION |
| UXMAP-19 | No comparative-period / YTD support on Balance Sheet or Income Statement | S227 (BS+IS) | PRODUCT_DECISION_REQUIRED |
| UXMAP-20 | No drill-down from Balance Sheet or Income Statement line items | S227 (BS+IS) | PRODUCT_DECISION_REQUIRED |
| UXMAP-21 | No percentage-of-revenue column on Income Statement | S227 (IS) | PRODUCT_DECISION_REQUIRED |
| UXMAP-22 | **RESOLVED (Income Statement refinement, 2026-07-28):** this row itself was based on an inaccurate premise — it claimed only `UNCLASSIFIED_ACCOUNT_TYPE` applies to Income Statement. In fact the TB-level `STRUCTURAL_IMBALANCE` (`{drSum,crSum,delta}`) is also reachable from `getIncomeStatement()`, since it shares the same `TrialBalanceService.getReport()` call as `getBalanceSheet()`. Only the FS-level `STRUCTURAL_IMBALANCE` shape (`{totalAssets,totalLiabilitiesAndEquity,delta}`) is BS-specific. The export/view routes and the IS screen now handle both shapes explicitly; `KNOWN_LIMITATIONS_REGISTER.md` row 3 remains accurate as BS-specific wording and needs no further change. This was a documentation-accuracy correction, not a product decision — no unresolved decision remains open. | S227 (IS) | KNOWN_GOLDEN_R0_LIMITATION |

**Not re-listed here** (already tracked, unchanged, and carried forward as-is
from the existing register): real Figma/UX/human sign-off and real
Accounting SME acceptance remain open package-wide for all 8
`DONE_PENDING_INTEGRATION` stories, including all 5 screens in this pass —
see `KNOWN_LIMITATIONS_REGISTER.md` rows 6–7. This pass did not change that
status.

---

## 4. Mandatory vs. optional unresolved decisions

**Mandatory** (recommend resolving before further frontend/UX work on these
screens, or before re-certifying):
- UXMAP-03 — TB drill-through preset bug (active functional defect, not a scope question)
- UXMAP-15 — unhandled 500 on invalid `asOf` (error-contract violation)
- UXMAP-16 — confirm gl-service is genuinely part of the default deployed stack
- UXMAP-01, UXMAP-10, UXMAP-17 — doc corrections (cheap, prevent future misdirection of engineers relying on these docs as ground truth)

**Optional / deferred** (scope or polish decisions; none block current
Golden Path correctness, all already implicitly disclosed by the
`DONE_PENDING_INTEGRATION` status):
- UXMAP-02, UXMAP-04, UXMAP-05, UXMAP-06, UXMAP-07 (S220 polish/scope)
- UXMAP-08, UXMAP-09, UXMAP-11, UXMAP-12 (S221 saved-search UI/coverage — greenfield frontend work, not a fix)
- UXMAP-13, UXMAP-14 (S014/S222 export/legacy-screen scope)
- UXMAP-18, UXMAP-19, UXMAP-20, UXMAP-21, UXMAP-22 (S227 scope/coverage/wording)

---

## 5. Readiness recommendation per screen

| Screen | Backend contract | Test evidence | Blocking issues | Recommendation |
|---|---|---|---|---|
| **S220 — GL Inquiry** | Solid: real permission, real audit, clean error contract | Unit-tested; no dedicated E2E | UQ-08 (active bug), UQ-07 (orphaned legacy screen) | **Not ready for a UX pass as-is.** Fix UQ-08 first — it currently breaks the only real user-facing path into this API. Resolve UQ-07 before design work, or the UX pass will design against the wrong component. |
| **S221 — GL Search** | Solid for search + create/read/delete; UPDATE genuinely missing | Strong unit coverage; zero E2E for saved-search | UQ-13 (missing UPDATE), UQ-14 (no UI at all for saved-search) | **Search itself is implementation-ready.** Saved-search is backend-complete but frontend-absent — this is new UI construction, not a mapping fix; scope it as its own frontend workstream. |
| **S014/S222 — Trial Balance** | Solid core report; export/error-handling inconsistent with BS/IS pattern | Strong unit + integration + E2E | UQ-20 (error contract), UQ-19 (broken legacy screen live in prod routes) | **Functionally ready.** Recommend closing UQ-19 (retire or fix the legacy duplicate screen — it's live and broken) and UQ-20 before sign-off. |
| **S227 — Balance Sheet** | Most robust of the five: correct gateway resolution, correct error contracts, real store/dept slicing | Strongest test evidence, incl. a live-DB rollup proof | UQ-23 (test gap only) | **Ready**, pending only test-coverage and scope decisions (all optional). |
| **S227 — Income Statement** | Same backend robustness as BS | Good unit + E2E coverage | UQ-27 (doc precision only) | **Ready**, pending only scope decisions (YTD, %-of-revenue, drill-down — all optional) and one doc-wording fix. |

**Overall:** none of the 5 screens are blocked by missing backend evidence —
every screen has a real, tested, audited, permissioned backend contract. The
package-wide gate (real human Figma/UX/product review and real Accounting
SME acceptance, per `MODULE_STATE.json` `_meta.phase4Note` and
`KNOWN_LIMITATIONS_REGISTER.md` rows 6–7) remains the actual reason none of
these 5 stories can move past `DONE_PENDING_INTEGRATION` — that has not
changed as a result of this pass, and this pass does not authorize a status
change.
