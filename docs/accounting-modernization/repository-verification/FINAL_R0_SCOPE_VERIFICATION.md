# FINAL R0 Scope Verification

## Backlog package inspection

`docs/accounting-modernization/AutoMate2_Accounting_Backlog_Package_v1.1.zip` (the exact package `MODULE_STATE.json._meta.sourcePackage` / `backlogPacket` names) was extracted to a scratch directory and inspected. It contains 15 top-level files under `out/`, including `ACCOUNTING_RELEASE_PLAN.md` and a `COPILOT_BUILD_PACKETS/R0/` directory.

`ACCOUNTING_RELEASE_PLAN.md` line 4 states, verbatim:

> `## R0 "Hello, Ledger" (Sprints 1-3, 31 stories)`

`COPILOT_BUILD_PACKETS/R0/` contains exactly **31 story packet files** (one per story, `S200-AUDIT.md` is a 32nd meta-file, not a story packet):

```
S004A S007 S010 S013 S014 S200 S201 S202 S203 S204 S205 S206 S207
S208 S209 S210 S211 S212 S213 S214 S215 S216 S217 S218 S219
S220 S221 S222 S223 S224 S227
```

This independently corroborates **R0 accepted stories = 31** — this is not an unverified Wave 1.2 assertion; it is directly readable from the accepted backlog package the repository itself designates as its source of truth.

## Arithmetic check

- `MODULE_STATE.json`'s `stories` object contains exactly **22 entries** (counted directly: S200, S201, S203, S204, S205, S206, S207, S223, S208, S209, S210, S211, S010, S212, S213, S013, S214, S215, S216, S217, S218, S219).
- 31 (accepted) − 22 (present in MODULE_STATE.json) = **9**.
- The 9 story IDs present in the backlog's 31-story R0 packet set but **absent** from MODULE_STATE.json's 22: **S004A, S007, S014, S202, S220, S221, S222, S224, S227**.
- This is an **exact match** to the 9-story "remaining R0" set the task packet asserts (S007, S202, S004A, S220, S221, S014, S222, S227, S224).

**Verdict: the 31 / 22 / 9 arithmetic is VERIFIED against repository evidence**, not merely restated from an unverified Wave 1.2 document. This is the one place the task's premise checks out cleanly.

Important caveat: "verified" here means the *count and story-ID set* are internally consistent between the backlog package and MODULE_STATE.json. It says nothing about whether the 22 "done" stories are actually production-complete — see `STORY_EVIDENCE_MATRIX.csv` and `REPOSITORY_CONTRADICTIONS.md` for why most of them are not, despite passing this arithmetic check.

## Per-story status of the 9 "remaining" stories

Repo-wide grep (`docs/`, `services/*/src`, `services/*/tests`, `apps/web/src`) for each ID, excluding its own backlog-packet filename and this verification's own output files:

| Story | Grep hits outside backlog packet/this report | Classification |
|---|---|---|
| S007 | Only as a dependency-name string inside other stories' `stubGate`/`carryForwardIntegrations` fields (see `AUTHORIZATION_AND_AUDIT_VERIFICATION.md`). No S007-specific implementation, migration, or test file exists. | **NOT_STARTED** |
| S202 | No hits anywhere in `docs/` or `services/`. | **NOT_STARTED** |
| S004A | Referenced only inside other stories' `knownLimitations` text ("masked-role paths... until S207" — S004A is presumably the field-masking story S217 stubs toward). No implementation. | **NOT_STARTED** |
| S220 | No hits. | **NOT_STARTED** |
| S221 | No hits. | **NOT_STARTED** |
| S014 | No hits. | **NOT_STARTED** |
| S222 | No hits. | **NOT_STARTED** |
| S227 | No hits. | **NOT_STARTED** |
| S224 | No hits. | **NOT_STARTED** |

None of the 9 have any partial code, route, or test in the repository. None are DEPENDENCY_BLOCKED in the sense of "code exists but can't run" — they simply have not been started. (Whether some are logically dependency-blocked on S007/S207 wiring is a scope question for Product Owner planning, not a repository-evidence question.)

## GOLDEN-R0 exit criterion — not yet addressed by any of the 22 "done" stories

`ACCOUNTING_RELEASE_PLAN.md` defines R0's actual completion gate, independent of individual story statuses:

> *"EXIT TEST (named): GOLDEN-R0 - full script... (1) create entity/store/departments/user/role; (2) generate FY2026 + open period; (3) seed COA...; (4) draft GJ... -> validate -> post...; (5) five invalid posts rejected...; (6) GL inquiry shows the line...; TB foots; BS balances...; (7) reverse; TB restored... audit tab shows the complete chain."*
> *"CI: GOLDEN-R0 as an automated E2E suite, required check on main."*
> *"RELEASE 0 IS NOT COMPLETE UNLESS GOLDEN-R0 PASSES IN CI AND IN A LIVE STAKEHOLDER DEMONSTRATION."*

No such CI suite exists in this repository: `tests/e2e/` contains 5 specs (`departments`, `stores`, `franchises`, `legal-entity`, `qa-review`), none of which implement the GOLDEN-R0 script (draft→validate→post→GL inquiry→reverse→audit chain). There is no CI workflow file wiring Playwright as a required check on `main` (no `.github/workflows/*` was found referencing `test:e2e` or Playwright — confirmed absent from repo root search). This means **even a fully-correct 31/31 story completion would not satisfy R0's own defined exit criterion today.**

## Carry-forward closure item: REM-S200-E2E-LOCATORS

Grepped the entire repository (`.md`, `.json`) for the literal string `REM-S200-E2E-LOCATORS` — **zero matches**. This specific work-item ID does not exist anywhere in the repository (it is not in `S200-AUDIT_RESULTS_v1.2.md`, not in `DECISION_REGISTER.md`, not in MODULE_STATE.json). It cannot be confirmed as a real, tracked closure item; treat any claim that it is "closed" or "open" as **EVIDENCE_NOT_AVAILABLE**.

## Decision register open items (from `DECISION_REGISTER.md`)

- **UQ-01** (tenant isolation / RLS): marked "RESOLVED → DEC-001 (RLS)" in the register, but RLS does not exist in the repository — see `TENANT_ISOLATION_VERIFICATION.md`. The register's own resolution claim is contradicted by the codebase.
- **UQ-02** (`Tenant.schemaName` vestigial field): OPEN, tracked as WI-S200-07 — not addressed.
- **UQ-03** (Legal Entity update HTTP contract, PATCH vs PUT): OPEN — PO decision needed.
- **UQ-04** (soft reactivation path for deactivated legal entities): OPEN — PO decision needed.
- **UQ-05** (bi-temporal / effective-dated model): OPEN — PO decision needed.

## Verdict

**FINAL_R0_SCOPE_VERIFIED** — the 31-accepted / 22-done / 9-remaining count and ID set are confirmed against the backlog package. This verdict is narrowly about the arithmetic; it is not a statement that R0 is ready to close (it is not — see `FINAL_R0_SCOPE_VERIFICATION.md`'s GOLDEN-R0 finding above and `REPOSITORY_CONTRADICTIONS.md`).
