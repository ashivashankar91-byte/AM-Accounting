# CE-08 — SCHEDULES · AUTHORITATIVE EPIC DEFINITION PACKAGE
**Canonical membership (frozen):** S026, S027, S028, S029, S030 — exactly five; registry-reconciled. Prepared in parallel with CE-07 implementation. **Evidence-tier legend used throughout:** [ACCEPTED] canonical backlog requirement · [EVIDENCE] existing implementation evidence (S026/S027 — Git-verify before recertification; prior Fable completion statements are NOT Git proof) · [PROPOSED] recommendation, not accepted · [DECISION] unresolved · [PENDING_CE07_TECHNICAL_CONFIRMATION] depends on CE-07's final integration facts.

## 1 · Epic objective and business outcome
[ACCEPTED] Every controlled GL account carries a governed open-item subledger — created and relieved only from posted journals — that a dealership controller can inquire, age, maintain (split/transfer/write-off), and prove: **control account balance = Σ open items, always, or a loud variance.** Business outcome: the daily reality of a dealership office ("working the schedules") exists in AutoMate 2.0 with enforcement, not discipline.

## 2 · Exact scope per story
**S026 — Open-Item Core & Keys** [EVIDENCE exists]: schedule-item model on controlled accounts; item creation/relief driven from posted journals; key/reference capture; balance query; the tie-out foundation.
**S027 — Aging & Exception Rules** [EVIDENCE exists]: aging bands over open items; exception flagging (stale, over-limit, negative, unmatched) as configurable rules; exception queue surfacing.
**S028 — Relieving Policies** [NOT implemented — do not assume]: which open item a relieving posting clears, per account class; partial-application arithmetic; unapplied handling interface with CE-07's governed customer-credit flow.
**S029 — Split / Transfer / Write-off** [NOT implemented]: governed maintenance ceremonies on open items — split one item into parts, transfer between control identities, write off with reason and authorization; conservation enforced.
**S030 — Statements & Dunning** [NOT implemented; R2]: customer-facing schedule statements and dunning notices from AR open items. Depends on the CE-09 AR customer master for recipient/formatting data — scoped here, sequenced behind that dependency.

## 3 · Story-by-story functional requirements
**S026** [ACCEPTED + EVIDENCE]: item lifecycle OPEN→PARTIALLY_RELIEVED→RELIEVED (+WRITTEN_OFF via S029); items reference their originating journal and carry the reference semantics of §6; creation/relief exclusively from `JOURNAL_ENTRY_POSTED` processing [PENDING_CE07_TECHNICAL_CONFIRMATION: final event payload fields and delivery guarantees]; nightly and on-demand tie-out per account/entity/store; variance surfaces loudly, never absorbs.
**S027** [ACCEPTED + EVIDENCE]: aging as-of any date over open amounts (not original amounts); band definitions configurable per tenant [DECISION D-CE08-03 for defaults]; exception rules evaluated on schedule (stale > N days, credit balance on debit-class account, missing references, over control-limit where defined); exceptions are worklist items with disposition tracking.
**S028** [ACCEPTED, build pending]: relieving resolution order — (1) explicit applyNumber match (specific application) is authoritative when present [ACCEPTED via approved UQ-18/CE-07 semantics]; (2) when no applyNumber (auto/on-account application), policy per account class [DECISION D-CE08-01]; partial relief reduces remaining balance by exactly the applied amount, item stays PARTIALLY_RELIEVED with application history; over-application rejects deterministically; unapplied receipts route to governed customer credit per the approved S023 flow (no orphan cash).
**S029** [ACCEPTED, build pending]: split conserves amount exactly (Σ parts = original, each part carries lineage to parent); transfer moves an item between control identities within the same control account [DECISION D-CE08-04: cross-account transfer allowed or journal-required?] with reason + audit; write-off requires reason + distinct permission and **posts through the engine** — a write-off is an accounting event, never a subledger-only deletion [ACCEPTED: no ledger effect outside the posting door]; threshold above which write-off is refused pending higher authority [DECISION D-CE08-02].
**S030** [ACCEPTED, build pending]: statement generation per customer/control identity from AR open items as-of date; dunning levels with configurable escalation text/timing [DECISION D-CE08-05: content/branding source]; generation is read-only over the subledger (no posting); delivery mechanics (print/email) [DECISION D-CE08-06]; every generated statement is retained evidence.

