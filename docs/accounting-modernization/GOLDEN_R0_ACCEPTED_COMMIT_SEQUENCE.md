# Golden R0 — Accepted Commit Sequence Per Screen

Branch: `golden-r0-ui-convergence`
Recorded: 2026-07-28, as part of Final Golden R0 Certification Preparation.

This document is the single source of truth for "which commits, in which
order, constitute the accepted implementation" of each Golden R0 screen. It
does not replace the detailed narrative evidence already recorded in
`MODULE_STATE.json` / `STORY_CERTIFICATION_MATRIX.csv` / the per-story
`*_LIVE_GATEWAY_CERTIFICATION_REPORT.md` files — it is a compact index into
that evidence, requested explicitly for final certification.

All commit hashes below are on `golden-r0-ui-convergence` and can be
inspected with `git show <hash>` or `git log -p <hash> -1` from this
worktree.

## GL Inquiry (S220)

| Order | Commit | Summary |
|---|---|---|
| 1 | `4cededd` | GL Inquiry service — catalog permission + core service logic |
| 2 | `524f211` | GL Inquiry HTTP routes, DI wiring, and test coverage |
| 3 | `859238d` | Live-gateway certification report and status updates |
| 4 | `a082eeb` | Correct test-evidence claim from 294/299-with-skips to genuinely 299/299 |
| 5 | `f0f4bff` / `52f85fc` | Rewire frontend GL Inquiry screen to the real S220 API; strengthen TB drill-through proof |
| 6 | `ed79d52` | Fix: GL Inquiry journals tab — use `journal_lines` not period summaries |
| 7 | `197213c` | Fix: GL Inquiry data, Trial Balance crash, Schedule Inquiry, and related UX fixes |

Route: `/accounting/inquiry/gl` (not `/golden-path/gl-inquiry` — no such route
exists; this is the real, reachable path, confirmed live and used for the
certification screenshot below).

## GL Search (S221)

| Order | Commit | Summary |
|---|---|---|
| 1 | `247da61` | Saved-search schema + auth-service permission migration |
| 2 | `cb28b72` | GLSearchService, routes, DI wiring, unit + authz tests |
| 3 | `5138a17` | Live-gateway certification report + status docs |
| 4 | `8bb96b0` | Real S007 audit coverage for saved-search CRUD |
| 5 | `825af5f` | Minimal GL Search frontend screen for Golden Path |
| 6 | `72800aa` | Implement S221 GL Search + saved searches against the real API (frontend refinement) |

Route: `/golden-path/gl-search`.

## Trial Balance API (S014) + Trial Balance Screen & Export (S222)

| Order | Commit | Summary |
|---|---|---|
| 1 | `b6fe7cc` | Add S014 auth permission |
| 2 | `1c63363` | Implement S014 trial balance service |
| 3 | `11e5797` | Add S014 proof and regression tests |
| 4 | `9024976` | Document S014 certification evidence |
| 5 | `7b30897` | S014 audit-metadata correction (reportType/entityId/storeId/departmentId) |
| 6 | `d4d19a4` | S222 — Trial Balance Screen consuming the real S014 gl-service API |
| 7 | `0648b41` | S222 certification report and tracking updates |
| 8 | `abf6804` | Trial Balance visual refinement (shared components, real fields) |
| 9 | `8a84244` | Trial Balance server-side audited export proposal (doc) |
| 10 | `8f8b6b3` | Trial Balance uses the real server-side audited export (implementation) |
| 11 | `f71e5aa` | Dedicated Trial Balance export success/failure Playwright coverage |

Route: `/golden-path/trial-balance`.

## Balance Sheet (S227 — BS half)

| Order | Commit | Summary |
|---|---|---|
| 1 | `176314f` | S227 Balance Sheet & Income Statement backend implementation |
| 2 | `0173dd8` | S227 Balance Sheet & Income Statement frontend screens |
| 3 | `b430353` | S227 certification report and tracking-doc updates |
| 4 | `eeda969` | Financial Statement Roll-Up Contract, proven against real data |
| 5 | **`eb6a5bd`** | **Accepted refinement:** Balance Sheet export missing TB-level `StructuralImbalanceError` catch — backend defect correction and tests |
| 6 | **`7f3e857`** | **Accepted refinement:** Balance Sheet frontend — shared components, full state coverage, real server export |
| 7 | **`03abea8`** | **Accepted refinement:** live-browser proof of Balance Sheet TB-level `STRUCTURAL_IMBALANCE` handling |

Route: `/golden-path/balance-sheet`.

## Income Statement (S227 — IS half)

| Order | Commit | Summary |
|---|---|---|
| 1 | `176314f` | S227 Balance Sheet & Income Statement backend implementation (shared with BS) |
| 2 | `0173dd8` | S227 Balance Sheet & Income Statement frontend screens (shared with BS) |
| 3 | `3791468` | Extend Playwright `golden-path.spec.ts` to full 16-step journey + fix real Income Statement crash (the `reconciledToTrialBalance.drSum` undefined-read crash) |
| 4 | **`d27c938`** | **Accepted refinement:** Income Statement route correction (both `StructuralImbalanceError` and `FSStructuralImbalanceError` catches) and live-database proof |
| 5 | **`ce05880`** | **Accepted refinement:** Income Statement frontend refinement and governed UI states |
| 6 | **`7e9bf8d`** | **Accepted refinement:** Playwright live-browser verification of Income Statement structural-imbalance handling |

Route: `/golden-path/income-statement`.

## Shared Accounting UI Foundation

| Commit | Summary |
|---|---|
| (introduced alongside `7f3e857`) | `apps/web/src/components/goldenpath/shared.tsx` — `MoneyCell`, `Banner`, `LoadingState`, `EmptyState`, `ErrorState`, `UnauthorizedState`, `formatMoney` — first adopted by Balance Sheet, then Income Statement (`ce05880`), forming the shared foundation for both financial-statement screens. |

## Cross-cutting Playwright infrastructure

| Commit | Summary |
|---|---|
| `3791468` | `tests/e2e/golden-path.spec.ts` extended to the full 16-step positive journey (login → entity → org hierarchy → role template → fiscal → journal → GL Inquiry → GL Search → Trial Balance → Balance Sheet → Income Statement → export → reverse → audit) |
| (golden-path-negative.spec.ts, pre-existing + extended by `03abea8`/`7e9bf8d`) | Negative/control-plane scenarios: unauthorized role, unbalanced journal, duplicate posting, invalid reversal, unclassified account type, structural imbalance (TB/BS/IS), expired/revoked session |

**Current full suite result:** 14/14 passing (`golden-path.spec.ts` + `golden-path-negative.spec.ts`), re-verified 2026-07-28 as part of final certification prep, from a clean working tree on `golden-r0-ui-convergence`.
