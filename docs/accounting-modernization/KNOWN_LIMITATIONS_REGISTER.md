# Golden R0 — Known Limitations Register

**Status:** Living register, updated at each certification phase closure.
**Last updated:** GOLDEN-R0 Phase 4 (Final Product Closure).

This register consolidates every disclosed, non-fabricated limitation
carried out of Golden R0 into whatever comes next. Nothing here was hidden
during certification; each item links to its full decision record.

| # | Limitation | Scope | Full record |
|---|---|---|---|
| 1 | coa-service and gl-service are separate ledgers; no live cross-service reconciliation or drill-through exists between S013-S219 (coa-service) and S014/S220/S221/S222/S227 (gl-service). | S014, S220, S221, S222, S227 | `decisions/ADR-JL-001_SEPARATE_LEDGER_LIMITATION.md` |
| 2 | Audit-log retention period and WORM (write-once-read-many) tiering beyond the existing application-level immutability trigger are undefined — a real business/compliance decision, not an engineering one. | S007 (BR7-3) | `decisions/UQ-15_AUDIT_RETENTION_WORM.md` |
| 3 | `COST_OF_SALES` and `DISTRIBUTION` account types are explicitly out of scope for the basic S227 Balance Sheet/Income Statement. A real dealership ledger using COGS accounting will legitimately hit `STRUCTURAL_IMBALANCE` until a scoped S227 v2 (or contract amendment) brings COGS into the statement. This is a documented contract-scope limitation, not a defect — see `S227_FINANCIAL_STATEMENT_ROLLUP_CONTRACT.md` (account classification section) and `S227_LIVE_GATEWAY_CERTIFICATION_REPORT.md` §11. | S227 | `S227_FINANCIAL_STATEMENT_ROLLUP_CONTRACT.md`, `S227_LIVE_GATEWAY_CERTIFICATION_REPORT.md` |
| 4 | 502 real historical audit rows in the live `amacc` DB's long-lived tenant-A partition predate the hash-chaining feature and have no `hash_prev`/`hash_self` values. An explicit, human-approved, per-partition `chainVerifiedFrom` cutoff was added and applied so `verifyChain()` disclosively excludes them (`legacyExcluded` count) rather than reporting a false break or silently backfilling immutable rows. | S007 / audit-service | `LEGACY_AUDIT_CHAIN_DECISION.md` |
| 5 | The fresh-database-migration-rebuild proof (Phase 3) and the 12/12 live Playwright Golden Path proof were both independently completed, but not as a single unbroken fresh-stack run in this pass — re-seeding the exact tenant/user/ledger fixtures the Playwright specs require against a brand-new empty database was not attempted under this session's time constraints. Documented as an approved evidence-separation exception, not silently closed. | All 12 Playwright scenarios | `PHASE4_FRESH_STACK_PLAYWRIGHT_EXCEPTION.md` |
| 6 | No real human Figma/UX designer or Product/SME reviewer is available in this environment. An engineering-led self-review (source-code inspection against the documented CLAUDE.md design tokens) was substituted, explicitly labeled as **not** equivalent to real sign-off. Per Product Owner instruction, the 8 affected stories (S202, S004A, S224, S220, S221, S014, S222, S227) remain `DONE_PENDING_INTEGRATION` and are **not** promoted to `DONE`. | S202, S004A, S224, S220, S221, S014, S222, S227 | `GOLDEN_R0_UX_SELF_REVIEW.md`, `STORY_CERTIFICATION_MATRIX.csv` |
| 7 | No real Accounting SME demonstration/acceptance has been performed. Per Product Owner instruction, only a demo script/environment can be prepared without a real SME; final acceptance cannot be fabricated. | Golden R0 release as a whole | `MODULE_STATE.json` (`_meta.phase4Note`) |

## How this register is kept honest

- Every row above is traceable to a dedicated decision document with full
  technical detail, not a bare one-line dismissal.
- No row here represents a promise to fix silently later without a tracked
  follow-up; each dedicated document includes a "recommended next step"
  section where one exists.
- This register is regenerated/reviewed at the close of every certification
  phase, not written once and forgotten.
