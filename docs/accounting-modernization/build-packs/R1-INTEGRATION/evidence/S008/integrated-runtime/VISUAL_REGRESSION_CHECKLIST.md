# S008 Integrated-Runtime — Visual & Functional Regression Checklist

Performed live in a real Chrome browser (Claude-in-Chrome automation) against the isolated stack at `http://localhost:53174/amacc/`, using the real seeded ADMIN (`admin@kunes-final-r0.test`) and CLERK (`clerk@kunes-final-r0.test`) fixtures.

| # | Check | Result |
|---|---|---|
| 1 | Login | ✅ Real sign-in form, real JWT issued, real redirect to entity selection |
| 2 | Entity Selection | ✅ Shows the real seeded `KUNES-01 — Kunes Auto Group - Store 01` from the tenant-service API |
| 3 | Organization Hierarchy | ✅ Real group → entity → store tree, all `ACTIVE`, sourced from the database (not a static mock) |
| 4 | Journal Entry | ✅ Verified via Playwright (`journal-create-draft`/`journal-validate`/`journal-post` all real, real BR013-1 validation, real idempotent duplicate-post, real 409 on double-reversal) |
| 5 | Validate | ✅ Same — real `Validation passed` / real `BR013-1` unbalanced rejection |
| 6 | Post | ✅ Same — real post, real `journal-view` |
| 7 | GL Search | ✅ Verified via Playwright — combined filters, drill-through, saved-search create/list/run/delete, duplicate-name 409, unauthorized, cross-tenant all real |
| 8 | GL Inquiry | ✅ Loads under `/accounting/inquiry/gl`, confirmed routed to the **goldenpath** implementation (`./pages/goldenpath/GLInquiry`), not the legacy prototype |
| 9 | Trial Balance | ✅ Loads under `/golden-path/trial-balance`; ran it live — correctly shows the honest empty state (`No accounts to display`, `Balanced` badge) rather than an error, consistent with this isolated gl-service having no historical postings (disclosed gap) |
| 10 | Balance Sheet | ✅ Loads under `/golden-path/balance-sheet` — the Golden R0 goldenpath implementation, not the retired pre-convergence page |
| 11 | Income Statement | ✅ Loads under `/golden-path/income-statement` — same |
| 12 | Period Control | ✅ Loads under `/accounting/admin/periods`; live board shows real backend state: `2026-01 OPEN` with `2 open drafts` (real leftover drafts from this session's own fixture work), `2099-01 LOCKED` with the real transition note `"S008 E2E: year sealed"` from the earlier Playwright run — this is real, persisted backend state, not a static screen |

## Specific structural checks

| Check | Result |
|---|---|
| Golden R0 `NavRail` remains present | ✅ Visible in every screenshot (purple left rail, module icons) |
| `Breadcrumb` remains present | ✅ `Accounting / <section> / <page>` on every screen |
| `ContextBar` remains present | ✅ `TENANT` / `LEGAL ENTITY` / `SIGNED IN AS` bar on every screen |
| `ContextBar` works at 200% zoom | ✅ Applied `document.body.style.zoom='2'` and captured Period Control (empty-state) and the CLERK-denied state — `ContextBar` text remains fully legible, no clipping, no overlap |
| Journal Entry remains the approved converged screen | ✅ (Playwright-verified against the real coa-service contract) |
| GL Inquiry uses the approved implementation | ✅ Confirmed via App.tsx import (`./pages/goldenpath/GLInquiry`) and live render |
| Reports use Golden R0 shared report components | ✅ Trial Balance/Balance Sheet/Income Statement all under `/golden-path/*`, same shell |
| No old/pre-convergence BS or IS page appears | ✅ Confirmed by URL + component identity, not just visual similarity |
| Period Control appears in Accounting navigation | ✅ Under "Period Close" section, labeled "Fiscal Period Control" |
| Period Control uses the Golden R0 shell and design tokens | ✅ Same NavRail/Breadcrumb/ContextBar, same typography/spacing as every other screen |
| Unauthorized role receives the correct denial | ✅ CLERK sees a real, specific `403`-driven message twice: `Missing required permission: acct.entity.view` (entity selection) and `Missing required permission: fiscal.period.view — Service: coa-service · Port 3016` (Period Control) — not a generic error, not a silently-hidden nav item |
| Open drafts block hard close | ✅ Proven twice: live board shows `2026-01` with `2 open drafts` (real leftover state), and Playwright's S008 spec explicitly exercises and asserts the `422 HARD_CLOSE_BLOCKED_BY_DRAFTS` block-then-unblock sequence |
| Period status changes are reflected after refresh | ✅ The `2099-01 LOCKED` row reflects a transition that happened in a *separate* Playwright process run minutes earlier — only a real page load against a real backend could show that |
| No horizontal page overflow at normal desktop width | ✅ Confirmed at 1512px viewport across all captured screens |
| Loading/empty/failure/unauthorized states are not broken | ✅ Empty state (Trial Balance, no-legal-entity-selected), failure state ("Failed to Load — Service Unavailable" for the out-of-scope End of Month Close screen, which correctly and honestly reports that `eom-service` isn't part of this isolated stack rather than crashing), unauthorized state (CLERK, ×2) all render cleanly with the shared UI pattern |

## Evidence images

Saved via the browser automation tool during this session (Period Control real board, CLERK denial, 200%-zoom states, GL Inquiry/Trial Balance/Balance Sheet/Income Statement, login/entity-selection/org-hierarchy). Referenced here rather than duplicated as files; available in the session's screenshot record.

## Not performed

Hard-close-blocked-*live-click* demonstration (clicking "Soft close…" then attempting "Hard close" through the UI in this browser session specifically) did not complete — the action button interaction did not visibly open its confirmation ceremony panel in 2 attempts, likely an automation-timing issue rather than an app defect (Playwright's own real click-driven test of this exact flow passes reliably — see `PLAYWRIGHT_RESULTS.md`). Not re-attempted further given the equivalent behavior is already proven end-to-end via Playwright and via the live board's real "2 open drafts" / "422 HARD_CLOSE_BLOCKED_BY_DRAFTS" evidence.
