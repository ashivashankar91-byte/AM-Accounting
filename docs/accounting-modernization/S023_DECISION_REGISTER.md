# S023 — DECISION REGISTER (formal approval record)

**Final approver:** Shivashankar Angadi · **Authority:** Product, Accounting, Security and Engineering program owner · **Approval date:** 2026-08-01 · **Rule applied:** all non-conflicting workshop PROPOSED options approved; six joint resolutions recorded verbatim below; repository-backed stronger existing controls supersede where identified (none identified at signing — Engineering confirms during CE-07 Step-0).

**Final approved status: `S023_APPROVED_EXCEPT_ACCOUNT_MAPPING_VALUES`**

**Current technical state note (not a workshop-evidence correction — the historical documents below are preserved unmodified):** the workshop-support evidence in `docs/accounting-modernization/workshops/S023/` (`S023_REPOSITORY_EVIDENCE.md`, `S023_EXISTING_ARCHITECTURE_MAP.md`, `S023_TECHNICAL_FEASIBILITY_MATRIX.md`) states that S021 (`posting-recovery-service`) is not merged into `r1-integration`. That was accurate when those documents were written. **As of this approval, S021 is merged and certified on `r1-integration`** (re-verified in the immediately preceding baseline-stabilization pass: 101/101 tests passing). Read the historical workshop documents as evidence of repository state at workshop-prep time, not current state. D-S023-23 below is decided against the current, merged state.

---

## Six joint resolutions (recorded exactly as approved)

**D-S023-06** — One canonical SourceEventEnvelope for AP, AR and Cash. Producer-side changes for S039, S043A and S052 ARE IN SCOPE. Envelope includes: tenant, legal entity, event ID, schema version, source system, source entity type and ID, business date, correlation ID, idempotency identity, accounting amounts/references.

**D-S023-06 amendment — AP tax-posting clarification (approved 2026-08-01):** `ap.invoice.accepted` is the single authoritative financial event for posting a vendor invoice; it carries the complete approved invoice distribution, including any recoverable-tax or tax-expense lines supplied by the source transaction or CE-10. `ap.invoice.posted-request` must not create a second tax journal for the same invoice — it is treated only as an internal posting request / compatibility alias and is normalized to the same canonical event identity and idempotency key as `ap.invoice.accepted`. One invoice produces one liability journal; tax lines are included within that journal; the tax debit and AP-control credit are never posted again through a separate event. When both event names are received for the same invoice, the first valid one creates the journal and the second returns the original posting result (existing D-24 idempotency mechanism, keyed on the shared canonical identity) — no duplicate journal, no duplicate AP open item. If tax information becomes available only after the invoice was posted, it is handled through an explicitly governed tax-adjustment/correction workflow (see D-27) — `ap.invoice.posted-request` is never reused to silently add another posting. S023 performs tax-account mapping only; tax calculation remains outside S023 (D-18). Missing required tax lines or tax-account mappings cause deterministic rejection to S021, with zero partial posting.

**D-S023-08** — Deterministic most-specific rule matching. Two equally valid rules/packs remaining → reject with a distinct ambiguity failure code. Never silently choose one.

**D-S023-22** — Narrowly scoped S019/S020 changes approved ONLY for: deterministic ambiguity rejection; complete failure taxonomy; replay-version behaviour; dual-version audit evidence. Does NOT authorize redesigning or replacing the posting engine.

**D-S023-23** — Integrate with the already-merged S021 recovery service. All eligible deterministic posting failures create an S021 recovery case with event, failure code, attempted pack version and correlation information.

**D-S023-25** — Replay uses the currently active approved rule-pack version. Replay audit trail preserves: originally attempted pack version, replay pack version, original failure, replay actor, replay reason, resulting journal/execution.

**D-S023-28** — Identity-based segregation of duties. A user who creates or materially changes a rule-pack version cannot activate that same version; activation requires a separately authorized user. Replay permission remains separate from pack-authoring and activation rights.

