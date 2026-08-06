# Golden R0 — Demonstration Script

Branch: `golden-r0-ui-convergence`
Purpose: two persona-specific, repeatable, live-stack walkthroughs —
**Part A (Product)** and **Part B (Accounting SME)** — for Golden R0
acceptance sessions. Every step is real (real API, real PostgreSQL, real
auth/authz, real audit); nothing is mocked or hand-waved.

Design-review basis: the **approved Claude Design / Golden R0 design
source-of-truth review**
(`docs/accounting-modernization/ux/golden-r0/claude-design/DESIGN_SOURCE_OF_TRUTH.md`).
Figma is not part of this acceptance package and is not a release gate.

## Prerequisites

- Docker containers running: Postgres (`localhost:45433`), RabbitMQ
  (`localhost:45673`), Redis.
- Backend services running (api-gateway `13100`, gl-service `13020`,
  auth-service, coa-service, tenant-service, etc.).
- Frontend dev server running on `http://localhost:5199` (NOT `5174` —
  that port is confirmed occupied by an unrelated project on this
  environment; see `KNOWN_LIMITATIONS_REGISTER.md` row 9).
- **Read-only login** (certified dataset, used for GL Search / Trial
  Balance / Balance Sheet / Income Statement / GL Inquiry viewing only):
  tenant `1cf31f14-cb0b-4261-a41d-f79953594c86` ("Kunes Auto Group" / legal
  entity `KUNES-01`), `admin@kunes-final-r0.test` / `FinalR0-Evidence-2026!`.

## Safe demonstration environment — mandatory

**Any journal posting, reversal, or deliberately-imbalanced/unclassified
fixture in a live acceptance session must run only against an isolated
acceptance tenant or a disposable certification stack — never against the
shared certified tenant (`1cf31f14…`) above.** That tenant's data is
reused across every Golden R0 certification pass; hand-mutating it during
a demo would corrupt the evidence trail for everyone else.

- **Isolated acceptance tenant:** before a live session, create (or reuse,
  if one already exists for this acceptance cycle) a separate tenant —
  e.g. via the real Legal Entity creation flow used in Golden Path step 1
  below, under a distinct tenant ID/name such as "Golden R0 Acceptance
  Demo." All live writes (draft → validate → post → reverse, and any
  intentionally-unbalanced or unclassified-account fixture) happen only in
  this tenant.
- **Negative / structural scenarios:** do not hand-craft a structural
  imbalance or an unauthorized-access attempt against the shared certified
  dataset. Existing recorded evidence already proves these scenarios:
  - Show the existing Playwright report (14/14 passing,
    `tests/e2e/golden-path.spec.ts` + `tests/e2e/golden-path-negative.spec.ts`),
    or
  - Re-run it live, in front of the reviewer, in headed mode — this
    creates and tears down its own scratch fixtures without touching the
    shared tenant:
    `BASE_URL=http://localhost:5199 npx playwright test tests/e2e/golden-path-negative.spec.ts --headed`
- Read-only viewing (GL Inquiry, GL Search, Trial Balance, Balance Sheet,
  Income Statement against already-posted certified data) does not require
  the isolated tenant — it's the write actions that must be isolated.

---

## Part A — Product Walkthrough

1. **Login, entity selection, organization hierarchy.** Login
   (`/golden-path/login`), select legal entity `KUNES-01`
   (`/golden-path/select-entity`), confirm the org hierarchy
   (`/golden-path/org-hierarchy`) loads real store/department data from the
   database, not a static mock.
2. **GL Search and the approved saved-search lifecycle.**
   `/golden-path/gl-search`. Run a real search. Save it (create), confirm
   it appears in the list (list), re-run it (run), then delete it
   (delete). Attempt to save a second search under the same name and
   confirm the real `409` duplicate-name conflict. **State explicitly:**
   this create/list/run/delete/duplicate-conflict set is the complete R0
   saved-search feature — UPDATE/edit is a documented future enhancement,
   not something R0 is waiting on.
3. **Trial Balance and the audited server-side export.**
   `/golden-path/trial-balance`, entity `01`, as-of `2026-02`. Confirm
   accounts foot to a balanced total. Click "Export CSV," confirm a real
   server-generated file and a real `EXPORTED` audit event (see
   `screenshots/golden-r0-certification/03-trial-balance.png`).
4. **Trial Balance → GL Inquiry drill-through, including the truthful
   UXMAP-23 limitation.** Attempt the drill-through from a Trial Balance
   line into GL Inquiry. **State explicitly, before the audience asks:**
   gl-service (Trial Balance/GL Inquiry) and coa-service (Chart of
   Accounts) are separate ledgers for Golden R0 (`ADR-JL-001`), and their
   current fixture data shares no overlapping account numbers, so this
   drill-through honestly reports "no matching account" rather than a
   fabricated match. This is recorded in `DECISION_REGISTER.md` as
   UXMAP-23 — an **accepted R0 limitation, not a permanent one** — with an
   impact statement, an owner placeholder, an R1+ follow-up story
   placeholder, and a target-release placeholder, all pending Product to
   fill in.
5. **Balance Sheet — layout, totals, states, export.**
   `/golden-path/balance-sheet`, same entity/as-of. Confirm the `BALANCED`
   badge, Assets = Liabilities + Equity, the "Reconciled to Trial Balance"
   tie-out, and CSV export with its own audit event (see
   `screenshots/golden-r0-certification/04-balance-sheet.png`).
