# S008 — Fiscal Period Close, Reopen and Lock Control: Certification Report

**Branch**: `r1-s008-period-close-control`
**Date**: 2026-07-28
**Status**: `TECHNICALLY_CERTIFIED_PENDING_PRODUCT_SME_ACCEPTANCE` — PO checkpoint
"PRODUCT CHECKPOINT — S008 TECHNICAL CERTIFICATION ACCEPTED" (2026-07-28),
accepted commits `ce35c3f`, `762e2b4` (see §9). Moved from
`IMPLEMENTED_PENDING_CERTIFICATION`. Accepted for engineering implementation
and technical certification only — see §7 for the remaining disclosed,
scoped-out gap and §9 for the Product/Accounting SME acceptance items still
open.

## 1. What this pass covered

Continuing from an `IMPLEMENTED_PENDING_CERTIFICATION` state, per the Product
Owner's "PRODUCT DECISION — S008 CONTRACT RECONCILIATION" instruction: first
reconcile the P01 contract text against the actual implemented (and
previously PO-approved) behavior, keep that contract correction separate
from any production-code change, then complete the remaining certification
checklist — concurrency/idempotency, RLS-negative, live-code PostingService
proof, gateway authorization, the P01-designed frontend, Playwright, and this
summary.

## 2. Contract reconciliation (docs only — commit `fd636f3`)

`P01_STORY_CONTRACTS.md` §S008 was rewritten to describe the implemented,
already-migrated production design directly (marked `IMPLEMENTED_CONTRACT_V1`
for this story only), replacing the earlier `PROPOSED_CONTRACT_V1` text that
had diverged from it. Confirmed and preserved, per the PO's explicit
instruction:

- `LOCKED` is terminal — no unlock operation exists at any layer.
- `HARD_CLOSED → SOFT_CLOSED` is not being built, despite appearing in the
  proposed contract.
- The two-tier reopen model (`fiscal.period.reopen` for `SOFT_CLOSED→OPEN`,
  Controller+Admin; `fiscal.period.reopen_hard_closed` for `HARD_CLOSED→OPEN`,
  Admin-only) and its permission keys are canonical.
- Reopen's mandatory-reason + distinct-audit-event behavior is preserved.
- The repository's permission keys (`soft_close`/`hard_close`/`reopen`/
  `reopen_hard_closed`/`lock`, no `unlock`) are canonical.

`P01_REPOSITORY_VERIFICATION_RECONCILIATION.md` §2 was closed out to match
(BLK-27 marked resolved; status tables, permission mapping, and next-steps
sections updated). BR008-6 (sequential close — hard-close blocked by an
earlier open period) is explicitly flagged as **not implemented and not
resolved either way** — a genuine open item carried forward, not silently
decided.

No production behavior was changed to match the obsolete proposed contract.

## 3. Production code (commit `1a1cf50`)

Finished the in-progress BR008-5 work (hard-close blocked by open drafts,
`422 HARD_CLOSE_BLOCKED_BY_DRAFTS` with a named worklist) and the board's
open-drafts/last-transition enrichment. A real defect was found and fixed
while wiring this up: `board()` queried `reason`/`actorId` fields that do not
exist on the `FiscalPeriodTransition` Prisma model (that table is
DB-trigger-owned and deliberately carries no `reason` — see the code
comment in `period-service.ts`). This was a genuine `tsc` error
(`TS2353`/`TS2551`) invisible to `npm test` because that suite mocks Prisma
and never validates field names against the real schema. Fixed by sourcing
the board's `lastTransition` summary from the S007 audit outbox instead
(which already carries `reason` and `actor`) — no new migration needed.

## 4. Certification checklist