**Reconciliation note (D-22 / D-28 scope boundary — flagged, not silently resolved):** D-22's four enumerated narrow-scope items do not literally include "identity-based author≠activator enforcement." D-28 requires exactly that as a change to `activateVersion()` in `posting-engine-service.ts` — the same S019/S020 codebase D-22 governs. Both decisions are recorded above exactly as approved. Whether D-28's activation-refusal check falls within D-22's authorized narrow scope, or requires its own explicit engineering sign-off, is an open confirmation for CE-07 Step-0 — not assumed either way by this register.

---

## Accounting boundary (recorded exactly)

**D-S023-12:**
`APPROVED_IN_PRINCIPLE`
`ACCOUNT_MAPPING_VALUES_PENDING`

Accounting-owned, tenant-configurable, versioned, subject to activation approval and audit. **No account numbers or DR/CR mappings are invented.** Values are supplied only via the governed `S023_ACCOUNTING_RULE_MATRIX.md` authorship process (Accounting-authored, activation-approved, audited).

---

## Two program dependencies — RESOLVED (2026-08-01)

D-S023-16 and D-S023-17 are now **implementation-ready**. Both previously-surviving program-level dependencies are resolved:

1. **UQ-18 reference and schedule-key semantics — RESOLVED.** `scheduleNumber` = the GL account's configured schedule code (`account.scheduleCode`); `controlNumber` = vendor ID, customer ID, or approved control identifier (`line.controlNumber`); `applyNumber` = the invoice/document number being created or relieved; `referenceNumber` = the source transaction/document ID; `itemNumber` = `referenceNumber`, falling back to `journalEntryId` only when the source reference is genuinely unavailable. A missing mandatory reference rejects to the S021 DLQ.
2. **Relieving-policy decision for schedule effects — RESOLVED.** S023 uses the existing journal-posting event path: posting engine → balanced journal → S013/S020 posting → `JOURNAL_ENTRY_POSTED` event → schedule-service creates or relieves the declared open item. S023 rule-pack entries declare the schedule action and required keys; **no second, independent schedule-posting mechanism is authorized inside the posting engine.** All schedule changes are driven exclusively by the successfully posted journal event — a failed or rejected journal never creates or relieves an open item.

