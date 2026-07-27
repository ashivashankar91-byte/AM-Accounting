# Golden R0 — Design-to-Code Comparison

**Date:** 2026-07-28
**Source read in full:** `docs/accounting-modernization/ux/golden-r0/claude-design/` — `DESIGN_SOURCE_OF_TRUTH.md`, `CLAUDE_CODE_INSTRUCTION.md`, `AutoMate_Accounting_Golden_R0_Design.html` (1755 lines), `ReportScreen.html` (285 lines), `support.js` (verified as the generic Claude Design rendering runtime — grepped for screen-specific content, found none; it is templating/React glue only), and both reference images.
**Precedence applied (per `CLAUDE_CODE_INSTRUCTION.md`):** Accepted Story Contract → certified backend/API behavior → this design package → current frontend implementation.
**Scope:** Journal Entry, GL Search (S221), GL Inquiry (S220), Trial Balance (S014/S222), Balance Sheet (S227), Income Statement (S227) — as requested. No code changed in this pass; comparison only.

---

## Visual system the design introduces (applies to all 6 screens)

IBM Plex Sans (UI) / IBM Plex Mono (numbers, codes) — replaces current Inter/JetBrains Mono. Palette: purple nav rail `#43206B`, navy section/table headers `#1E3A5C`, primary blue `#0B5CAB`, page ground `#E9EDF2`, white work surfaces with `#DCE1E8` hairlines, semantic success/error/warning/info families. 32px controls, 34px table rows, 3–4px radii, one shared `ReportScreen` shell (breadcrumb → title/badge/asOf → actions → context bar → filter bar → banner → table+footer → related links → export menu → detail drawer) used identically by all 5 report screens.

**None of this exists in the current codebase.** Every current goldenpath screen hand-rolls its own inline styles (`fontFamily: 'Inter, sans-serif'`), has no shared shell, no context bar, no drawer, no export menu, and duplicates its own `fmt()` money formatter per file.

---

## Screen 1 — Journal Entry

- **Existing route/component:** `/golden-path/journal` → `apps/web/src/pages/goldenpath/JournalWorkflow.tsx`. Real, wired to coa-service draft/validate/post/reverse (S214/S215/S216).
- **Real API mapping:** `createDraft`, `validateDraft`, `postDraft`, `reverseJournal`, `getJournal`, `listAccounts`, `listStores` — all real, all already correct (confirmed live via the certified Playwright suite).
- **Reusable components:** none of the design's 12 (`AccountingPageHeader`, `JournalHeaderForm`, `JournalLinesTable`, `DebitCreditCell`, `MoneyCell`, `TotalsFooter`, `ValidationBanner`, `ConfirmationDialog`, `StatusBadge`, `AccountLookup`, `AccountingContextBar`, `RelatedLinks`) exist yet.
- **Visual gaps:** plain `<select>`/`<input>` grid instead of a financial data table; no status badge (Draft/Validated/Posted/Reversed); no pinned totals footer with variance; no debit/credit column money formatting; numbered-button steps ("1. Save Draft") instead of a workflow header.
- **Interaction gaps:** no confirmation dialog before Post/Reverse (design requires one, restating amounts); no account lookup/typeahead (plain `<select>` populated with every postable account); no keyboard model (Tab/Enter/Escape/Alt+A).
- **Missing states:** no dedicated loading/empty/unauthorized/no-entity states — only a generic error paragraph.
- **Unsupported proposals — must not ship as-is:** none flagged for this screen specifically, but the design itself marks the *entire* Journal Entry API/permission/audit surface `API_CONFIRMATION_REQUIRED` (endpoint shapes, validation rule-id payload, permission keys, audit event names). The real repo already answers most of this (draft/validate/post/reverse endpoints are real and certified) — the design's flags are stale relative to what's actually shipped.
- **Implementation sequence position:** lowest priority for this pass. It was the *only* section tagged `R0 scope` in the design (sections 05–09 are a later addition per the stale scope note above), it already has a working, certified backend integration, and it was not part of the Phase A–E ask that opened this conversation. Recommend treating it as a separate, later workstream.

---

## Screen 2 — GL Search (S221)