## 4 · Schedule accounting rules and controls
[ACCEPTED] Single-door rule: items are created/relieved ONLY by posted-journal processing; no API writes item balances directly; maintenance ceremonies (S029) that change accounting value post journals — subledger follows ledger, never leads it. Tie-out invariant (INV-12): per controlled account × entity (× store where dimensioned), GL balance = Σ open-item remaining balances; scheduled job + on-demand; variance = loud state with drill-down to the discrepant items/journals. Failed/rejected journals never touch items [ACCEPTED, mirrors CE-07 G]. Conservation: split/transfer/partial-application arithmetic is exact to the cent; rounding never absorbed silently.

## 5 · Create, relieve, adjust, transfer, inquiry behaviour
Create: posted journal line on a controlled account with schedule references → item (or explicit multi-line grouping rule [DECISION D-CE08-07: line-level vs document-level item granularity — EVIDENCE from S026 implementation likely answers this; confirm, don't redesign]). Relieve: per §3-S028. Adjust: value adjustments are journals (reversal/adjustment via S218/CE-07 correction flow) — the subledger has no "edit amount". Transfer/split/write-off: per S029 ceremonies. Inquiry: by account, control identity, apply/reference, status, age band, store; item detail shows full application history + originating and relieving journal links (drill to S217/S220).

## 6 · Reference semantics [ACCEPTED — approved UQ-18 resolution, as implemented by CE-07]
scheduleNumber = GL account schedule code · controlNumber = vendor/customer/approved control identifier · applyNumber = invoice/document being created or relieved · referenceNumber = source transaction/document ID · itemNumber = referenceNumber, falling back to journalEntryId only when the source reference is genuinely unavailable. Missing mandatory references reject deterministically at posting (CE-07 enforces; CE-08 consumes). [PENDING_CE07_TECHNICAL_CONFIRMATION: exact field names/types on the final event payload.]

## 7 · Partial application and remaining balance
[ACCEPTED] remaining = original − Σ applications; application history immutable (application entries link relieving journal, amount, date, actor); partial keeps item open at remainder; exact-zero closes; over-application rejects (never negative remainder on the same side); credit-side items mirror the arithmetic. Cross-item application in one payment (one payment relieves N items) supported via multiple application entries [EVIDENCE check on S026 model shape].

## 8 · Closed-period and reversal behaviour
[ACCEPTED, aligned to approved CE-07 policy] Relieving/creating journals obey period control at the posting door — CE-08 adds no period logic of its own. Reversal of a posted journal (S218) reverses its item effects symmetrically: reversal of a creating journal closes/negates the item (with lineage), reversal of a relieving journal restores the remaining balance and reopens the application entry [DECISION D-CE08-08: reversal of a partially-further-relieved item — restore-and-flag vs block-reversal-until-downstream-reversed; accounting judgment required]. Replay-into-open-period journals (CE-07 H) create items dated by posting period with original business date preserved as reference — aging basis [DECISION D-CE08-09: age from business date (PROPOSED) vs posting date].

## 9 · UI requirements
[ACCEPTED scope / PROPOSED composition] One **Schedule Inquiry & Maintenance workbench** in the unified Accounting shell (no separate app): account/control selector honoring the AccountingContextBar; item grid (status, age band, remaining, references) with filters/sort/pagination; item detail drawer (application history, journal links); exception queue tab (S027); ceremonies for split/transfer/write-off (S029) using the Foundation confirmation pattern with reason capture; tie-out panel with BALANCED/variance states and drill; statements/dunning surfaces (S030) in the same workbench as a generation + history tab. All standard states (loading/empty/error/unauthorized/cross-tenant-404), permission-aware controls, refresh persistence, 200% zoom. Do not redesign delivered S026/S027 screens unless they conflict with accepted requirements — extend.

## 10 · API and data requirements
[EVIDENCE-first] Reconcile against the existing S026/S027 services before adding anything: item query (filters per §5), item detail + applications, aging query, exception queue + disposition, tie-out run/result, ceremonies (split/transfer/write-off → which post journals via the engine), statement generation/preview/history (S030). Data: schedule_items, item_applications (immutable), exception_flags/dispositions, tie_out_runs, statement_runs — additive migrations only; every ceremony idempotent (client token); optimistic concurrency on items. [PENDING_CE07_TECHNICAL_CONFIRMATION: consumer registration/idempotent event processing pattern for JOURNAL_ENTRY_POSTED.]

## 11 · Permissions, audit, tenancy, RLS
[ACCEPTED] schedule.view · schedule.maintain (split/transfer) · schedule.writeoff (distinct) · schedule.exception.disposition · schedule.statement.generate — names reconciled to S207 catalog via permissions.manifest; write-off separation from ordinary maintenance is mandatory [SECURITY]; audit: item lifecycle, every application, every ceremony with reason + before/after, tie-out results retained, statement generations retained; tenant + legal-entity isolation, store dimension where present; RLS on every new table with positive and negative tests; non-superuser test pattern.

## 12 · Dependencies
CE-07 [hard, boundary respected]: the ONLY item-writing path is posting engine → balanced journal → S013/S020 → JOURNAL_ENTRY_POSTED → schedule-service processing — CE-08 does not redefine it and builds no alternative mechanism; all integration specifics marked PENDING_CE07_TECHNICAL_CONFIRMATION (payload, delivery, idempotency pattern, S023 schedule-effect declarations). CE-04/S218 [hard]: reversal linkage per §8. CE-09 [S030 only]: AR customer master for statement recipients — S030 build sequenced behind it. CE-05 [soft]: journal drill targets. CE-15 [downstream]: close consumes tie-out sign-off.

## 13 · Explicit exclusions
Bank reconciliation items (CE-09 S054x) · payment/receipt creation (CE-09 producers) · schedule-related automation (R7) · statement e-delivery infrastructure beyond D-CE08-06 outcome · any second schedule-writing mechanism · period logic (S008/S209 own it) · tax (CE-10).

## 14 · Story-by-story acceptance criteria
**S026:** AC1 Given a posted journal on a controlled account with valid references, Then exactly one item (per approved granularity) exists linking that journal, and tie-out for that account = $0. AC2 Given a failed/rejected journal, Then zero item effect. AC3 Given any sequence of posted create/relieve journals (property test), Then GL balance = Σ remaining, always. AC4 Duplicate event processing yields no duplicate item (idempotent consumer).
**S027:** AC1 Given items across ages, Then bands report per configuration as-of any date on remaining amounts. AC2 Given a rule breach (stale/credit-balance/missing-ref), Then an exception appears with disposition workflow and audit. AC3 Aging totals reconcile to the tie-out total for the same slice.
**S028:** AC1 Given a relieving posting with applyNumber, Then exactly that item relieves by exactly the applied amount. AC2 Given partial application, Then remainder is exact and history immutable. AC3 Given over-application, Then deterministic rejection, no item change. AC4 Given no applyNumber, Then the approved D-CE08-01 policy applies and is visible on the application record. AC5 Given an unapplied receipt, Then governed customer credit per the approved S023 flow, no orphan.
**S029:** AC1 Split: Σ parts = original to the cent with parent lineage. AC2 Transfer: reason + audit, conservation across identities, per D-CE08-04 boundary. AC3 Write-off: distinct permission, reason, journal posted through the engine, item closes with WRITTEN_OFF, tie-out still $0; above-threshold refusal per D-CE08-02. AC4 No ceremony ever changes accounting value without a posted journal.
**S030:** AC1 Given AR open items for a customer, Then the as-of statement lists items and totals matching the subledger exactly. AC2 Given dunning configuration, Then levels escalate per approved timing with retained copies. AC3 Generation posts nothing and mutates nothing.

## 15 · Current-state vs required-state matrix
| Story | Current [EVIDENCE — Git-verify] | Required delta |
|---|---|---|
| S026 | Implementation evidence: item core, keys, creation/relief, tie-out foundation | Recertify on CE-07 final event contract; confirm granularity D-CE08-07 from code; idempotent-consumer proof; RLS negatives |
| S027 | Implementation evidence: aging + exceptions | Recertify; confirm band configurability + as-of basis; wire exception queue into workbench |
| S028 | None assumed | Full build after D-CE08-01 |
| S029 | None assumed | Full build after D-CE08-02/04; ceremonies post via engine |
| S030 | None assumed | Full build after CE-09 AR master + D-CE08-05/06 |

## 16–17 · Unresolved decisions & register
| ID | Question | Class | Blocks | Note |
|---|---|---|---|---|
| D-CE08-01 | Auto-application relieving order when no applyNumber (oldest-first / FIFO / per-account-class matrix) | ACCOUNTING | S028 build | Specific-application-by-applyNumber is already ACCEPTED; only the no-apply path is open |
| D-CE08-02 | Write-off authority threshold and refusal path (permission-only in CE-08; no S031 routing) | ACCOUNTING+SECURITY | S029 write-off | |
| D-CE08-03 | Default aging bands (30/60/90/120?) per class | ACCOUNTING | S027 defaults only | SAFE_CONFIGURATION pattern |
| D-CE08-04 | Transfer boundary: within control account only vs cross-account (journal-required) | ACCOUNTING | S029 transfer | PROPOSED: within-account; cross-account = journal |
| D-CE08-05 | Statement/dunning content, branding, escalation timing | PRODUCT+ACCOUNTING | S030 | |
| D-CE08-06 | Statement delivery channel scope v1 (print/PDF only PROPOSED) | PRODUCT | S030 | |
| D-CE08-07 | Item granularity line vs document | ENGINEERING (read S026 code) | none — confirm | Do not redesign; document what exists unless it conflicts |
| D-CE08-08 | Reversal of partially-further-relieved item: restore-and-flag vs block-until-downstream-reversed | ACCOUNTING | S028/S029 edge | |
| D-CE08-09 | Aging basis for replayed-into-open-period items: business date (PROPOSED) vs posting date | ACCOUNTING | S027/S028 edge | |
| P-CE08-A | JOURNAL_ENTRY_POSTED final payload/delivery/idempotency pattern | PENDING_CE07_TECHNICAL_CONFIRMATION | S026 recert | From CE-07 traceability matrix |
| P-CE08-B | S023 schedule-effect declaration shape consumed by schedule-service | PENDING_CE07_TECHNICAL_CONFIRMATION | S026/S028 | |

## 18 · Epic Definition of Done
All five stories meet their ACs on the integrated runtime · S026/S027 recertified against the final CE-07 contract (not prior statements) · tie-out property test green under any posting sequence + variance-injection caught · every ceremony posts through the engine (static check: no subledger value change without a journal) · reversal symmetry tested per D-CE08-08 outcome · RLS positive/negative, concurrency (double-apply race, ceremony races), idempotent-consumer duplicate tests green · fresh-migration replay · workbench browser journey incl. one deliberate variance and one write-off refusal · S030 statement matches subledger byte-exactly on fixture · permissions/audit per §11 · manifests emitted · no P0/P1 · epic evidence folder complete.

## 19 · Final readiness verdict
**CE08_READY_EXCEPT_LISTED_DECISIONS** — the contract package is complete; S026/S027 recertification and workbench design may proceed now; S028 build waits on D-CE08-01 (+08/09 edges), S029 on D-CE08-02/04, S030 on CE-09 AR master + D-CE08-05/06; the two P-CE08 items are marked PENDING_CE07_TECHNICAL_CONFIRMATION and deliberately do not block this contract. (Not CE08_PENDING_CE07_TECHNICAL_CONFIRMATION as the overall verdict: the CE-07 dependency is narrow, named, and confined to integration facts — the accounting contract itself is decision-gated, not CE-07-gated.)
