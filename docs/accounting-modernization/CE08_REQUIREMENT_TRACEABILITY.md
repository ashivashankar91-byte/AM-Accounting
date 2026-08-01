# CE-08 — Requirement Traceability Matrix (Companion Index)

**Companion to the authoritative source:** `docs/accounting-modernization/CE08_FABLE_EPIC_PACKAGE.md`
(SHA-256: `5840d6d2a323ad7989e768210f7625b2f40307006b9d4cbafb1bd92aa92dca32`)

**Purpose:** This file assigns a unique reference to every requirement and acceptance
criterion in the CE-08 Fable Epic Package and maps each to story, source heading,
implementation owner, required test, dependency, and status. It is an **index over**
the authoritative package — it does not replace, summarize, reinterpret, correct, or
supersede it. Where the source text is ambiguous, contradictory, or leaves a decision
open, this file records that state as-is (see §A "Ambiguities and Open Contradictions
— Not Resolved Here") rather than resolving it.

**Methodology note (assumption, stated explicitly per requirement to avoid silent
resolution):** The source package is written in prose with semicolon-delimited clauses
inside numbered sections (§1–§19). Only the acceptance criteria in §14 are natively
numbered (AC1, AC2, …) and the decisions in §16–17 are natively IDed (D-CE08-xx,
P-CE08-x). For every other requirement, this file introduces a `REQ-*` reference by
segmenting each section's prose at its semicolon/clause boundaries. **This
segmentation is an interpretive choice made for traceability bookkeeping only** — a
different, equally valid segmentation is possible. Engineering must confirm
granularity against the source text itself before treating any `REQ-*` boundary as
authoritative. This is itself flagged as an open ambiguity in §A below.

**Implementation Owner column:** The source package does not name implementation
owners/teams. Owner values below are placeholder role labels
(`ASSUMED — TBD by epic/program lead`) inferred from the target service named in the
source (e.g., schedule-service, workbench/UI, permissions/security). These are **not**
sourced from the package and must be confirmed/assigned by the CE-08 epic owner before
use in delivery tracking.

**Status values used below** are drawn directly from §15 (Current-state vs
required-state matrix) and §19 (Final readiness verdict) of the source:
- `EVIDENCE EXISTS — PENDING RECERTIFICATION` (S026, S027)
- `NOT IMPLEMENTED — BLOCKED ON DECISION(S)` (S028, S029, S030)
- `PENDING_CE07_TECHNICAL_CONFIRMATION` (items explicitly so marked in source)

---

## 1. Story Register (canonical membership, frozen per source §0 preamble)

| Story | Title (source §2) | Status (source §15/§19) |
|---|---|---|
| S026 | Open-Item Core & Keys | EVIDENCE EXISTS — PENDING RECERTIFICATION |
| S027 | Aging & Exception Rules | EVIDENCE EXISTS — PENDING RECERTIFICATION |
| S028 | Relieving Policies | NOT IMPLEMENTED — BLOCKED ON D-CE08-01 (+08/09 edges) |
| S029 | Split / Transfer / Write-off | NOT IMPLEMENTED — BLOCKED ON D-CE08-02, D-CE08-04 |
| S030 | Statements & Dunning | NOT IMPLEMENTED — BLOCKED ON CE-09 AR master + D-CE08-05, D-CE08-06 |

## 2. Requirements Traceability

| Ref | Story | Source Heading | Requirement (paraphrased pointer only — see source for exact wording) | Owner | Test Required | Dependency | Status |
|---|---|---|---|---|---|---|---|
| REQ-EPIC-01 | All (S026–S030) | §1 Epic objective and business outcome | Governed open-item subledger on every controlled GL account; control balance = Σ open items, always, or a loud variance | ASSUMED — TBD by epic/program lead | Tie-out property test (see AC-S026-03) | — | EVIDENCE EXISTS (S026/S027 partial) — see §15 |
| REQ-SCOPE-026 | S026 | §2 Exact scope per story | Schedule-item model on controlled accounts; creation/relief from posted journals; key/reference capture; balance query; tie-out foundation | Schedule Service Team (backend) — ASSUMED | Model/unit tests + tie-out check | CE-07 (posting engine) | EVIDENCE EXISTS — PENDING RECERTIFICATION |
| REQ-SCOPE-027 | S027 | §2 Exact scope per story | Aging bands over open items; exception flagging (stale/over-limit/negative/unmatched) as configurable rules; exception queue surfacing | Schedule Service Team (backend) — ASSUMED | Aging/exception rule tests | S026 | EVIDENCE EXISTS — PENDING RECERTIFICATION |
| REQ-SCOPE-028 | S028 | §2 Exact scope per story | Which open item a relieving posting clears, per account class; partial-application arithmetic; unapplied handling interface with CE-07 governed customer-credit flow | Schedule Service Team (backend) — ASSUMED | Relief resolution + partial/over-application tests | D-CE08-01; S023 (CE-07 credit flow) | NOT IMPLEMENTED — BLOCKED ON D-CE08-01 |
| REQ-SCOPE-029 | S029 | §2 Exact scope per story | Governed maintenance ceremonies: split, transfer, write-off with reason/authorization; conservation enforced | Schedule Service Team (backend) — ASSUMED | Conservation property tests per ceremony | D-CE08-02; D-CE08-04 | NOT IMPLEMENTED — BLOCKED ON D-CE08-02, D-CE08-04 |
| REQ-SCOPE-030 | S030 | §2 Exact scope per story | Customer-facing schedule statements and dunning notices from AR open items; depends on CE-09 AR customer master; sequenced behind that dependency | Statements/Workbench Team — ASSUMED | Statement generation fixture test | CE-09 AR customer master | NOT IMPLEMENTED — BLOCKED ON CE-09 + D-CE08-05/06 |
| REQ-026-01 | S026 | §3 Story-by-story functional requirements | Item lifecycle OPEN → PARTIALLY_RELIEVED → RELIEVED (+WRITTEN_OFF via S029) | Schedule Service Team — ASSUMED | State-transition tests | S029 (WRITTEN_OFF state) | EVIDENCE EXISTS — PENDING RECERTIFICATION |
| REQ-026-02 | S026 | §3 | Items reference originating journal; carry reference semantics of §6 | Schedule Service Team — ASSUMED | Reference-field integrity tests | §6 reference semantics; CE-07 | EVIDENCE EXISTS — PENDING RECERTIFICATION |
| REQ-026-03 | S026 | §3 | Creation/relief exclusively from `JOURNAL_ENTRY_POSTED` processing | Schedule Service Team — ASSUMED | Consumer integration test | CE-07 event contract | **PENDING_CE07_TECHNICAL_CONFIRMATION** (final event payload fields and delivery guarantees) |
| REQ-026-04 | S026 | §3 | Nightly and on-demand tie-out per account/entity/store | Schedule Service Team — ASSUMED | Tie-out job test (scheduled + on-demand) | — | EVIDENCE EXISTS — PENDING RECERTIFICATION |
| REQ-026-05 | S026 | §3 | Variance surfaces loudly, never absorbs | Schedule Service Team — ASSUMED | Variance-injection test | REQ-026-04 | EVIDENCE EXISTS — PENDING RECERTIFICATION |
| REQ-027-01 | S027 | §3 | Aging as-of any date, over open (not original) amounts | Schedule Service Team — ASSUMED | As-of date parametrized aging test | — | EVIDENCE EXISTS — PENDING RECERTIFICATION |
| REQ-027-02 | S027 | §3 | Band definitions configurable per tenant | Schedule Service Team — ASSUMED | Tenant-config test | **D-CE08-03** (default bands) | EVIDENCE EXISTS — PENDING RECERTIFICATION (defaults open) |
| REQ-027-03 | S027 | §3 | Exception rules: stale > N days, credit balance on debit-class account, missing references, over control-limit | Schedule Service Team — ASSUMED | Rule-breach unit tests (one per rule) | — | EVIDENCE EXISTS — PENDING RECERTIFICATION |
| REQ-027-04 | S027 | §3 | Exceptions are worklist items with disposition tracking | Schedule Service Team — ASSUMED | Disposition workflow test | — | EVIDENCE EXISTS — PENDING RECERTIFICATION |
| REQ-028-01 | S028 | §3 | Explicit applyNumber match is authoritative when present | Schedule Service Team — ASSUMED | Specific-application test | UQ-18/CE-07 (already ACCEPTED) | NOT IMPLEMENTED |
| REQ-028-02 | S028 | §3 | When no applyNumber, policy per account class applies | Schedule Service Team — ASSUMED | Auto-application policy test | **D-CE08-01** | NOT IMPLEMENTED — BLOCKED ON D-CE08-01 |
| REQ-028-03 | S028 | §3 | Partial relief reduces remaining balance by exactly the applied amount; item stays PARTIALLY_RELIEVED with application history | Schedule Service Team — ASSUMED | Partial-application arithmetic test | — | NOT IMPLEMENTED |
| REQ-028-04 | S028 | §3 | Over-application rejects deterministically | Schedule Service Team — ASSUMED | Over-application rejection test | — | NOT IMPLEMENTED |
| REQ-028-05 | S028 | §3 | Unapplied receipts route to governed customer credit per approved S023 flow (no orphan cash) | Schedule Service Team — ASSUMED | Unapplied-receipt routing test | S023 (CE-07 credit flow) | NOT IMPLEMENTED |
| REQ-029-01 | S029 | §3 | Split conserves amount exactly (Σ parts = original, lineage to parent) | Schedule Service Team — ASSUMED | Split conservation property test | — | NOT IMPLEMENTED |
| REQ-029-02 | S029 | §3 | Transfer moves item between control identities within same control account, with reason + audit | Schedule Service Team — ASSUMED | Transfer conservation/audit test | **D-CE08-04** (cross-account transfer boundary) | NOT IMPLEMENTED — BLOCKED ON D-CE08-04 |
| REQ-029-03 | S029 | §3 | Write-off requires reason + distinct permission and posts through the engine (never a subledger-only deletion) | Schedule Service Team + Security — ASSUMED | Write-off posting + permission test | CE-07 posting engine | NOT IMPLEMENTED |
| REQ-029-04 | S029 | §3 | Threshold above which write-off is refused pending higher authority | Schedule Service Team — ASSUMED | Above-threshold refusal test | **D-CE08-02** | NOT IMPLEMENTED — BLOCKED ON D-CE08-02 |
| REQ-030-01 | S030 | §3 | Statement generation per customer/control identity from AR open items as-of date | Statements/Workbench Team — ASSUMED | Statement-vs-subledger match test | CE-09 AR customer master | NOT IMPLEMENTED |
| REQ-030-02 | S030 | §3 | Dunning levels with configurable escalation text/timing | Statements/Workbench Team — ASSUMED | Dunning escalation config test | **D-CE08-05** | NOT IMPLEMENTED — BLOCKED ON D-CE08-05 |
| REQ-030-03 | S030 | §3 | Generation is read-only over the subledger (no posting) | Statements/Workbench Team — ASSUMED | No-mutation assertion test | — | NOT IMPLEMENTED |
| REQ-030-04 | S030 | §3 | Delivery mechanics (print/email) | Statements/Workbench Team — ASSUMED | Delivery-channel test | **D-CE08-06** | NOT IMPLEMENTED — BLOCKED ON D-CE08-06 |
| REQ-030-05 | S030 | §3 | Every generated statement is retained evidence | Statements/Workbench Team — ASSUMED | Retention/audit test | — | NOT IMPLEMENTED |
| REQ-XSEC-04-01 | All | §4 Schedule accounting rules and controls | Single-door rule: items created/relieved ONLY by posted-journal processing; no API writes item balances directly | Schedule Service Team — ASSUMED | Static/API-contract test (no direct-write endpoint) | CE-07 | Cross-cutting — status per story above |
| REQ-XSEC-04-02 | All | §4 | Maintenance ceremonies (S029) that change accounting value must post journals — subledger follows ledger, never leads it | S029 owner | Ceremony-posts-journal test | S029 | NOT IMPLEMENTED (S029) |
| REQ-XSEC-04-03 | All | §4 | Tie-out invariant INV-12: per controlled account × entity (× store where dimensioned), GL balance = Σ open-item remaining balances; scheduled + on-demand; variance = loud state with drill-down | Schedule Service Team — ASSUMED | INV-12 property test + drill-down UI test | REQ-026-04 | EVIDENCE EXISTS (S026) — PENDING RECERTIFICATION |
| REQ-XSEC-04-04 | All | §4 | Failed/rejected journals never touch items | Schedule Service Team — ASSUMED | Negative test (rejected journal → no item effect) | CE-07 G | EVIDENCE EXISTS (S026) — PENDING RECERTIFICATION |
| REQ-XSEC-04-05 | All | §4 | Conservation: split/transfer/partial-application arithmetic exact to the cent; rounding never absorbed silently | S028/S029 owners | Rounding/conservation unit tests | REQ-028-03, REQ-029-01, REQ-029-02 | Mixed — see individual REQs |
| REQ-005-01 | S026 | §5 Create, relieve, adjust, transfer, inquiry behaviour | Create: posted journal line on controlled account with schedule references → item (or explicit multi-line grouping rule) | Schedule Service Team — ASSUMED | Creation mapping test | **D-CE08-07** (line vs document granularity — confirm from code, don't redesign) | EVIDENCE EXISTS — confirm granularity from S026 code |
| REQ-005-02 | S028 | §5 | Relieve: per §3-S028 | Schedule Service Team — ASSUMED | See REQ-028-* tests | REQ-028-01..05 | NOT IMPLEMENTED |
| REQ-005-03 | All | §5 | Adjust: value adjustments are journals (reversal/adjustment via S218/CE-07 correction flow) — subledger has no "edit amount" | Schedule Service Team — ASSUMED | Negative test (no direct amount-edit API) | S218/CE-07 | Cross-cutting |
| REQ-005-04 | S029 | §5 | Transfer/split/write-off: per S029 ceremonies | S029 owner | See REQ-029-* tests | REQ-029-01..04 | NOT IMPLEMENTED |
| REQ-005-05 | All | §5 | Inquiry: by account, control identity, apply/reference, status, age band, store; item detail shows full application history + originating/relieving journal links (drill to S217/S220) | Workbench Team — ASSUMED | Inquiry/filter + drill-down UI tests | S217, S220 | Cross-cutting |
| REQ-006-01 | All | §6 Reference semantics | Definitions: scheduleNumber, controlNumber, applyNumber, referenceNumber, itemNumber (fallback to journalEntryId) | Schedule Service Team — ASSUMED | Field-mapping unit tests | CE-07 (as implemented) | ACCEPTED (approved UQ-18 resolution) |
| REQ-006-02 | All | §6 | Missing mandatory references reject deterministically at posting (CE-07 enforces; CE-08 consumes) | Schedule Service Team — ASSUMED | Rejection-path integration test | **PENDING_CE07_TECHNICAL_CONFIRMATION** (exact field names/types on final event payload) | PENDING_CE07_TECHNICAL_CONFIRMATION |
| REQ-007-01 | S028 | §7 Partial application and remaining balance | remaining = original − Σ applications; over-application rejects (never negative remainder on same side); credit-side items mirror arithmetic | Schedule Service Team — ASSUMED | Arithmetic + credit-side mirror tests | REQ-028-03, REQ-028-04 | NOT IMPLEMENTED |
| REQ-007-02 | S028 | §7 | Application history immutable (links relieving journal, amount, date, actor) | Schedule Service Team — ASSUMED | Immutability test | — | NOT IMPLEMENTED |
| REQ-007-03 | S028 | §7 | Partial keeps item open at remainder; exact-zero closes | Schedule Service Team — ASSUMED | State-boundary test | REQ-026-01 | NOT IMPLEMENTED |
| REQ-007-04 | S028 | §7 | Cross-item application in one payment (one payment relieves N items) supported via multiple application entries | Schedule Service Team — ASSUMED | Multi-item application test | EVIDENCE check on S026 model shape (per source) | NOT IMPLEMENTED (check S026 model shape) |
| REQ-008-01 | All | §8 Closed-period and reversal behaviour | Relieving/creating journals obey period control at the posting door — CE-08 adds no period logic of its own | Schedule Service Team — ASSUMED | Period-control delegation test | CE-07 period-control policy | Cross-cutting |
| REQ-008-02 | All | §8 | Reversal of a posted journal (S218) reverses item effects symmetrically: creating-journal reversal closes/negates item with lineage; relieving-journal reversal restores remaining balance and reopens application entry | Schedule Service Team — ASSUMED | Reversal symmetry tests (both directions) | S218 | Cross-cutting — DoD item (§18) |
| REQ-008-03 | All | §8 | Reversal of a partially-further-relieved item — behavior open | Schedule Service Team — ASSUMED | Test pending decision | **D-CE08-08** | BLOCKED — DECISION OPEN |
| REQ-008-04 | All | §8 | Replay-into-open-period journals (CE-07 H) create items dated by posting period with original business date preserved as reference | Schedule Service Team — ASSUMED | Replay-dating test | CE-07 H | Cross-cutting |
| REQ-008-05 | S027, S028 | §8 | Aging basis for replayed items — open | Schedule Service Team — ASSUMED | Test pending decision | **D-CE08-09** | BLOCKED — DECISION OPEN |
| REQ-UI-09-01 | All | §9 UI requirements | One Schedule Inquiry & Maintenance workbench in unified Accounting shell (no separate app) | Workbench/UI Team — ASSUMED | E2E navigation test | AccountingContextBar | Cross-cutting (workbench composition PROPOSED) |
| REQ-UI-09-02 | S026 | §9 | Account/control selector honoring the AccountingContextBar; item grid (status, age band, remaining, references) with filters/sort/pagination | Workbench/UI Team — ASSUMED | Grid filter/sort/pagination UI test | REQ-005-05 | EVIDENCE EXISTS (per §9: "do not redesign delivered S026/S027 screens unless conflict") |
| REQ-UI-09-03 | S026 | §9 | Item detail drawer (application history, journal links) | Workbench/UI Team — ASSUMED | Drawer content UI test | REQ-007-02, REQ-005-05 | EVIDENCE EXISTS |
| REQ-UI-09-04 | S027 | §9 | Exception queue tab | Workbench/UI Team — ASSUMED | Exception queue UI test | REQ-027-04 | EVIDENCE EXISTS |
| REQ-UI-09-05 | S029 | §9 | Ceremonies for split/transfer/write-off using the Foundation confirmation pattern with reason capture | Workbench/UI Team — ASSUMED | Ceremony UI + confirmation-pattern test | REQ-029-01..04 | NOT IMPLEMENTED |
| REQ-UI-09-06 | S026 | §9 | Tie-out panel with BALANCED/variance states and drill | Workbench/UI Team — ASSUMED | Tie-out panel UI test | REQ-XSEC-04-03 | EVIDENCE EXISTS |
| REQ-UI-09-07 | S030 | §9 | Statements/dunning surfaces in same workbench as a generation + history tab | Workbench/UI Team — ASSUMED | Statement/history tab UI test | REQ-030-01..05 | NOT IMPLEMENTED |
| REQ-UI-09-08 | All | §9 | Standard states (loading/empty/error/unauthorized/cross-tenant-404), permission-aware controls, refresh persistence, 200% zoom | Workbench/UI Team — ASSUMED | Standard-states UI test suite | — | Cross-cutting |
| REQ-UI-09-09 | S026, S027 | §9 | Do not redesign delivered S026/S027 screens unless they conflict with accepted requirements — extend only | Workbench/UI Team — ASSUMED | Design-review gate (non-automatable) | — | Constraint on delivery approach |
| REQ-API-10-01 | S026, S027 | §10 API and data requirements | Reconcile against existing S026/S027 services before adding anything | Backend/API Team — ASSUMED | Service-inventory review (non-automatable) | — | EVIDENCE-first constraint |
| REQ-API-10-02 | All | §10 | Endpoints: item query (filters per §5), item detail + applications, aging query, exception queue + disposition, tie-out run/result, ceremonies (split/transfer/write-off → post journals via engine), statement generation/preview/history | Backend/API Team — ASSUMED | API contract tests per endpoint | REQ-005-*, REQ-027-*, REQ-029-*, REQ-030-* | Mixed per endpoint story |
| REQ-API-10-03 | All | §10 | Data model: schedule_items, item_applications (immutable), exception_flags/dispositions, tie_out_runs, statement_runs — additive migrations only | Backend/API Team — ASSUMED | Migration/schema test | — | Cross-cutting |
| REQ-API-10-04 | All | §10 | Every ceremony idempotent (client token); optimistic concurrency on items | Backend/API Team — ASSUMED | Idempotency + concurrency race tests | REQ-029-* | Cross-cutting — DoD item (§18) |
| REQ-API-10-05 | S026 | §10 | Consumer registration/idempotent event processing pattern for `JOURNAL_ENTRY_POSTED` | Backend/API Team — ASSUMED | Duplicate-event idempotency test | **PENDING_CE07_TECHNICAL_CONFIRMATION** | PENDING_CE07_TECHNICAL_CONFIRMATION |
| REQ-SEC-11-01 | All | §11 Permissions, audit, tenancy, RLS | Permissions: `schedule.view`, `schedule.maintain` (split/transfer), `schedule.writeoff` (distinct), `schedule.exception.disposition`, `schedule.statement.generate` — names reconciled to S207 catalog via permissions.manifest | Security/Platform Team — ASSUMED | Permission-manifest reconciliation test | S207 catalog | Cross-cutting |
| REQ-SEC-11-02 | S029 | §11 | Write-off separation from ordinary maintenance is mandatory [SECURITY] | Security/Platform Team — ASSUMED | Permission-separation negative test | REQ-029-03 | NOT IMPLEMENTED |
| REQ-SEC-11-03 | All | §11 | Audit: item lifecycle, every application, every ceremony with reason + before/after, tie-out results retained, statement generations retained | Security/Platform Team — ASSUMED | Audit-log completeness test | REQ-007-02, REQ-029-*, REQ-030-05 | Cross-cutting |
| REQ-SEC-11-04 | All | §11 | Tenant + legal-entity isolation, store dimension where present; RLS on every new table with positive and negative tests; non-superuser test pattern | Security/Platform Team — ASSUMED | RLS positive/negative test suite | REQ-API-10-03 | Cross-cutting — DoD item (§18) |

## 3. Acceptance Criteria Traceability (source §14 — natively numbered, unambiguous)

| Ref | Story | Source Heading | Acceptance Criterion (pointer — see source for exact wording) | Owner | Test Required | Dependency | Status |
|---|---|---|---|---|---|---|---|
| AC-S026-01 | S026 | §14 | Posted journal on controlled account with valid references → exactly one item (per approved granularity); tie-out for account = $0 | Schedule Service Team — ASSUMED | Automated integration test | D-CE08-07 (granularity) | PENDING RECERTIFICATION |
| AC-S026-02 | S026 | §14 | Failed/rejected journal → zero item effect | Schedule Service Team — ASSUMED | Negative integration test | — | PENDING RECERTIFICATION |
| AC-S026-03 | S026 | §14 | Any sequence of posted create/relieve journals (property test) → GL balance = Σ remaining, always | Schedule Service Team — ASSUMED | Property-based test | — | PENDING RECERTIFICATION |
| AC-S026-04 | S026 | §14 | Duplicate event processing yields no duplicate item (idempotent consumer) | Schedule Service Team — ASSUMED | Idempotency test | PENDING_CE07_TECHNICAL_CONFIRMATION | PENDING RECERTIFICATION / PENDING_CE07_TECHNICAL_CONFIRMATION |
| AC-S027-01 | S027 | §14 | Items across ages → bands report per configuration as-of any date on remaining amounts | Schedule Service Team — ASSUMED | As-of aging test | D-CE08-03 (defaults) | PENDING RECERTIFICATION |
| AC-S027-02 | S027 | §14 | Rule breach (stale/credit-balance/missing-ref) → exception appears with disposition workflow and audit | Schedule Service Team — ASSUMED | Exception rule test | — | PENDING RECERTIFICATION |
| AC-S027-03 | S027 | §14 | Aging totals reconcile to the tie-out total for the same slice | Schedule Service Team — ASSUMED | Reconciliation test | AC-S026-03 | PENDING RECERTIFICATION |
| AC-S028-01 | S028 | §14 | Relieving posting with applyNumber → exactly that item relieves by exactly the applied amount | Schedule Service Team — ASSUMED | Specific-application test | — | NOT IMPLEMENTED |
| AC-S028-02 | S028 | §14 | Partial application → remainder is exact and history immutable | Schedule Service Team — ASSUMED | Partial-application test | — | NOT IMPLEMENTED |
| AC-S028-03 | S028 | §14 | Over-application → deterministic rejection, no item change | Schedule Service Team — ASSUMED | Negative test | — | NOT IMPLEMENTED |
| AC-S028-04 | S028 | §14 | No applyNumber → approved D-CE08-01 policy applies, visible on application record | Schedule Service Team — ASSUMED | Policy-application test | D-CE08-01 | BLOCKED ON D-CE08-01 |
| AC-S028-05 | S028 | §14 | Unapplied receipt → governed customer credit per approved S023 flow, no orphan | Schedule Service Team — ASSUMED | Unapplied-receipt routing test | S023 | NOT IMPLEMENTED |
| AC-S029-01 | S029 | §14 | Split: Σ parts = original to the cent with parent lineage | Schedule Service Team — ASSUMED | Split conservation test | — | NOT IMPLEMENTED |
| AC-S029-02 | S029 | §14 | Transfer: reason + audit, conservation across identities, per D-CE08-04 boundary | Schedule Service Team — ASSUMED | Transfer test | D-CE08-04 | BLOCKED ON D-CE08-04 |
| AC-S029-03 | S029 | §14 | Write-off: distinct permission, reason, journal posted through engine, item closes WRITTEN_OFF, tie-out still $0; above-threshold refusal per D-CE08-02 | Schedule Service Team + Security — ASSUMED | Write-off + refusal test | D-CE08-02 | BLOCKED ON D-CE08-02 |
| AC-S029-04 | S029 | §14 | No ceremony ever changes accounting value without a posted journal | Schedule Service Team — ASSUMED | Static/negative test | — | NOT IMPLEMENTED |
| AC-S030-01 | S030 | §14 | AR open items for a customer → as-of statement lists items/totals matching subledger exactly | Statements/Workbench Team — ASSUMED | Statement-vs-subledger fixture test | CE-09 AR master | NOT IMPLEMENTED |
| AC-S030-02 | S030 | §14 | Dunning configuration → levels escalate per approved timing with retained copies | Statements/Workbench Team — ASSUMED | Dunning escalation test | D-CE08-05 | BLOCKED ON D-CE08-05 |
| AC-S030-03 | S030 | §14 | Generation posts nothing and mutates nothing | Statements/Workbench Team — ASSUMED | No-mutation assertion test | — | NOT IMPLEMENTED |

## 4. Unresolved Decisions Register (source §16–17 — natively IDed, unambiguous)

| Ref | Question (pointer) | Class | Blocks | Status |
|---|---|---|---|---|
| D-CE08-01 | Auto-application relieving order when no applyNumber | ACCOUNTING | S028 build | OPEN |
| D-CE08-02 | Write-off authority threshold and refusal path | ACCOUNTING+SECURITY | S029 write-off | OPEN |
| D-CE08-03 | Default aging bands per class | ACCOUNTING | S027 defaults only | OPEN (SAFE_CONFIGURATION pattern proposed) |
| D-CE08-04 | Transfer boundary: within control account only vs cross-account (journal-required) | ACCOUNTING | S029 transfer | OPEN (PROPOSED: within-account; cross-account = journal) |
| D-CE08-05 | Statement/dunning content, branding, escalation timing | PRODUCT+ACCOUNTING | S030 | OPEN |
| D-CE08-06 | Statement delivery channel scope v1 | PRODUCT | S030 | OPEN (PROPOSED: print/PDF only) |
| D-CE08-07 | Item granularity: line vs document | ENGINEERING (read S026 code) | none — confirm | OPEN — confirm from code, do not redesign |
| D-CE08-08 | Reversal of partially-further-relieved item: restore-and-flag vs block-until-downstream-reversed | ACCOUNTING | S028/S029 edge | OPEN |
| D-CE08-09 | Aging basis for replayed-into-open-period items: business date vs posting date | ACCOUNTING | S027/S028 edge | OPEN (PROPOSED: business date) |
| P-CE08-A | `JOURNAL_ENTRY_POSTED` final payload/delivery/idempotency pattern | PENDING_CE07_TECHNICAL_CONFIRMATION | S026 recert | OPEN — external to CE-08 (CE-07 traceability matrix) |
| P-CE08-B | S023 schedule-effect declaration shape consumed by schedule-service | PENDING_CE07_TECHNICAL_CONFIRMATION | S026/S028 | OPEN — external to CE-08 |

**Total unresolved decisions: 11** (9 `D-CE08-*` + 2 `P-CE08-*` PENDING_CE07_TECHNICAL_CONFIRMATION items).

## 5. Dependencies (source §12)

| Ref | Dependency | Type | Affects |
|---|---|---|---|
| DEP-01 | CE-07 posting engine → balanced journal → S013/S020 → `JOURNAL_ENTRY_POSTED` → schedule-service processing | HARD | S026 (sole item-writing path; CE-08 builds no alternative) |
| DEP-02 | CE-04/S218 reversal linkage | HARD | §8 reversal behavior |
| DEP-03 | CE-09 AR customer master (statement recipients) | HARD (S030 only) | S030 build sequencing |
| DEP-04 | CE-05 journal drill targets | SOFT | Inquiry/drill-down (§5, §9) |
| DEP-05 | CE-15 close consumes tie-out sign-off | DOWNSTREAM | Tie-out (§4 INV-12) |

## 6. Explicit Exclusions (source §13)

| Ref | Exclusion |
|---|---|
| EXC-01 | Bank reconciliation items (CE-09 S054x) |
| EXC-02 | Payment/receipt creation (CE-09 producers) |
| EXC-03 | Schedule-related automation (R7) |
| EXC-04 | Statement e-delivery infrastructure beyond D-CE08-06 outcome |
| EXC-05 | Any second schedule-writing mechanism |
| EXC-06 | Period logic (S008/S209 own it) |
| EXC-07 | Tax (CE-10) |

## A. Ambiguities and Open Contradictions — Not Resolved Here

Per task requirement, the following are reported as-is without being silently resolved:

1. **Requirement segmentation is interpretive.** The source package (§2–§13) is written
   as continuous prose with semicolon-delimited clauses, not pre-numbered
   requirements. The `REQ-*` references in §2 above reflect one reasonable
   decomposition chosen for traceability purposes; a different engineer could
   segment the same prose into more or fewer discrete requirements. This is not a
   defect in the source — it is a structural property of it — but it means the
   `REQ-*` IDs in this file are **derived scaffolding, not authoritative IDs**
   present in the epic package itself. Only story IDs (S026–S030), acceptance
   criteria (AC1–AC5 per story, §14), and decision IDs (D-CE08-01…09,
   P-CE08-A/B, §16–17) are natively IDed in the source.
2. **Implementation owners are not named in the source.** All "Owner" values above
   are placeholder role labels marked `ASSUMED — TBD`. They must be confirmed by
   the CE-08 epic/program lead before being used for delivery accountability.
3. **D-CE08-07 (item granularity) is flagged in the source itself as
   possibly already answered by existing S026 code** ("EVIDENCE from S026
   implementation likely answers this; confirm, don't redesign") — this file does
   not attempt that confirmation; it remains an open item pending engineering
   verification against the S026 codebase, per the source's own instruction.
4. **Two PENDING_CE07_TECHNICAL_CONFIRMATION items (P-CE08-A, P-CE08-B) sit outside
   CE-08's own decision-gating** per §19: the source is explicit that the overall
   readiness verdict is `CE08_READY_EXCEPT_LISTED_DECISIONS`, **not**
   `CE08_PENDING_CE07_TECHNICAL_CONFIRMATION`, because the CE-07 dependency is
   "narrow, named, and confined to integration facts." This file preserves that
   distinction rather than collapsing all PENDING items into a single blocking
   state.
5. **§9 workbench composition is tagged `[ACCEPTED scope / PROPOSED composition]`**
   in the source — the scope (one workbench, no separate app) is accepted, but the
   specific composition/layout is only proposed. This file does not attempt to
   resolve which UI elements are locked vs. still negotiable; that distinction is
   preserved as stated in the source.
6. **No internal contradictions were identified** between sections during this
   indexing pass (e.g., §4's single-door rule, §5's create/relieve behavior, §10's
   API/data requirements, and §11's audit requirements are mutually consistent).
   This absence of detected contradiction is reported, not asserted as proof of
   full consistency — a dedicated conflict-analysis pass was out of scope for this
   import/traceability task.

## B. Summary Counts (see task report for authoritative figures)

- Canonical stories: 5 (S026, S027, S028, S029, S030)
- Total headings in source (H1 + H2): 18
- Total requirement references indexed in §2 above: 68
- Total acceptance criteria (source §14, natively numbered): 19
- Total unresolved decisions (D-CE08-* + P-CE08-*): 11
- Total dependencies (source §12): 5
- Total explicit exclusions (source §13): 7