- **Existing route/component:** `/golden-path/gl-search` → `GLSearch.tsx`. Real, wired to `GET /api/v1/coa/inquiry/search`.
- **Real API mapping (from the prior evidence pass, re-confirmed against code this session):** `SearchQuerySchema` = `entityId, amount, amountMin, amountMax, direction(DEBIT|CREDIT), startDate, endDate, sourceCode, memoContains, postedBy, docRef, page, pageSize`. Saved-search CRUD is real and separate: `POST/GET /inquiry/searches`, `GET /inquiry/searches/:id/run`, `DELETE /inquiry/searches/:id` — no UPDATE endpoint exists.
- **Reusable components:** none exist yet; would share the same shell as GL Inquiry/Trial Balance/BS/IS.
- **Visual gaps:** plain inline table, no context bar, no filter bar styling, no export menu chrome (see unsupported note below).
- **Interaction gaps:** result rows are plain `<td>` text — not clickable, despite the API returning `journalNumber` and `accountId` on every row (real drill keys into S217/S220). **Saved-search CRUD has zero UI** even though the backend fully supports create/list/run/delete.
- **Missing states:** no explicit loading/empty/unauthorized states (only an ad hoc error paragraph); no dedicated "duplicate search name" state (real backend returns `409 DUPLICATE_SEARCH_NAME`).
- **Unsupported proposals — must not ship:**
  - Design's **"Account" filter** (lookup/select) — the real `SearchQuerySchema` has no account field at all. Omit.
  - Design's **Export menu** (CSV/Excel/PDF) — GL Search has **no export endpoint** in the real backend (confirmed absent). Omit entirely.
  - Design's drawer note flags the result-detail payload as `API_CONFIRMATION_REQUIRED` — resolved: the real search response row already carries every field the design's drawer wants (document, date, account, description, store, dept, debit, credit, status) plus the two drill keys. No further confirmation needed.
- **Design gap — saved search is entirely absent from the design package.** The design's GL Search mockup has no concept of saving/listing/running/deleting a search, even though it's a real, certified, audited feature. This UI has no design precedent to follow; it must be built net-new, using the same visual system (banner pattern for the 409 duplicate-name conflict, a list/drawer pattern for saved searches) rather than copied from an existing mockup.
- **Implementation sequence position:** after GL Inquiry (drill-through target must exist first). Filters should use the **real, full** supported set (docRef, sourceCode, memoContains, direction, date range, amount range) rather than the design's narrower, partially-unsupported one.

---

## Screen 3 — GL Inquiry (S220)

