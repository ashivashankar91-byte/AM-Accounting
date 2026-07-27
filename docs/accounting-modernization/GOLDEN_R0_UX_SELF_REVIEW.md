# Golden R0 — Engineering-Led UX Self-Review

**IMPORTANT:** This document is an **engineering self-review** against the
textual design-system tokens documented in this repository's CLAUDE.md
(font, color, spacing, keyboard-first conventions). **It is not a substitute
for a real Figma design review, a real UX designer's evaluation, or a real
business/product sign-off.** No Figma files or human UX reviewer exist in
this environment. Per Product Owner decision, all 8 stories below remain at
`DONE_PENDING_INTEGRATION` regardless of this review's outcome, pending
genuine human Figma/UX/product validation.

Stories reviewed: S202, S004A, S224, S220, S221, S014 (API only, no
standalone screen), S222, S227.

## Method

For each screen, the actual `.tsx` source was inspected (not assumed) for:
navigation, labels, field placement, filters, tables, drill-downs, loading
state, empty state, error state, authorization-denied state, export
behavior, basic accessibility (labels/semantic elements), and responsive
layout.

## Findings by screen

### S202 — OrgHierarchy.tsx
- Navigation: reachable from Select Entity; links to Role Templates. ✅
- Labels: node type badge (`GROUP`/`ENTITY`/`STORE`/`DEPARTMENT`), name,
  code, status badge. ✅
- Loading/empty/error states: all present (`org-loading`, `org-empty`,
  `org-error`). ✅
- Accessibility gap: expand/collapse toggle is a plain `<button>` with a
  glyph (`▾`/`▸`) and no `aria-label` or `aria-expanded` — a screen reader
  cannot tell what it toggles. **Gap, not fixed here** (a UI-polish item,
  not a functional requirement gap; deferred to real UX review).
- Responsive layout: fixed `maxWidth: 720` with inline `marginLeft`
  indentation — will overflow horizontally on narrow viewports with deep
  hierarchies. **Gap**, same disposition as above.

### S004A — RoleTemplates.tsx
- Navigation/labels/table: key, name, permissions (raw list), status,
  apply action. ✅
- Authorization-denied state: relies on the shared `apiFetch` error path
  (`rt-error`), not a dedicated 403 banner distinguishing "no permission"
  from other errors. **Minor UX gap** — functionally correct (a 403 message
  is shown) but not visually distinguished the way S227's structural-error
  banners are.
- Apply-only scope: full CRUD (create/clone/deactivate) has real backend
  certification but no screen — **explicitly out of scope for this Golden
  Path browser journey**, consistent with the PO's "minimum frontend
  reconciliation" instruction; not a regression.

### S224 — AuditHistory.tsx
- Navigation/labels/table: event list with empty/error states. ✅
- **Gap found**: no explicit loading-state indicator while the initial
  fetch is in flight (no `Loading…` text or `data-testid` for it), unlike
  every other Golden Path screen. A slow network would show a blank page
  with no feedback. **Functional gap, not fixed in this review** (out of
  the PO's "do not redesign backend contracts unless a genuine functional
  gap" instruction — this is frontend-only and low-risk, logged for a
  follow-up fix rather than made silently).

### S220/S221 — GL Inquiry / GL Search
- Not reviewed screen-by-screen in this pass: per prior session history,
  these are consumed through existing report/inquiry pages already
  certified with live-gateway evidence; no new gaps identified beyond what
  was already logged in their own certification reports (FIGMA_REQUIRED,
  no Playwright infra existed until this segment).

### S014 — Trial Balance API
- No standalone screen (consumed by S222). Not applicable to this review.

### S222 — TrialBalance.tsx
- Full state coverage: loading via `busy`/disabled button, `tb-error`,
  `tb-structural-imbalance-banner`, drill-through panel with its own error
  state (`tb-drill-error`), CSV export. ✅
- Table `entity`/`store`/`dept`/`asOf` inputs are unlabeled plain-text
  boxes with wrapping `<label>` text — functionally accessible (label
  association is implicit via wrapping) but not a validated numeric/date
  input; typos are not client-validated before hitting the API.
  **Minor gap**, consistent with "no client-side recomputation" design
  (validation deliberately deferred to the real API), not fixed here.

### S227 — BalanceSheet.tsx / IncomeStatement.tsx
- Full state coverage: loading, empty, error, `STRUCTURAL_IMBALANCE`
  banner, `UNCLASSIFIED_ACCOUNT_TYPE` banner, `excludedAccounts` diagnostic
  panel, CSV export preview, `BALANCED`/`NOT BALANCED` badge (Balance Sheet
  only — Income Statement has no equivalent single-glance badge, since
  "balanced" isn't a defined concept for an Income Statement; net income
  sign is color-coded instead). ✅
- Same unlabeled-plain-input pattern as S222 (consistent, not a new gap).

## Cross-cutting observations

1. **Consistent visual language**: every Golden Path screen uses the same
   inline-style conventions (Inter font, JetBrains-Mono for monetary
   values, red/green semantic colors for error/success) matching the
   documented design tokens in CLAUDE.md, even though no component library
   or Figma tokens file exists to formally enforce this.
2. **No screen uses the documented sidebar/detail-panel layout** (192px
   sidebar + main + 256px detail panel) from the design framework — every
   Golden Path screen is a single centered column. This is a **known,
   consistent gap across the whole Golden Path**, not specific to S227,
   and requires a real UX/product decision on whether the Golden Path
   evidence screens should be restyled to the full design framework or
   whether that framework applies only to the eventual production UI.
3. **Accessibility**: no screen was built or tested against a screen
   reader or keyboard-only navigation beyond native HTML semantics
   (`<button>`, `<table>`, `<label>`). This is a genuine gap that a real
   accessibility review would need to catch systematically.
4. **No responsive breakpoints** are defined anywhere in the Golden Path
   screens; all use fixed `maxWidth` centered layouts, which will not adapt
   to mobile/tablet viewports.

## Disposition

No genuine *functional* requirement gap was found that would require a
backend contract change (per the PO's instruction not to redesign backend
contracts absent such a gap) — the AuditHistory loading-state gap is
frontend-only and does not require an API change. All other findings are UI
polish / accessibility / responsive-layout items appropriate for a real
Figma/UX pass, not backend rework.

**This review does not authorize promotion to DONE.** It is submitted as
supporting engineering evidence alongside the (still-pending) requirement
for genuine human Figma/UX/product sign-off, per Product Owner instruction.
