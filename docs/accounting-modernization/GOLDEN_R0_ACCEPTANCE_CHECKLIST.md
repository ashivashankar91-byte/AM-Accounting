# Golden R0 — Final Acceptance Checklist

Branch: `golden-r0-ui-convergence`
Prepared: 2026-07-28, as part of the R0 Final Closure Checkpoint. Revised
2026-07-28 to correct several items that had been mischaracterized as open
R0 decisions.

This is the single checklist Product/Engineering use to track what is
required to move the 8 remaining `DONE_PENDING_INTEGRATION` stories to
`DONE` and close Golden R0. It does not restate the technical evidence
already recorded in `STORY_CERTIFICATION_MATRIX.csv`,
`GOLDEN_R0_FINAL_CERTIFICATION_REPORT.md`, or the per-story
`*_LIVE_GATEWAY_CERTIFICATION_REPORT.md` files — it tracks only what is
**still outstanding**.

**Design-review basis:** Golden R0's design gate is the approved **Claude
Design / Golden R0 design source-of-truth review**
(`docs/accounting-modernization/ux/golden-r0/claude-design/DESIGN_SOURCE_OF_TRUTH.md`),
whose own design precedence order places it above the current frontend
implementation and below the accepted Story Contract and certified
backend/API behavior. That package itself flags comparative columns, YTD,
percent-of-revenue, and some drill-down details as **must not ship unless
supported by certified contracts** — which is exactly why those items are
recorded below as deferred, non-blocking enhancements rather than shipped
features. Figma is not part of this acceptance package and is not
introduced as a release gate.

## Engineering / technical certification — COMPLETE

- [x] Backend `tsc --noEmit` clean: coa-service, gl-service, auth-service,
      tenant-service, audit-service, api-gateway
- [x] `apps/web` `tsc --noEmit` clean
- [x] `apps/web` production build succeeds
- [x] Service test suites green (827 passed / 0 failed / 10 documented
      LIVE_DB-gated skips across coa/gl/auth/tenant/audit-service)
- [x] Golden Path Playwright suite 14/14 (`golden-path.spec.ts` +
      `golden-path-negative.spec.ts`), run against the authoritative stack
      (frontend `5199`, gateway `13100`) — not port `5174`
- [x] Structural-imbalance and unclassified-account negative scenarios
      proven fail-closed (unit + Playwright)
- [x] Cross-tenant / cross-store / cross-department isolation proven
      (RLS + application-layer tests + Playwright)
- [x] Report-export audit evidence proven (Trial Balance / Balance Sheet /
      Income Statement CSV export, real `EXPORTED` audit rows, no audit row
      on failed export)
- [x] Screenshots captured live from the running stack (5 files,
      `screenshots/golden-r0-certification/`)
- [x] Accepted commit sequence indexed per screen
      (`GOLDEN_R0_ACCEPTED_COMMIT_SEQUENCE.md`)
- [x] Saved-search R0 scope (create/list/run/delete + duplicate-conflict)
      live-verified; UPDATE correctly recorded as a deferred, non-blocking
      future enhancement, not an open R0 decision
- [x] Legacy `GLTrialBalance.tsx` correctly recorded as a separate,
      non-blocking legacy surface (still registered in the router, but not
      the certified Golden R0 Trial Balance screen)
- [x] R0 preserves the certified S227 Roll-Up Contract as-is; unsupported/
      nonconforming classifications fail closed; Cost of Sales/Gross Profit
      deferral to planned R1 story S009 (placeholder, not started) recorded
      and not silently absorbed into R0
- [x] UXMAP-23 recorded as an accepted, owned, time-bound R0 limitation
      (impact statement, owner placeholder, R1+ follow-up story
      placeholder, target-release placeholder, no-fabrication statement) —
      not framed as permanent

## Still outstanding — NOT fabricable by engineering

- [ ] **Real Product sign-off / confirmation session** on the items in
      `GOLDEN_R0_FINAL_CERTIFICATION_REPORT.md` §6 — these are framed as
      confirmations of already-decided, non-blocking dispositions (UXMAP-23
      owner/target-release assignment, COST_OF_SALES/S009 deferral,
      saved-search UPDATE deferral, legacy TB screen disposition,
      comparative/drill-down/%-of-revenue deferral), not as open gates.
- [ ] **Real Accounting SME sign-off / confirmation session** on the items
      in `GOLDEN_R0_FINAL_CERTIFICATION_REPORT.md` §7 (Current-Period
      Earnings presentation, fail-closed balance/classification model,
      Income Statement subtotal structure given the S009 deferral, GL
      Inquiry default range/sort).
- [ ] **Named owner, R1+ story ID, and target release** for UXMAP-23,
      currently placeholders pending Product assignment.
- [ ] **Formal release sign-off statement** executed (draft below) once the
      above two acceptance sessions occur.

## Story-level gate (8 of 31 stories)

| Story | Screen/Capability | Technical DoD | Blocking gap |
|---|---|---|---|
| S220 | GL Account Activity Inquiry | Complete | Product/SME acceptance only |
| S221 | GL Search + saved searches (create/list/run/delete) | Complete | Product/SME acceptance only |
| S014 | Trial Balance API | Complete | Product/SME acceptance only |
| S222 | Trial Balance Screen & Export | Complete | Product/SME acceptance only |
| S227 | Balance Sheet & Income Statement | Complete | Product/SME acceptance only |
| S224 | Audit History View | Complete | Product/SME acceptance only |
| S202 | Org Hierarchy View & Maintenance | Complete | Product/SME acceptance only |
| S004A | Dealership Position Role Templates | Complete | Product/SME acceptance only |

None of the 8 have an open technical, security, or data-integrity gap. The
sole remaining gate for all 8 is real human Product/Accounting-SME
acceptance — this cannot be closed by engineering self-certification.

## Release sign-off statement (proposed — do not backdate or pre-sign)

> Golden R0 (GL Inquiry, GL Search, Trial Balance, Trial Balance export,
> Balance Sheet, Income Statement, and the shared Accounting UI Foundation)
> is technically complete and independently re-certified on
> `golden-r0-ui-convergence` as of 2026-07-28: all relevant backend/frontend
> type checks pass, 827 service-level tests pass with 0 failures (10
> documented, non-blocking skips), the production build succeeds, and the
> full 14-test Golden Path Playwright suite passes against the authoritative
> dev stack. UXMAP-23 (gl-service/coa-service account-number overlap) is
> accepted as an R0-scope architecture/data limitation — not a permanent
> one — with an owner, R1+ follow-up story, and target release to be
> assigned by Product. R0 preserves the certified S227 Roll-Up Contract
> as-is; Cost of Sales and Gross Profit are explicitly deferred to planned
> R1 story S009 (placeholder, not started) and are not part of this
> release. This statement certifies technical readiness only; it does not
> constitute Product or Accounting SME acceptance, which remain the
> explicit precondition for promoting S220, S221, S014, S222, S227, S224,
> S202, and S004A from `DONE_PENDING_INTEGRATION` to `DONE`.