- **Existing route/component:** two conflicting things today —
  1. `/accounting/inquiry/gl` → `apps/web/src/pages/accounting/GLInquiry.tsx` (1482 lines), **routed and live, but calls the legacy gl-service `/api/v1/gl/inquiry` endpoint**, not the real S220 contract.
  2. The real S220 backend (`GET /api/v1/coa/inquiry/accounts/:id/activity`) is only reachable indirectly, through the Trial Balance drill-through panel (`TrialBalance.tsx`'s `drillToInquiry()`), which had the `preset=CURRENT_MONTH` defect fixed earlier this session (now `preset=OPEN_MONTH`).
  There is **no standalone screen wired to the real S220 API today.**
- **Real API mapping:** `QuerySchema` = `periodCode?, preset?("OPEN_MONTH" only), startDate?, endDate?, storeId?, deptCode?, page?, pageSize?`. Response: `account, range, filters, beginningBalance, endingBalance, periodDebitActivity, periodCreditActivity, lines[], pagination`. Export: `GET .../activity:export` (real, CSV).
- **Reusable components:** none exist.
- **Visual gaps:** the legacy `GLInquiry.tsx` prototype has substantial unrelated UI (multi-GL inquiry, saved view prefs, system-config-driven date presets) that doesn't correspond to the real S220 contract at all.
- **Interaction/missing-states gaps:** no real screen exists to evaluate against the design's states (loading/empty/error/unauthorized/export/drawer) — this is a build-from-scratch, not a convergence.
- **Unsupported proposals — must not ship:**
  - Design's **"Source" filter** — not in the real `QuerySchema`. Omit.
  - Design's **"Period from / Period to" as two independent month pickers** — the real API takes `startDate`/`endDate` (day-level) or `periodCode`/`preset`, not a from/to month pair. Must be adapted to the real shape, not copied literally.
  - Design's drawer note flags "whether the inquiry detail payload returns full journal lines or only the matching line" as `API_CONFIRMATION_REQUIRED` — **unresolved**, tracked as UXMAP-06 in the prior mapping pass (S217 journal-detail response shape not verified). Must confirm before wiring "Open journal entry" from the drawer.
  - Design's **cross-fiscal-year range error** is speculative — the real error surface is `RANGE_REQUIRED / RANGE_CONFLICT / INVALID_RANGE / UNKNOWN_PRESET / ACCOUNT_NOT_FOUND / PERIOD_NOT_FOUND`, none of which is literally "crosses a fiscal year boundary." Use the real codes.
  - **Export IS supported** (unlike GL Search) — keep it, CSV only.
- **Implementation sequence position:** first, per the explicit Phase A ask — this both fixes the "routed screen still calls a legacy endpoint" defect and gives GL Search and Trial Balance a real drill-through target.

---

## Screen 4 — Trial Balance (S014/S222)

- **Existing route/component:** `/golden-path/trial-balance` → `TrialBalance.tsx` (real, correct). A second, legacy-wired duplicate also lives at `/accounting/reports/gl-trial-balance` → `GLTrialBalance.tsx` (calls a different, older endpoint; has a broken export button calling a nonexistent route; has a dead department filter — all previously logged as UXMAP-14).
- **Real API mapping:** `GET /api/v1/gl/reports/trial-balance` — `entity, store?, dept?, asOf`. Response: `{scope, accounts[], drSum, crSum, delta}`, row = `accountId, accountCode, accountName, accountType, normalBalance, priorBalance, currentAmount, endingBalance, debitBalance, creditBalance`. **No server export endpoint** — current CSV export is 100% client-side.
- **Reusable components:** none exist yet.
- **Visual gaps:** plain table, no context bar, no export menu, no drawer (current drill-through is an inline expanding panel, not a slide-out drawer).
- **Interaction gaps:** drill-through works (post-fix) but renders only a one-line summary (`beginningBalance`/`endingBalance`/line count), not the design's richer per-transaction table.
- **Unsupported proposals — must not ship:**
  - Design's **separate "Period debit" / "Period credit" columns** — the real API has only one net `currentAmount` field for period activity; the debit/credit split only exists for the **ending** balance (`debitBalance`/`creditBalance`). The design's 8-column layout (Opening / Period debit / Period credit / Ending debit / Ending credit) cannot be built as literally drawn — must use Opening / Activity (net) / Ending debit / Ending credit, matching what the API actually returns.
  - Design's **"out of balance" state still renders the table** with a warning banner and a red difference total. The **real backend fails closed** — `StructuralImbalanceError` is thrown before any row is built, so the real screen has no rows to show, only the imbalance payload (`drSum`/`crSum`/`delta`). The current `TrialBalance.tsx` already implements this correctly (banner replaces the table entirely) — **do not change it to match the design's more permissive mockup.**
  - Design's **Excel/PDF export options** — no server export exists at all yet (client CSV only). See Phase D below.
  - Design's **"Suppress zero balances"** is already implemented client-side, matching the design exactly — no gap.
- **Implementation sequence position:** after GL Inquiry (for a proper drawer-based drill-through instead of the current inline panel).

---

## Screen 5 — Balance Sheet (S227)

- **Existing route/component:** `/golden-path/balance-sheet` → `BalanceSheet.tsx`. Real, correct, well-tested.
- **Real API mapping:** `GET /api/v1/gl/reports/balance-sheet` (+ `/export`, real CSV) — `entity, store?, dept?, asOf`. Response: `{scope, assets, liabilities, equity, totalLiabilitiesAndEquity, excludedAccounts[], reconciledToTrialBalance}`. Errors: `STRUCTURAL_IMBALANCE`, `UNCLASSIFIED_ACCOUNT_TYPE` — both already correctly implemented with the real plural `accounts[]` shape.
- **Reusable components:** none exist yet, but this screen's current implementation is already the most contract-accurate of the five.
- **Visual gaps:** plain table with inline styles instead of the design's grouped `StatementTable` (section headers + subtotal rows), no context bar, no drawer.
- **Unsupported proposals — must not ship (explicit in both the design's own flags and the user's instruction):**
  - **Comparative / prior-period column + Change column** — confirmed absent from the real API (rollup contract §7 explicitly scopes it out). The design itself flags this as `PRODUCT_DECISION_REQUIRED + API_CONFIRMATION_REQUIRED` and says it "must not ship until the certified report contract confirms it" — the contract does not. **Omit.**
  - **"Rounding" filter** — not in the real `FSQuerySchema`. Omit.
  - Design's SME-open question — "suppress the statement or show it with an explicit difference line" on imbalance — **is already answered by the shipped backend**: it fails closed (`STRUCTURAL_IMBALANCE`, no data returned), and the current screen correctly suppresses. This decision is effectively pre-resolved by certified behavior, not an open UI choice.
  - Design's drawer flags "which accounts roll into each line" as `API_CONFIRMATION_REQUIRED` — **resolved**: the real API has no aggregation at all; every `FSRow` is exactly one account (`accountCode` on the row itself). Drill-down is a direct 1:1 mapping, not a lookup.
  - **Export IS supported**, CSV only (not Excel/PDF as the design's generic menu shows).
- **Implementation sequence position:** after GL Inquiry (for drill-down) and Trial Balance (shares patterns).

---

## Screen 6 — Income Statement (S227)

- **Existing route/component:** `/golden-path/income-statement` → `IncomeStatement.tsx`. Real, correct.
- **Real API mapping:** `GET /api/v1/gl/reports/income-statement` (+ `/export`, real CSV) — same shape family as Balance Sheet. `{scope, revenue, expense, netIncome, excludedAccounts[]}`. Only error: `UNCLASSIFIED_ACCOUNT_TYPE` (confirmed — `STRUCTURAL_IMBALANCE` is a Balance-Sheet-only condition, never thrown by `getIncomeStatement()`).
- **Unsupported proposals — must not ship (explicit user instruction, and consistent with the design's own uncertainty flags):**
  - **Year-to-date column** — confirmed absent from the real API; contract explicitly scopes it out.
  - **"% of revenue" column** — confirmed absent; design itself flags it `SME_DECISION_REQUIRED — is this a certified figure or a UI convenience that should be removed?`, and no certified figure exists. **Omit.**
  - Design's **"unmapped account" error framing** — the real condition is `UNCLASSIFIED_ACCOUNT_TYPE` (an unrecognized `accountType`, not a "not mapped to a statement line" concept) — use the real error contract's language and the real plural `accounts[]` shape, which the current screen already does correctly.
  - **Export IS supported**, CSV only.
- **Implementation sequence position:** alongside Balance Sheet — identical patterns per the design's own note ("deliberately identical to the Balance Sheet in every pattern").

---

## Routing decision (flagged, not resolved)

The design proposes new routes for every report screen (`/accounting/general-ledger/search`, `/accounting/general-ledger/inquiry`, `/accounting/general-ledger/trial-balance`, `/accounting/financial-reports/balance-sheet`, `/accounting/financial-reports/income-statement`) under a restructured nav rail (General Ledger / Financial Reports / Organization Setup / Security and Roles / Audit). The design had no visibility into this repository's real routes when it was authored.

Current certified routes (`/golden-path/gl-search`, `/golden-path/trial-balance`, `/golden-path/balance-sheet`, `/golden-path/income-statement`) are hardcoded into the passing Playwright golden-path suite (`tests/e2e/golden-path.spec.ts`). **Recommendation:** keep the existing goldenpath routes and do not adopt the design's proposed route/nav restructuring in this pass — that would require rewriting the certified E2E suite and touches the whole app shell, well beyond screen-level convergence. This is a call worth confirming with you before proceeding, not something I'm deciding unilaterally.

## Proposed implementation sequence (screen at a time, per `CLAUDE_CODE_INSTRUCTION.md`)

1. ~~Fix S220 preset defect~~ — **done** this session.
2. Build the shared visual component set once (`ReportScreen`-equivalent shell, `FinancialDataTable`, `MoneyCell`, `StatusBadge`, `LoadingState`/`EmptyState`/`ErrorState`/`UnauthorizedState`, `ExportMenu`, `DetailDrawer`) as real TypeScript/React components under `apps/web/src/components/accounting/`, styled to section 01's tokens — so the 5 report screens share one implementation instead of 5 duplicated ones.
3. GL Inquiry — new screen wired only to the real, supported S220 fields; rewire `/accounting/inquiry/gl` to it; retire the legacy prototype's use of the gl-service endpoint.
4. Playwright: the Phase-A drill-through assertions (200 / correct account / correct period / journal line appears / dr↔cr match the TB source row).
5. GL Search — expand to the real full filter set, wire row-level drill-through, build the (design-absent) saved-search CRUD UI.
6. Trial Balance — adopt the shared shell and real-field columns, upgrade drill-through to the shared drawer.
7. Balance Sheet, then Income Statement — adopt the shared shell, add real accountCode-based drill-down, keep both single-period only.
8. Journal Entry — separate, later pass (out of this Phase A–E scope).

I'm stopping here for your confirmation on the routing decision and the sequence before writing more code, per your PAUSE and per `CLAUDE_CODE_INSTRUCTION.md`'s own "return the comparison first" instruction.