6. **Income Statement — layout, totals, states, export.**
   `/golden-path/income-statement`, same entity/as-of. Confirm Revenue,
   Expense, Net Income, that Net Income matches the Balance Sheet's
   Current-Period Earnings, and CSV export (see
   `screenshots/golden-r0-certification/05-income-statement.png`).
7. **Consistent loading, empty, unauthorized, and error behavior.** Across
   the screens above, show: a loading state (refresh and observe), an
   honest empty state (e.g. GL Search with no saved searches yet — see
   `screenshots/golden-r0-certification/02-gl-search.png`), an unauthorized
   state (attempt access with a role lacking the relevant permission —
   real `403`, not a client-side hide), and an error state (the isolated
   tenant's structural-imbalance/unclassified-account fixture, or the
   existing Playwright evidence per the safe-demonstration-environment
   section above).
8. **Explicit approval of R0 exclusions and R1 follow-ups.** Walk through
   and get Product's explicit confirmation on each of the following
   already-decided, non-blocking items (none of these are open questions
   R0 is waiting on — they are disclosures for the record):
   - UXMAP-23 (§4 above) — confirm disposition, assign a real owner and
     target release when ready.
   - COST_OF_SALES/DISTRIBUTION scope — R0 preserves the certified S227
     Roll-Up Contract as-is (no Cost of Sales/Gross Profit added,
     fail-closed on unsupported classifications); R1 story **S009**
     (placeholder — not started, not part of R0) is the named follow-up.
   - Saved-search UPDATE — deferred future enhancement, non-blocking.
   - Legacy `GLTrialBalance.tsx` (`/accounting/reports/gl-trial-balance`)
     — still registered, but a separate pre-Golden-R0 surface with known
     defects; retirement/repair is non-blocking technical debt.
   - Comparative periods/YTD, line-item drill-down, %-of-revenue
     (UXMAP-19/20/21) — deferred future-reporting enhancements,
     non-blocking.

---

## Part B — Accounting SME Walkthrough

*All journal writes in steps 1–3 happen in the isolated acceptance tenant
per the safe-demonstration-environment section above — never in the
shared certified tenant.*

1. **Journal validation, post, and reversal in an isolated fixture.**
   Create a balanced draft (Debit `1000 Cash` / Credit `4000 Revenue`,
   e.g. `$500.00`) in the isolated acceptance tenant. Validate it (confirm
   the real balance/dimension check). Post it (confirm it transitions to
   POSTED and a real S007 audit event fires). Reverse it (confirm a new
   reversing journal is created and the original is marked reversed).
2. **GL Inquiry traceability and running balance.**
   `/accounting/inquiry/gl`. Trace the posted line, confirm a correct
   running balance in chronological posting order. *Confirm:* does this
   match how you'd trace an account, or do you expect a different default
   range/sort?
3. **Trial Balance footing and fail-closed structural imbalance.**
   `/golden-path/trial-balance` for the isolated tenant (or the existing
   certified-tenant view for a passing example). Confirm the foot. Then
   show the `STRUCTURAL_IMBALANCE` hard-stop behavior — either via a
   deliberately one-sided fixture in the isolated tenant, or by showing
   the existing Playwright/live-browser evidence per the safe-demo section
   above. *Confirm:* is a hard stop (vs. a suspense/clearing-account
   suggestion workflow) how you expect an out-of-balance condition
   handled?
4. **Balance Sheet identity and Current-Period Earnings presentation.**
   `/golden-path/balance-sheet`. Confirm Assets = Liabilities + Equity and
   review "Current-Period Earnings (included in Equity)" as its own line
   under Equity. *Confirm:* does the label/position match standard
   dealership convention?
5. **Income Statement Revenue, Expense, and Net Income treatment.**
   `/golden-path/income-statement`. Confirm Net Income ties to the Balance
   Sheet. *Confirm:* is the flat Revenue/Expense/Net-Income layout (no
   gross-profit subtotal, no department breakout) sufficient for R0, given
   gross-profit reporting is explicitly deferred to R1 story S009?
6. **Unsupported classification behavior.** Show (in the isolated tenant,
   or via existing Playwright evidence) an account with an unsupported/
   nonconforming classification hard-failing both statements
   (`500 UNCLASSIFIED_ACCOUNT_TYPE`) rather than being silently bucketed
   into an existing line.
7. **Audit lifecycle.** Open Audit History for the journal from step 1.
   Confirm the full CREATED → VALIDATED → POSTED → REVERSED chain with
   real actor/timestamp/tenant attribution.
8. **Explicit deferral of Cost of Sales/Gross Profit to R1 S009.**
   State plainly: `COST_OF_SALES`/`DISTRIBUTION` accounts are out of scope
   for both statements in R0 by contract, real dealership ledgers with
   COGS entries will legitimately hit `STRUCTURAL_IMBALANCE` until R1, and
   planned story **S009** (placeholder — not started) is the named,
   not-yet-authorized follow-up. This is a confirmation, not a question R0
   is waiting on an answer to.

---

## Suggested demo duration

Product walkthrough (Part A): 25–30 minutes. Accounting SME walkthrough
(Part B): 20–25 minutes. Add 10–15 minutes for Q&A on each.
