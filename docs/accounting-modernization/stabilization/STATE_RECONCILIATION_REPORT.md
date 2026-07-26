# State Reconciliation Report — Phase 1

Reconciles `MODULE_STATE.json`, `CURRENT_RELEASE.md`, actual repository implementation, and the findings in `docs/accounting-modernization/repository-verification/`. This phase corrects status claims; it does not change application behavior (that begins in Phase 2).

## Corrected story classification vocabulary

Per instruction, every story now uses exactly one of: `IMPLEMENTED_UNVERIFIED`, `DONE_PENDING_INTEGRATION`, `DONE`, `PARTIAL`, `BLOCKED`. Verified programmatically (see command below) — all 22 stories' `status` fields are drawn from this set; none use a disallowed value (e.g. the old S201 in-body inconsistency is fixed).

```
$ node -e "... allowed = new Set([...]) ... check every story ..."
All statuses use allowed vocabulary: true
Total stories: 22
```

## Rule applied

> Do not classify a story DONE when it still relies on: local authorization maps, AuditPort stubs, missing live-database verification, missing broker verification, missing tenant-isolation proof, failing service build.

Current repository-verification evidence shows **every one of the 22 stories** fails at least one of these criteria right now (all three services fail `tsc --noEmit`; none has live-database or real-broker verification; 19 of 22 use a local authorization stub; audit is outbox-only or entirely absent). **Zero stories qualify for DONE at this moment.** This is expected — Phase 1 runs before Phases 2–8 close these gaps; Phase 9 re-certifies afterward. `docs/accounting-modernization/repository-verification/STORY_EVIDENCE_MATRIX.csv` and `AUTHORIZATION_AND_AUDIT_VERIFICATION.md` are the evidence base for every correction below.

## Corrections made to `MODULE_STATE.json`

| Story | Before | After | Why |
|---|---|---|---|
| **S200** | `DONE`, `usesStubs: false` | `DONE_PENDING_INTEGRATION`, `usesStubs: true` | Uses the same local `ROLE_PERMISSIONS` stub as every other tenant-service story; tenant-service has zero audit mechanism (not even a stub); tenant-service fails `tsc --noEmit`. `usesStubs:false`/`DONE` was not supportable. |
| **S201** | `DONE` (but `usesStubs:true` and `stubGate:"DONE_PENDING_INTEGRATION"` already present — an internal self-contradiction in the original file) | `DONE_PENDING_INTEGRATION` | The story's own `usesStubs`/`stubGate` fields already disagreed with its `status` field. Corrected to match those fields, S203/S204 (identical pattern, already correctly labeled), and the verification evidence. |
| **S203** | `DONE_PENDING_INTEGRATION` | unchanged | Already correct. |
| **S204** | `DONE_PENDING_INTEGRATION` | unchanged | Already correct. |
| **S205** | `DONE_PENDING_INTEGRATION` | **`PARTIAL`** | The story's own `specDeviations` already admit no login/session-issuance endpoint exists at all — "discarded per packet §7... a follow-up." A user-lifecycle story where a created user cannot authenticate is a materially incomplete acceptance criterion, not merely pending cross-cutting integration. `DONE_PENDING_INTEGRATION` is reserved for stories whose functional scope is complete. |
| **S206** | `DONE_PENDING_INTEGRATION` | unchanged | Already correct — role-routes.ts calls the real `AuthzService`, not a stub; remaining gaps (audit consumer, build, live-DB/broker proof) are genuinely integration-level. |
| **S207** | `DONE`, `usesStubs: false` | `DONE_PENDING_INTEGRATION`, `usesStubs: false` (unchanged) | The engine itself (`AuthzService.check()`) is genuinely real and deny-by-default — `usesStubs:false` for S207's *own* implementation stands. But `DONE` cannot stand: auth-service fails `tsc --noEmit`, deny events go to an unconsumed outbox, and there is no live-database/broker proof. That 19 of 21 *other* stories don't yet call this engine is tracked as their gap in Phase 3's census, not counted against S207 itself. |
| S223, S208–S213, S010, S013, S214–S219 (15 stories) | `DONE_PENDING_INTEGRATION` | unchanged | Already correct — real implementation + passing unit tests, but local-authz-stub, outbox-only audit, no live-DB/broker proof, and (as of this report) a failing coa-service build all correctly keep these below `DONE`. |

## Known contradiction fixed: S013/S214–S219 vs. `CURRENT_RELEASE.md`

Confirmed root cause: `CURRENT_RELEASE.md`'s own header claimed *"To regenerate: `scripts/accounting-release-status.sh`"*, but that script only prints a colored **terminal dashboard** — it has no code path that writes to `CURRENT_RELEASE.md` at all. The file was hand-authored once (2026-07-24, end of R0-ACCOUNTING-SETUP) and never touched again, so it silently fell a full package behind when R0-JOURNAL-LIFECYCLE (S013, S214–S219) was built.

Fix: `scripts/generate-release-doc.js` (new) is a deterministic generator that reads `MODULE_STATE.json` and renders `CURRENT_RELEASE.md` from **every** story in the `stories` object (22, currently) and every entry in `completedPackages`, not just the nominally "active" package — so no future package can be silently dropped from the summary the way R0-JOURNAL-LIFECYCLE was.

```
$ node scripts/generate-release-doc.js
Wrote docs/accounting-modernization/releases/CURRENT_RELEASE.md
```

`CURRENT_RELEASE.md` now lists S013/S214–S219 explicitly (all `DONE_PENDING_INTEGRATION`) and no longer states journal posting is "out of scope."

## Consistency validation command (required deliverable)

`scripts/generate-release-doc.js --check` (also wired as `npm run release:check`): regenerates the expected `CURRENT_RELEASE.md` content in memory from the current `MODULE_STATE.json` and diffs it byte-for-byte against the file on disk. Exits `1` and prints a diagnostic if they disagree; exits `0` if they match.

```
$ npm run release:check
CURRENT_RELEASE.md matches MODULE_STATE.json. OK.
```

This should be added as a required CI check (`package.json` scripts entry `release:check` is now available for that wiring) so `CURRENT_RELEASE.md` can never again drift silently — any future story-status edit to `MODULE_STATE.json` without a corresponding `npm run release:generate` will fail CI.

## What was intentionally *not* done in this phase

- No attempt to make any story `DONE` — that requires Phases 2–8 to actually close the build/authz/audit/tenancy/integration gates first; Phase 9 re-certifies.
- No change to `completedPackages`, `sequence`, `nextEligibleStory`, or any other structural field — only `status`, `usesStubs`, `stubGate` (where warranted), and additive `stabilizationReconciliation` notes were touched, so the full history of prior claims remains visible and auditable rather than being silently overwritten.
- The pre-existing `scripts/accounting-release-status.sh` terminal dashboard was left in place (it is still useful as a live-test/console tool) — it was not deleted, only superseded as the *documentation* generator by `generate-release-doc.js`.

**Verdict for this phase: state reconciliation complete.** `MODULE_STATE.json` and `CURRENT_RELEASE.md` now agree, verifiably, via an automated check.