*(The Downloads-generated draft of this register originally cross-referenced these two dependencies as "program D-04/D-05" — that reference was ambiguous against this repository's own D-S023-04/05 (Cash scope, Banking exclusion), which are unrelated. It was dropped in the prior revision of this document rather than carried forward unexplained; the two dependencies are now stated and resolved plainly above.)*

---

## Full register (all 38; class · approved outcome)

01 Product · objective = versioned tenant-configurable AP/AR/Cash rule content through S019/S020, content-only.
02 Accounting · AP scope = invoice accepted, invoice posting w/ tax mapping, manual payment (S039/S043A flows).
03 Accounting · AR scope = receipt application now; AR-invoice entries DEFINED_NOT_YET_EXERCISED.
04 Accounting · Cash scope = receipt→clearing, deposit→cash under governed packs.
05 Product · Banking EXCLUDED v1.
06 JOINT (above).
07 Accounting · selection = event type + legal entity; store/dept as mapping dimensions.
08 JOINT (above).
09 Product · immutable active versions, effective-dated, non-overlapping, version pinned per journal.
10 Accounting/SAFE_CONFIG · tenant baseline + LE override; store/dept dimensions.
11 Accounting · dedicated S212 sources per module family (Engineering confirms existing bootstrap state at Step-0).
12 Accounting · IN PRINCIPLE + ACCOUNT_MAPPING_VALUES_PENDING (above).
13 Accounting · business/document date per event-type table (table authored with matrix; never silent system date).
14 NO_BLOCKER · period validation at posting via S013; early warning at evaluation.
15 Accounting · closed-period → reject to DLQ; never silent redating.
16 Accounting · IMPLEMENTATION-READY — declarative schedule-effect slots; semantics resolved via the JOURNAL_ENTRY_POSTED → schedule-service path (see "Two program dependencies — RESOLVED" above).
17 Accounting · IMPLEMENTATION-READY — reference-field matrix resolved per the UQ-18 model (scheduleNumber/controlNumber/applyNumber/referenceNumber/itemNumber, above); mandatory-absent → reject.
18 Accounting/Product · tax mapping only; zero calculation; expected-absent → reject.
19 Accounting · half-up line rounding; entity rounding-difference account (account VALUE pending matrix); >|$0.01| rejects.
20 Accounting · invalid/missing account → reject naming account; NO suspense.
21 NO_BLOCKER · closed deterministic failure enum, per-code DLQ classification.
22 JOINT (above).
23 JOINT (above) — decided against current merged S021 state.
24 Engineering+Accounting · engine idempotency mechanism consumed; duplicates return original (accounting-sufficiency of key confirmed at matrix authorship).
25 JOINT (above).
26 Accounting · replay into closed period → current open period w/ original-date reference.
27 Accounting · posted-journal corrections via S218 reversal + corrected replay only.
28 JOINT/Security (above).
29 Security · permission set reuses existing `posting_engine.<noun>.<verb>` namespace (see reconciliation in `S023_PERMISSION_MATRIX.md`); next free auth-catalog slot 1.27.0.
30 Security · lifecycle audit + version pin + mapping diffs.
31 Product · full console incl. draft mapping editing + activation ceremony.
32 NO_BLOCKER · backend = pack store, selection resolver, validation, versioning, adapters; S020 owns evaluation.
33 Product · API incl. SIMULATE (dry-run, no posting).
34 NO_BLOCKER · normalized pack_versions/pack_entries, declared dimensions, effective dates, tenant keys + RLS, additive.
35 NO_BLOCKER · emissions per event contract.
36 Product+Accounting · four inquiry answers wired into S220/S021 surfaces.
37 Accounting+Product · AC set per `S023_ACCEPTANCE_CRITERIA.md`; golden values pend matrix.
38 Product · exclusions per contract.

---

## Approval table

| Decision ID | Approved option | Approved by | Date | Affected stories | Notes |
|---|---|---|---|---|---|
| D-S023-01…38 (all) | Workshop PROPOSED options, with six joint resolutions verbatim, D-12 in-principle, and the D-6 AP tax-posting amendment | Shivashankar Angadi (program owner: Product/Accounting/Security/Engineering) | 2026-08-01 | S023; producer scope S039, S043A, S052; consumers CE-08/CE-09 | ACCOUNT_MAPPING_VALUES_PENDING (D-12 only — account-selection rules approved, tenant GL account codes intentionally not hardcoded here); D-16/D-17 RESOLVED and implementation-ready |

---

## Open items surviving approval

1. **ACCOUNT_MAPPING_VALUES_PENDING** — the only remaining open item. DR/CR account-selection *rules* are approved (this document, D-1 through D-7 above); the actual per-tenant GL account *codes* that satisfy those rules are Accounting-authored, tenant-configurable, versioned, activation-approved, and audited (D-12) — intentionally never hardcoded by Engineering or by this register. Blocks AC-1 goldens and any real posting content until each tenant's values are authored.
2. ~~UQ-18 + relieving-policy program decisions~~ — **RESOLVED 2026-08-01** (see "Two program dependencies — RESOLVED" above). D-S023-16 and D-S023-17 are implementation-ready.
3. **Engineering Step-0 confirmations (unchanged):** existing S212 source rows (is `bootstrapReserved()` already run per tenant, or must S023's rollout call it), engine idempotency key shape (confirm sufficiency — the shared canonical identity between `ap.invoice.accepted`/`ap.invoice.posted-request` above uses this same mechanism), existing-stronger-controls check, permission-name reconciliation (see `S023_PERMISSION_MATRIX.md`), and the D-22/D-28 scope-boundary question flagged above.

**FINAL STATUS: S023_APPROVED_EXCEPT_ACCOUNT_MAPPING_VALUES** — documentation is now fully internally consistent; every decision except D-S023-12's tenant-specific account *values* (never hardcoded, by design) is implementation-ready for CE-07 Step-0 engineering scoping.
