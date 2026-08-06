# P01 — Repository Verification & Reconciliation Report (v2, corrected)

**Scope:** S008 (continuation), S009, S003, S011, S032
**Branch:** r1-s008-period-close-control (worktree `AM-Accounting-r1-s008`)
**Date:** 2026-07-28

## v2 correction notice

A v1 of this report was written after an exhaustive repo-wide search (all
worktrees, all local/remote branches, `git log --all`) found **zero** files
under `docs/accounting-modernization/build-packs/P01/` at that time. Before v1
could be committed, the real P01 package (`P01_PACK_CHARTER.md`,
`P01_STORY_CONTRACTS.md`, `P01_CLAUDE_CODE_HANDOFF.md`,
`P01_STORY_READINESS_MATRIX.csv`, `P01_STORY_BLOCKING_REGISTER.csv`,
`P01_TRACEABILITY.csv`, `P01_SCREEN_INVENTORY.csv`, `P01_BUSINESS_JOURNEY.md`,
`design/P01_GOVERNED_FOUNDATION.html`) appeared in this exact directory,
written concurrently by another process (files timestamped before this
report's first save, absent from every check performed moments earlier — the
same class of workspace concurrency hazard already documented in this
session's S008 git-recovery incident). v1's premise ("no P01 exists, synthesize
from scratch") is now stale and is **superseded in full by this v2**, which
reconciles the *actual* P01 package against the repository. v1 is not
preserved as a separate file to avoid two contradictory documents coexisting;
its only correct conclusions (S008 findings) carry forward below.

---

## 1. Pack-level facts (from the real P01 package)

- Pack status: `PRODUCT_REVIEW_REQUIRED`, story-level readiness varies — no
  global gate.
- S008 = `TECHNICALLY_CERTIFIED_PENDING_PRODUCT_SME_ACCEPTANCE` as of 2026-07-28
  (PO checkpoint accepted, commits `ce35c3f`/`762e2b4` — see
  `S008_CERTIFICATION_REPORT.md`; superseding the `IMPLEMENTED_PENDING_CERTIFICATION`
  reading below, which reflects this report's original point-in-time findings).
  Engineering/technical certification is complete; only Product + Accounting
  SME acceptance remains.
- S009 = `READY_FOR_TECHNICAL_VERIFICATION` — full vertical slice.
- S003 = `READY_FOR_TECHNICAL_VERIFICATION` — build where contract ready.
- S011 = `READY_WITH_DECISIONS` — BLOCKED-DOR **only** for accumulator-adjacent
  behavior (AMD-005, pending SME session SES-3); registry/tagging/inquiry-filter
  semantics are NOT blocked.
- S032 = `READY_WITH_DECISIONS` — template CRUD + manual generation proceed;
  scheduled automatic generation excluded until a separate scheduling decision.
- 27 blocking items recorded in `P01_STORY_BLOCKING_REGISTER.csv`; items
  BLK-05, BLK-06, BLK-10, BLK-11, BLK-15, BLK-19, BLK-25, BLK-27 are explicitly
  owned by **"Claude Code"** as `TECHNICAL_VERIFICATION_REQUIRED` /
  `API_CONFIRMATION_REQUIRED` — i.e., this repository-verification pass is the
  action those items are waiting on. Findings below resolve each one with
  repository evidence, per instruction: identify story/criterion, show
  evidence, classify, do not silently pick a side.

---

## 2. S008 — critical finding: state-machine and permission-name conflict

**This is the most important finding in this report.** The P01 story contract
for S008 (`P01_STORY_CONTRACTS.md`) describes a state machine and permission
set that **does not match** what is actually implemented and was explicitly
approved by the Product Owner in this session's prior S008 policy-decision
message ("PRODUCT OWNER DECISION — S008 PERIOD CLOSE CONTROL," already
reflected in code on this branch, commits `3d452cc`–`bc335c2`).

| Dimension | P01 contract text | Implemented + PO-approved (this branch) | Repo evidence |
|---|---|---|---|
| State machine | `FUTURE→OPEN→SOFT_CLOSED→HARD_CLOSED`, plus `HARD_CLOSED→SOFT_CLOSED` ("unlock — exceptional, dual-control ceremony"). **No `LOCKED` state mentioned anywhere in the S008 contract text.** | `FUTURE→OPEN→SOFT_CLOSED→HARD_CLOSED→LOCKED` (LOCKED terminal, no unlock path at all — explicit PO decision: "LOCKED is terminal in S008 v1. No normal API, break-glass endpoint or supported manual database correction may unlock it."). Reopen paths are `SOFT_CLOSED→OPEN` and `HARD_CLOSED→OPEN` (two permission tiers), not `HARD_CLOSED→SOFT_CLOSED`. | `services/coa-service/prisma/migrations/20260728010000_s008_period_close_control/migration.sql` (transition allowlist trigger); PO decision message this session |
| Permission names | `fiscal.period.softclose`, `fiscal.period.hardclose`, `fiscal.period.reopen`, `fiscal.period.unlock` (no version confirmed — flagged `TECHNICAL_VERIFICATION_REQUIRED` in the contract itself) | `fiscal.period.soft_close`, `fiscal.period.hard_close`, `fiscal.period.reopen`, `fiscal.period.reopen_hard_closed`, `fiscal.period.lock`, `fiscal.je.mark_adjusting` | `services/auth-service/prisma/migrations/20260728050000_extend_authz_catalog_s008_period_close/migration.sql` |
| Unlock/dual-control ceremony | Described as in-scope, `DECISION_REQUIRED: dual-person vs single-permission`, proposed single-permission-for-R1 | Explicitly decided and implemented as **no unlock capability at all** — "Dual approval is not required in S008 v1" is moot because there is no unlock path; `LOCKED` has zero recovery by design | Same PO decision message; migration trigger only allows `HARD_CLOSED→OPEN`/`HARD_CLOSED→LOCKED`, never `HARD_CLOSED→SOFT_CLOSED` |

**Classification: RESOLVED by Product Owner decision, 2026-07-28 ("PRODUCT
DECISION — S008 CONTRACT RECONCILIATION").** Product confirmed reading (a)
from the prior version of this report: the already-implemented,
already-PO-approved `LOCKED`-terminal design is correct and authoritative.
Explicitly confirmed and preserved:
- `LOCKED` is terminal; S008 has no unlock operation of any kind.
- `HARD_CLOSED → SOFT_CLOSED` is **not** implemented, even though it appears
  in `PROPOSED_CONTRACT_V1` — that text is superseded prior art, not a pending
  build item.
- The implemented two-tier reopen authorization model
  (`fiscal.period.reopen` for `SOFT_CLOSED→OPEN`, CONTROLLER+ADMIN;
  `fiscal.period.reopen_hard_closed` for `HARD_CLOSED→OPEN`, ADMIN-only) is
  preserved as-is.
- Reopen keeps its implemented mandatory-reason + distinct-audit-event
  behavior (`REOPEN` vs. `PERIOD_REOPENED_FROM_HARD_CLOSE`).
- The repository's permission keys (`soft_close`/`hard_close`/`reopen`/
  `reopen_hard_closed`/`lock`) are canonical; `P01_STORY_CONTRACTS.md` §S008
  has been rewritten to describe this implemented behavior directly (marked
  `IMPLEMENTED_CONTRACT_V1` for that story only) rather than carry the
  conflicting proposed text forward. Production behavior was **not** changed
  to match the obsolete proposed contract — the contract was corrected to
  match production.

BR008-6 (sequential close — hard-close blocked by an earlier open period)
remains genuinely unresolved: it is not implemented, was not addressed by the
PO decision above (out of scope for it), and is carried forward as an open
item, not silently dropped or silently built.

### Remaining S008 Claude-Code-owned verification items

| Item | Finding | Classification |
|---|---|---|
| BLK-05 (S013 posting-gate integration point) | The P01 contract's "S013" is the legacy backlog ID for the balanced-journal-posting API; its real implementation is `services/coa-service/src/application/posting-service.ts` + the `enforce_period_postable()` DB trigger already built and migrated for S008 on this branch. Integration point exists and is wired; the "full PostingService proof" is now complete via a live-code (not direct-SQL) test proving the DB trigger is a genuine backstop beyond the app-layer evaluator. | TECHNICAL_VERIFICATION_REQUIRED → RESOLVED — live-code PostingService proof complete (`tests/live-db/period-close-live.test.ts`) |
| BLK-06 (DB backstop + RLS-negative suite) | Trigger-based backstop and RLS policies exist in the migration and were manually verified via disposable-Postgres SQL in this session's prior work; no automated Vitest/live-db regression suite exists yet | CONFIRMED consistent with the already-tracked remaining-certification-items list |
| BLK-27 (permission names vs. implemented catalogue) | Resolved above — real discrepancy found and documented in the table; catalogue names differ from contract text in exactly the ways shown | **CONTRACT CORRECTION APPLIED** — `P01_STORY_CONTRACTS.md` §S008 now describes the implemented catalogue (`soft_close`/`hard_close`/`reopen`/`reopen_hard_closed`/`lock`, no `unlock`) directly, per the PO decision above |

### Incidental defect found and fixed while reconciling this section

While reading the live implementation to write the corrected contract text
above, a genuine bug was found in the (uncommitted, in-progress) board()
enrichment in `period-service.ts`: it queried `fiscalPeriodTransition.select`
for `reason`/`actorId` fields that do not exist on that Prisma model (the
table intentionally carries no `reason` — see the corrected Data section in
`P01_STORY_CONTRACTS.md`). This was a real `tsc` compile error
(`TS2353`/`TS2551`), masked in `npm test` only because that suite mocks
Prisma and does not validate field names against the real schema. Fixed by
sourcing the board's `lastTransition` summary from the S007 audit outbox
(which already carries `reason` and `actor`) instead — no new migration
needed. `npx tsc --noEmit` now passes clean for `coa-service`; full unit suite
331 passed / 5 skipped (live-db, no `LIVE_DATABASE_URL` in this pass).

---

## 3. S009 — critical finding: wrong ledger service named in the contract

**Repository evidence:** `coa-service`'s `AccountType` (the ledger P01 assigns
S008/S011/S032/S003 to) is a hard-coded 5-value union —
`'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE'`
(`services/coa-service/src/domain/gl-account.ts:3`,
`services/coa-service/src/domain/journal-posting.ts:13`). **`COST_OF_SALES`
and `DISTRIBUTION` do not exist in coa-service at all.**

By contrast, `gl-service` (the separate, ADR-JL-001-documented ledger that
Golden R0's S014/S220/S221/S222/S227 already run on) already carries both
types: `services/gl-service/prisma/schema.prisma:16` schema comment lists
`ASSET | LIABILITY | EQUITY | REVENUE | EXPENSE | COST_OF_SALES | DISTRIBUTION`,
and `services/gl-service/src/index.ts:169` / `routes.ts` actively use both. The
already-approved `S227_FINANCIAL_STATEMENT_ROLLUP_CONTRACT.md` states in its
own text (§2/§4, quoted): *"`COST_OF_SALES` and `DISTRIBUTION` are **explicitly
out of scope** for this basic BS/IS"* and *"Any row whose `accountType` is
`COST_OF_SALES` or `DISTRIBUTION` is [excluded from the rollup]"* — this is
**exactly** the "Unsupported classification" limitation P01's S009 story
narrative describes wanting to lift.

**Discrepancy:**

| P01 contract text | Repo evidence | Classification |
|---|---|---|
| S009 "Ownership: gl/coa service" (contract leaves it ambiguous, then repeatedly frames the goal as fixing the S227/08-09 statements limitation banner) | The account types S009 must classify (`COST_OF_SALES`, `DISTRIBUTION`) and the BS/IS rollup logic that currently excludes them **only exist in `gl-service`**; `coa-service` has neither the account types nor the BS/IS endpoints | **CONTRACT CORRECTION** — S009 must be built against `gl-service` (extending its account model + `financial-statement-service.ts`), not `coa-service`. Building it in `coa-service` as the contract's ambiguous phrasing might suggest would not touch the actual limitation at all. |
| BLK-10 "Certified classification enum values" (`API_CONFIRMATION_REQUIRED`) | Confirmed set, resolved: `ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE, COST_OF_SALES, DISTRIBUTION` (gl-service schema comment, authoritative) | RESOLVED |
| BLK-11 "S227 statement response versioning for grouped sections" | `financial-statement-service.ts` currently hard-excludes COST_OF_SALES/DISTRIBUTION per the approved rollup contract; adding grouped sections is an additive response-shape change requiring the version bump the contract itself flags | CONFIRMED as a real, necessary change — API_CONFIRMATION_REQUIRED remains open (exact new response shape needs Product/Accounting-SME sign-off on Gross Profit placement, per BLK-08, before implementation) |

**A second-order consequence not previously documented anywhere:** P01, as
written, silently spans two disconnected ledgers — S008/S011/S032/S003 target
`coa-service` (the newer, canonical, Golden-Path posting engine used since
Golden R0 stabilization) while S009 must target `gl-service` (the older,
separate ledger per ADR-JL-001). The P01 package does not surface this split
anywhere in its charter, traceability, or blocking register. This is reported
as a **new discrepancy/architecture-decision-required item** — Product/
Engineering should decide whether S009 statement metadata should (a) live on
`gl-service` only (fixes the existing S227 statements, leaves the newer
coa-service ledger without equivalent statement metadata), (b) be built twice
(duplicated effort, contradicts the "one connected pack" framing), or (c)
trigger a larger, out-of-pack decision about consolidating the two ledgers —
which is explicitly beyond this pack's scope per the charter's hard exclusions.
This report recommends (a) as the minimum viable, non-duplicative path
consistent with "fixing the Golden R0 limitation" as literally stated, with
the caveat flagged for Product awareness.

---

## 4. S011 — Analysis Codes: model confirmed, scope of block confirmed narrow

**Repository evidence for the confirmed (non-blocked) slice:**
`JournalLine` (`coa-service` schema, line 366) has no analysis-tag columns
today; adding a child table `journal_line_analysis_tags {lineId, typeId,
valueId}` plus `analysis_code_types`/`analysis_code_values` tables (as P01
specifies) is additive and has direct precedent in this codebase's existing
tenant-scoped registry pattern (`services/tenant-service/src/application/
department-service.ts`, S203 — CRUD, soft-deactivation only, no delete).
BLK-15 ("certified JE line-schema extension point") is **confirmed additive
and safe** — no existing column collides, no migration risk beyond the
standard additive pattern already used for every prior coa-service story
(e.g., S008's `isAdjusting`/`adjustingReason` addition to `JournalEntry`
itself).

**What remains genuinely blocked (AMD-005/SES-3) vs. not:** the P01 documents
are explicit and internally consistent that only *accumulator-adjacent*
behavior is blocked — no accumulator/statistic concept exists anywhere in the
repository today (confirmed by repo-wide grep for "accumulator" — zero hits),
so there is no existing code to reconcile against for that piece; it is
correctly deferred. The registry CRUD, line-tagging, and inquiry-filter
semantics have no such gap and are supported by direct repo precedent.

**No discrepancy found** between the P01 S011 contract and repo reality beyond
the two open `DECISION_REQUIRED` items already named in the contract itself
(tag cap per line — BLK-13; required-per-source tagging — BLK-14), which are
Product decisions, not repository-verification items, and are therefore
correctly left open rather than resolved by engineering assumption here.

---

## 5. S032 — Recurring Journal Templates: reuse target confirmed, permission naming confirmed

**Repository evidence:** the P01 contract's own text is explicit that
generation must be "a client of the journal lifecycle, never a second posting
path," reusing "the certified S214 draft path and S013 gate" — in repo terms,
this maps to `coa-service`'s `ManualJeDraft`/`ManualJeDraftRevision` models
(`schema.prisma:416`) and `draft-service.ts`/`posting-service.ts`. This
confirms and supersedes v1's independent conclusion that the pre-existing
**`gl-service.JournalTemplate`/`JournalTemplateLine` model pair**
(`services/gl-service/prisma/schema.prisma:574`, tagged `S1-06`/`S3-02` — an
earlier, pre-Golden-R0 conversion-wave artifact, unrouted to any HTTP endpoint,
zero test coverage) **must not be reused** — it lives in the disconnected
ledger and predates the certified S214/S013-equivalent draft pipeline. This is
a **CONTRACT CORRECTION** the P01 package itself does not explicitly call out
(it never mentions the existing `gl-service.JournalTemplate` model at all) but
which repository evidence makes unambiguous: build new
`journal_templates`/`journal_template_lines`/`template_generations` tables
inside `coa-service`, per the P01 data section, not by extending the
dead/disconnected gl-service model.

**BLK-25 (S214/S218 integration points) — resolved:** `S214` (draft creation)
= `coa-service` `ManualJeDraft` domain/service; `S218` (reversal linkage) =
`JournalEntry.reversalOf`/`reversedBy` fields already implemented and
certified in Golden R0. Both integration points exist and are confirmed
technically reachable for S032's generation and auto-reverse-draft creation.

**BLK-27 (permission names), S032-specific:** P01 specifies `je.template.manage`
/ `je.template.generate` — these do not yet exist in the auth-service catalog
(confirmed by grep — zero hits for `je.template`); no discrepancy, simply
**not yet created**, consistent with S032 being unbuilt.

**Confirmed, not yet resolved (Product decisions, correctly left open, not
engineering's to silently choose):** BLK-20 (dedicated RT source vs. GJ),
BLK-22 (auto-reverse timing: at-post vs. at-period-open), BLK-23 (formula
amounts deferral), BLK-24 (generation target-date convention).

---

## 6. S003 — Elimination Entity Configuration: extension point confirmed

**Repository evidence:** `services/tenant-service/prisma/schema.prisma`'s
`LegalEntity` model (S200, DONE) has no `is_elimination`/similar field today;
adding one is additive and low-risk — the model already carries several
similar boolean/status flags (`status`, `hasPostedJournals`) with the same
soft-flag-plus-reason pattern P01 specifies (`deactivatedAt/By/Reason` is a
direct structural precedent for `isEliminationChangedAt/By/Reason`). BLK-19
("S200 entity-model extension point") is **confirmed additive and safe**.

Candidate reuse target `group-service.ConsolidatedGlConfig`/
`ConsolidationMapping` (found during v1's investigation) is **correctly not
referenced** by the real P01 contract, which scopes S003 to a flag-only
attribute on `LegalEntity` plus a same-direction ownership guard (cannot own
stores) — no consolidation-group modeling is required for this story, matching
the charter's explicit exclusion ("elimination *posting* stays R5"). No
discrepancy found; the P01 contract's scope is narrower and more precise than
v1's speculative reading of this story.

**Open Product decisions, correctly left open:** BLK-16 (flag-only vs. scoped
pairing metadata), BLK-17 (permission granularity — distinct
`entity.elimination.configure` vs. riding `entity.manage`), BLK-18
(posting-source restriction list content).

---

## 7. Consolidated verified story readiness (adopts P01's own matrix,
verification layer added)

| Story | P01 status | Repo-verification outcome |
|---|---|---|
| S008 | TECHNICALLY_CERTIFIED_PENDING_PRODUCT_SME_ACCEPTANCE (as of 2026-07-28, commits `ce35c3f`/`762e2b4`) | Confirmed implemented; **§2 state-machine/permission-naming conflict RESOLVED by PO decision 2026-07-28 — contract corrected to match implementation**; all previously-remaining certification items (concurrency/idempotency, RLS-negative, live-code PostingService proof, route-level authz-guard coverage, live-gateway confirmation, frontend, Playwright) are now complete — see `S008_CERTIFICATION_REPORT.md`. Only Product + Accounting SME acceptance remains |
| S009 | READY_FOR_TECHNICAL_VERIFICATION | **Contract's ledger ownership is ambiguous and, if read as coa-service, is wrong — must target gl-service (§3)**; classification enum resolved; response-versioning need confirmed |
| S011 | READY_WITH_DECISIONS (isolated block) | Confirmed additive/safe; block scope confirmed genuinely narrow (AMD-005 only) |
| S032 | READY_WITH_DECISIONS (scheduler excluded) | Confirmed reuse target is coa-service's ManualJeDraft/S218, NOT the disconnected gl-service JournalTemplate model; integration points exist |
| S003 | READY_FOR_TECHNICAL_VERIFICATION | Confirmed additive/safe extension point on LegalEntity; no discrepancy |

### Implementation gaps (net-new, confirmed by this pass)
- S008: none — all previously-listed gaps (DB concurrency test suite, idempotency test suite, RLS-negative Vitest suite, live-code PostingService proof, gateway route confirmation, frontend (P01-SCR-01), Playwright) are complete as of 2026-07-28; only Product + Accounting SME acceptance remains (not an implementation gap).
- S009: `statement_lines` table + `gl_accounts`-equivalent metadata fields **in gl-service**, not coa-service; `financial-statement-service.ts` rollup logic change to consume it; COA Governance + Statement Line Registry screens (P01-SCR-02/03).
- S011: `analysis_code_types`, `analysis_code_values`, `journal_line_analysis_tags` tables in coa-service; registry service/routes; JE-editor tag control (display-only extension); inquiry/search filter param.
- S032: `journal_templates`, `journal_template_lines`, `template_generations` tables in coa-service; generation service (drafts via existing pipeline only); template registry/editor/generation-ceremony screens (P01-SCR-07/08/09).
- S003: `is_elimination` (+ reason/audit fields) on `tenant-service.LegalEntity`; store/franchise-assignment guard (both directions); entity-form section + list badge + org-tree annotation (P01-SCR-06, embedded in S200's existing screen).

### Reusable backend/frontend components
- Backend: `department-service.ts` (S203) CRUD pattern → S011 registry; `ManualJeDraft`/`draft-service.ts` (S216/S214-equivalent) → S032 generation target; `JournalEntry.reversalOf/reversedBy` (S218) → S032 auto-reverse; `createAuthzGuard`/`AuthzClient` + the `audit()` helper pattern (`period-service.ts`) → all four new stories' authz/audit wiring.
- Frontend: Accounting UI Foundation V1 components (already scoped in this repo's `ui-phase2-foundation` todo) cover every P01 screen except the one net-new **Period Status Timeline** pattern P01 catalogues for S008 (P01-SCR-01) — built and browser-verified as of 2026-07-28 (`apps/web/src/pages/accounting/admin/PeriodControl.tsx`), reuse nowhere else per the inventory.

### Required migrations (once the flagged decisions/corrections are acknowledged)
- S008: none — schema complete, technical certification complete; only Product + Accounting SME acceptance remains.
- S009: 1 `gl-service` migration (statement-line registry table + account metadata fields) — **not** coa-service, per §3.
- S011: 1 coa-service migration (3 new tables) + 1 auth-service catalog migration (`analysis.code.manage`).
- S032: 1 coa-service migration (3 new tables) + 1 auth-service catalog migration (`je.template.manage`, `je.template.generate`).
- S003: 1 tenant-service migration (`legal_entities` additive columns) + 1 auth-service catalog migration (permission name pending BLK-17).

### Confirmed API contracts (this pass, per P01 + repo verification)
- S008: existing 5 transition endpoints (soft-close/hard-close/reopen/reopen-hard-closed/lock) + open + board + eligibility in `period-routes.ts` — `P01_STORY_CONTRACTS.md` corrected to match, per §2.
- S009: `GET/POST/PATCH /coa/statement-lines`, `PATCH /coa/accounts/{id}/statement-metadata`, `POST /coa/accounts/statement-metadata:bulk` — **against gl-service's account model**, not coa-service's.
- S011: `CRUD /analysis/types(+values)`; JE create/update `lines[].analysisTags[]`; inquiry/search `analysisValueId` filter param.
- S032: `CRUD /journal-templates`; `POST /journal-templates:generate`.
- S003: `PATCH /entities/{id}/elimination`.

### Permission and audit mappings (per P01, permission-name conflicts noted)
| Story | Permission keys (P01) | Conflict with repo? | Audit docType/action |
|---|---|---|---|
| S008 | softclose/hardclose/reopen/unlock | **Resolved — see §2.** Repo's `soft_close`/`hard_close`/`reopen`/`reopen_hard_closed`/`lock` (no `unlock`) are canonical; contract text corrected | `fiscal_period` docType events: `OPEN`/`SOFT_CLOSE`/`HARD_CLOSE`/`REOPEN`/`PERIOD_REOPENED_FROM_HARD_CLOSE`/`LOCK` (existing) |
| S009 | `coa.governance.edit`, `coa.statementline.manage` | None found (net new) | `coa.statement_metadata.changed`, `coa.statement_line.*` |
| S011 | `analysis.code.manage` (+ existing `je.*`/`inquiry.*`) | None found (net new) | `analysis.type/value.*` |
| S003 | `entity.elimination.configure` (granularity open, BLK-17) | None found (net new) | `entity.elimination_changed` |
| S032 | `je.template.manage`, `je.template.generate` (+ existing `je.post`) | None found (net new) | `je.template.*` |

### Proposed branch and commit sequence
1. **S008** — technically certified 2026-07-28 (PO checkpoint accepted, commits
   `ce35c3f`/`762e2b4`); remains on `r1-s008-period-close-control` pending
   Product + Accounting SME acceptance and merge/promotion approval. No further
   engineering commits until that acceptance review completes.
2. **S009** — new branch `r1-s009-statement-metadata` off `develop`/wherever
   `gl-service`'s latest certified commit lives (confirm with Product/Eng which
   integration branch is authoritative for gl-service right now, since it is
   outside this session's S008-focused worktree). Commit 1 = gl-service
   migration + statement-line registry + account metadata; commit 2 =
   financial-statement-service.ts rollup change; commit 3 = auth catalog +
   COA Governance/Statement Line Registry frontend; commit 4 = tests +
   Playwright.
3. **S003** — new branch `r1-s003-elimination-entity`. Commit 1 = tenant-service
   migration + service guard logic; commit 2 = auth catalog + entity-form
   extension; commit 3 = tests.
4. **S011** — new branch `r1-s011-analysis-codes` (confirmed slice only,
   excluding AMD-005/accumulators). Commit 1 = coa-service migration + registry
   service; commit 2 = JE-editor tag control + inquiry/search filter; commit 3
   = auth catalog + tests.
5. **S032** — new branch `r1-s032-je-templates`. Commit 1 = coa-service
   migration (3 tables) + template domain/service; commit 2 = generation
   service (drafts via existing pipeline) + auto-reverse wiring; commit 3 =
   HTTP routes + auth catalog; commit 4 = frontend (3 screens) + tests.

### Stories that can start immediately
**S003** (no architectural correction needed, only Product decisions on
granularity/scope, all low-risk) and **S011**'s confirmed slice (registry +
tagging + inquiry filter, excluding AMD-005). **S032**'s template CRUD +
manual generation can start in parallel once the four named Product decisions
(BLK-20/22/23/24) are acknowledged — all narrow and low-risk. **S009** should
NOT start implementation until Product/Engineering confirm the gl-service vs.
coa-service ownership question in §3 — starting against the wrong service
would produce code that never touches the actual "Unsupported classification"
limitation it's meant to fix.

### Story-specific blockers
- **S008**: technically certified 2026-07-28 — all engineering/certification
  work complete. Only remaining blocker is Product + Accounting SME
  acceptance (not an engineering decision); no new S008 functionality until
  that review completes.
- **S009**: blocked on the gl-service vs. coa-service ownership confirmation
  (§3) — a genuine architectural question the P01 package itself leaves
  ambiguous; also carries its own already-open BLK-07/08/09 Product/SME items.
- **S011**: blocked only for AMD-005/accumulator-adjacent behavior (SES-3);
  confirmed slice is unblocked.
- **S032**: blocked only on the four named Product decisions, all low-risk;
  scheduler explicitly and correctly out of scope for this pass.
- **S003**: blocked only on BLK-16/17/18 Product/Security decisions, all
  low-risk relative to S009's architectural question.

---

## 8. What happens next

No S009/S011/S032/S003 implementation code has been written in this pass, per
this task's own instruction to update the reconciliation report before coding
affected behavior. §2's S008 state-machine/permission conflict is now
**resolved** (Product decision, 2026-07-28) — the highest-priority open item
in the prior version of this report is closed, `P01_STORY_CONTRACTS.md` has
been corrected to match the implemented, already-migrated production control
logic, and the full S008 certification checklist (concurrency/idempotency,
RLS-negative, live-code PostingService proof, gateway confirmation, frontend,
Playwright) is now complete and was accepted by the Product Owner as a
technical-certification checkpoint on 2026-07-28 (commits `ce35c3f`/`762e2b4`)
— S008 moves to `TECHNICALLY_CERTIFIED_PENDING_PRODUCT_SME_ACCEPTANCE`, with
Product review and Accounting SME confirmation as the only remaining steps
before merge/promotion. The next pass for the other four stories proceeds per
the branch/commit sequence in §7, in the order S003 → S011 (confirmed slice)
→ S032 → S009 (last, pending its ownership confirmation), adjusted if Product
prioritizes differently.