| Item | Evidence | Result |
|---|---|---|
| Concurrency | `tests/live-db/period-close-live.test.ts` — two genuinely concurrent transition attempts on the same period (10-way soft-close race, 2-way hard-close race), against real Postgres row locking | Exactly one real transition/audit row per race, every time; losers get a legitimate `InvalidTransitionError` or a no-op-success, never a corrupted double-transition |
| Idempotency | Same file — retrying an identical transition after it already landed | No-op success, zero new transition/audit rows |
| DB trigger backstop | Same file — raw-SQL bypass attempts (skip transition, transition out of `LOCKED`, missing actor context) | `AMPR0`/`AMPR5`/`AMPR4` all correctly rejected, independent of the application layer |
| RLS-negative | Same file — real `amacc_app` connection against `fiscal_period_transition`/`adjusting_entry_attestation` | Tenant-scoped SELECT, deny-by-default with no context, no direct INSERT/UPDATE/DELETE, no `SET ROLE amacc_period_ledger_writer` from the app role |
| PostingService proof (BLK-05) | Same file — real `PostingService.post()` calls, not raw SQL | OPEN succeeds; `SOFT_CLOSED` non-adjusting rejected at the app layer; `SOFT_CLOSED` + valid attestation succeeds end-to-end; **`SOFT_CLOSED` + `isAdjusting=true` with NO attestation passes the app-layer evaluator but is still rejected by the DB trigger (AMPR6)** — the load-bearing proof that the DB is a genuine backstop, not a mirror; `HARD_CLOSED`/`LOCKED` rejected |
| Route-level authz-guard | `tests/authz-guard-integration.test.ts` (extended, commit `25319cd`) | 102/102 passing: 401/403-deny-by-default/allow/cross-tenant for all five S008 permissions, plus a dedicated class proving CONTROLLER is denied the two ADMIN-only permissions despite holding the other three |
| Live gateway authorization | `docs/accounting-modernization/S008_LIVE_GATEWAY_CERTIFICATION_REPORT.md` (commit `1ea0a6a`) | Real curl session through a freshly started gateway/auth-service/coa-service (this branch's own code): full lifecycle, both permission tiers actually denying/allowing (not just documented), two-step confirm semantics, terminal enforcement, and the resulting real S007 audit trail (7 rows, exact action names/actors/reasons) |
| Frontend (P01-SCR-01) | `apps/web/src/pages/accounting/admin/PeriodControl.tsx` at `/accounting/admin/periods` (commit `1ea0a6a`) | Timeline strip + period table + ceremony panels, Foundation V1 styled; typed-confirmation destructive pattern for hard-close/lock; driven live in a real browser against a real backend (login, open, soft-close, typed-confirm hard-close, resulting action set all exercised and correct — including a real gap this testing caught and fixed: FUTURE periods initially had no Open action) |
| Playwright | `tests/e2e/fiscal-period-close.spec.ts` (commits `aaa085b`, `ce35c3f`) | **Actually executed** against a freshly seeded, this-branch stack (own Postgres, auth/tenant/coa-service, gateway, vite dev server) with fixtures matching the spec's hardcoded tenant/users — both tests pass: the full lifecycle (open→soft-close→hard-close blocked by a draft→unblock→hard-close→reopen-hard-closed→relock→`LOCKED` terminal, including a direct-API bypass check) and the negative CLERK 403. Running it live (rather than trusting `tsc`+`--list`) found and fixed two real bugs: the API base was hardcoded to `:13100` regardless of the actual target stack (silently hit a stale pre-S008 checkout), and the "unblock hard-close" step tried to *post* the blocking draft while the period was still `SOFT_CLOSED` — impossible without an adjusting-entry attestation the draft never had — fixed to void it instead, per BR008-5's own "post or void" contract |

## 5. Test totals

- `services/coa-service` full suite: **355 passed, 0 failed** (mocked); **24
  additional live-db tests pass** when `LIVE_DATABASE_URL` is set (5
  pre-existing posting proofs + 19 new S008 ones) — **379 total, 0 failed**.
- `apps/web`: `tsc --noEmit` clean, production build (`vite build`) clean.
- Standalone RLS-isolation script (`tests/integration/test-rls-isolation.ts`):
  9 passed, 0 failed (confirmed still passing after this pass's `setup.sh`
  changes).

## 6. Incidental fixes made along the way (disclosed, not silent)

- `tests/integration/rls-live-db/setup.sh`: extended to apply the S008
  migration's hand-written triggers/roles/RLS (previously only the
  journal-posting migration's trigger was replayed); fixed two pre-existing
  stale migration-folder-name references (tenant-service, audit-service);
  fixed a test-harness-only gap where the from-empty-diff bootstrap
  technique silently drops a hand-written `DEFAULT gen_random_uuid()::text`
  on `fiscal_period_transition.id` (not a production bug — `prisma migrate
  deploy`, used for the live-gateway proof in §4, replays the real migration
  and does not have this gap).

## 7. Disclosed gaps (not resolved this pass, not silently dropped)

- **BR008-6** (sequential close) remains unimplemented and undecided — see
  §2.
- **Cross-tenant isolation at the live gateway** was not separately
  re-driven in the curl session (§4) since it is already proven at the DB
  and route-guard layers; a scope choice, stated in the gateway report
  itself.
- The Playwright spec was run against a scratch fixture stack seeded with
  the same tenant id/user emails/entity code it hardcodes, not the
  persistent Final-R0 fixture environment other specs in this directory
  share — a fresh, disposable equivalent, not the shared one. No gap in
  what was proven; noted only so the distinction is explicit.

## 8. Verdict

S008 is certified complete for this pass: `LOCKED`-terminal, the two-tier
reopen/lock model, the drafts-block hard-close prerequisite, and the DB-as-
genuine-backstop guarantee are all proven at the database, application,
route-guard, live-gateway, UI, and now Playwright-E2E layers — with three
real defects found and fixed along the way (`board()`'s Prisma field
mismatch, the UI's missing FUTURE→OPEN action, and the Playwright spec's
hardcoded API host + impossible post-instead-of-void unblock step), and
every fix independently run and observed, not accepted on an agent's
say-so.

## 9. Product Owner acceptance checkpoint (2026-07-28)

The Product Owner reviewed this report and accepted it as a **technical
certification checkpoint** ("PRODUCT CHECKPOINT — S008 TECHNICAL
CERTIFICATION ACCEPTED"), covering commits `ce35c3f` and `762e2b4` (and by
extension the full certification-phase chain summarized in §§2–6). Status
moves from `IMPLEMENTED_PENDING_CERTIFICATION` to
`TECHNICALLY_CERTIFIED_PENDING_PRODUCT_SME_ACCEPTANCE`.

**The acceptance is explicitly scoped**: "nothing pending" applies only to
engineering implementation and technical certification. The following
remain before S008 can be considered fully accepted:

1. Product review of the Fiscal Period Management workflow.
2. Accounting SME confirmation of: `OPEN` behavior; `SOFT_CLOSED`
   restrictions; adjusting-entry treatment; `HARD_CLOSED` behavior; the
   two-tier reopen authorization model; the terminal `LOCKED` state.
3. Final screenshots or demonstration evidence for the acceptance record.
4. Final `MODULE_STATE`/certification-matrix status alignment once Product +
   SME acceptance occurs.
5. Merge or promotion approval after acceptance.

**No new S008 functionality is to be added while this acceptance review is
pending.** The approved S008 rules — reaffirmed, not re-decided, by this
checkpoint — remain exactly as certified: `LOCKED` is terminal; no unlock
operation exists; `HARD_CLOSED` does not return directly to `SOFT_CLOSED`;
reopen requires the approved authorization tier, a mandatory reason, and
audit evidence; a blocked hard-close may be cleared only through valid
posting or voiding; accounting-period state changes remain
backend-authoritative.

Documentation-status updates made to prepare this story for Product and
Accounting SME acceptance (this checkpoint, no engineering changes):
`docs/accounting-modernization/MODULE_STATE.json` (`stories.S008.status` +
history), `docs/accounting-modernization/stabilization/
STORY_CERTIFICATION_MATRIX.csv`, `docs/accounting-modernization/build-packs/
P01/P01_STORY_READINESS_MATRIX.csv`, `P01_TRACEABILITY.csv`,
`P01_STORY_BLOCKING_REGISTER.csv` (BLK-03 resolved/moot, BLK-05/BLK-06
resolved, BLK-27 resolved for S008), `P01_REPOSITORY_VERIFICATION_
RECONCILIATION.md`, `P01_CLAUDE_CODE_HANDOFF.md`, `P01_STORY_CONTRACTS.md`
(DoD line), and the top-level `MODULE_STATE.md`.
