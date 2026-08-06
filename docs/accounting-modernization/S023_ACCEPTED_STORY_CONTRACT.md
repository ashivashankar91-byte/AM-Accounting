# S023 — AP/AR/CASH RULE PACKS · ACCEPTED STORY CONTRACT

**Canonical epic:** CE-07 Posting Rules & Recovery · **Release:** R1 · **Approved:** Shivashankar Angadi, Product/Accounting/Security/Engineering program owner, 2026-08-01 · **Status: S023_APPROVED_EXCEPT_ACCOUNT_MAPPING_VALUES** (this contract is authoritative; the DR/CR account values are `ACCOUNT_MAPPING_VALUES_PENDING` per D-S023-12 and are supplied only through the governed matrix process in `S023_ACCOUNTING_RULE_MATRIX.md` — never invented in code).

Full decision-by-decision record: `S023_DECISION_REGISTER.md`. Event shape: `S023_EVENT_CONTRACT.md`. Permissions: `S023_PERMISSION_MATRIX.md`. Acceptance criteria: `S023_ACCEPTANCE_CRITERIA.md`. Historical workshop-prep evidence (unmodified): `docs/accounting-modernization/workshops/S023/`.

**Current technical state:** S021 (`posting-recovery-service`) is merged and certified on `r1-integration`. This contract is written against that current state.

---

## 1. Business objective (D-01, approved)

Provide the versioned, tenant-configurable rule content that converts accepted AP, AR and Cash source events into balanced journals through the S019/S020 posting engine — content and configuration only; the engine remains owned by S019/S020 except the narrowly approved changes in D-22.

## 2. AP, AR and Cash transaction scope (D-02, D-03, D-04)

- **AP:** invoice accepted (liability recognition, including any tax lines) and manual payment posted (liability/schedule relief) — matching the built S039/S043A flows. **`ap.invoice.accepted` is the single authoritative event that posts a vendor invoice's liability journal** (approved 2026-08-01, D-06 amendment); `ap.invoice.posted-request` is normalized to the same canonical event identity and idempotency key and never produces a second tax journal for the same invoice — see `S023_DECISION_REGISTER.md`'s D-06 amendment and `S023_ACCOUNTING_RULE_MATRIX.md` for the full rule.
- **AR:** cash-receipt application (S052 producer exists); customer invoice/charge posting entries **DEFINED_NOT_YET_EXERCISED** until CE-09 AR builds their producers (honestly labeled in the matrix — S048 has no commit or branch anywhere in this repository today).
- **Cash:** receipt→clearing, deposit→cash — greenfield, moved under governed, versioned packs as the single rule source of truth (no prior hard-wired cash-posting logic exists to migrate).

## 3. Banking excluded from v1 (D-05, D-38)

Banking (bank fees, NSF, reconciliation adjustments) is **excluded** from v1 — S054A/B confirmed absent from the repository in any form. Recorded exclusion with a pack-extension path reserved at a future CE-09 banking story.

## 4. Explicit exclusions (D-38, approved)

Banking per D-05; Service/Parts/Deal/OEM/Payroll pack content (their own epics define packs against this framework); rule-engine redesign or replacement (only the D-22 narrow exception is authorized); DLQ mechanics (S021 owns); tax calculation (CE-10 owns — packs map received tax lines only, D-18); free-form user-authored rule language.

## 5. Producer-side changes for S039, S043A and S052 (D-06, D-02/03/04)

**In scope.** S039 and S043A currently post to GL via a direct synchronous HTTP call to gl-service, bypassing the event/outbox path and the posting engine entirely; S052 emits `cash.receipt.issued` with zero consumers and no GL call. Producer-side work to emit the canonical envelope (below) from all three is explicitly authorized as part of this story, not deferred to a separate prerequisite ticket.

## 6. Canonical SourceEventEnvelope (D-06, approved)

One canonical envelope for AP, AR and Cash — see `S023_EVENT_CONTRACT.md` for the full field list. Replaces the three incompatible event/outbox shapes that exist today (coa-service's structured envelope, cash-service's generic outbox row, apar-service's generic outbox helper) with a single contract all three producers emit.

## 7. Rule-pack selection and precedence (D-07, D-08, D-09, D-10)

Selected by event type + legal entity; store/department resolved as mapping dimensions (D-07). Matching is deterministic most-specific; two equally valid remaining matches reject with a distinct ambiguity failure code — never a silent pick (D-08, joint with D-22). Versions are immutable once active, effective-dated, non-overlapping, version-pinned on every generated journal (D-09). Overrides: tenant baseline + legal-entity override (D-10).

## 8. Version lifecycle and effective dating (D-09, approved)

`DRAFT → VALIDATED → ACTIVE → SUPERSEDED (+REJECTED)`; exactly one ACTIVE version per pack key at a time; immutability enforced once ACTIVE/SUPERSEDED; every posting pins its pack-version, rule id, and blueprint hash for full traceability.

## 9. Simulation API (D-33, approved)

A simulate/dry-run capability is **in scope for v1** — evaluates an event against the currently active pack version and returns the would-be posting outcome without ever calling `PostingService.post()` (no durable posting attempt, no schedule effect, no journal). This is new engine-adjacent work (today `submitEvent` always performs a real, durable posting attempt).

## 10. Deterministic posting-failure taxonomy (D-21, approved)

A closed, deterministic failure-code enum replaces today's partial coverage (only `NO_RULE_MATCH` and `EVENT_IDENTITY_CONFLICT` currently get a structured code; ambiguous match, unbalanced blueprint, bad account, and missing field all currently collapse into a generic `REJECTED`/`FAILED` free-text reason). Every failure code maps to a distinct S021 recovery-case classification.

## 11. S021 recovery integration (D-23, approved — current merged state)

Every eligible deterministic posting failure creates an S021 (`posting-recovery-service`) recovery case carrying the event, failure code, attempted pack version, and correlation information. S021 is merged and certified on `r1-integration` as of this approval.

## 12. Replay-version policy (D-25, approved, joint with D-22)

Replay uses the **currently active approved** pack version, not a passthrough of the original terminal result. The replay audit trail preserves: originally attempted pack version, replay pack version, original failure, replay actor, replay reason, and the resulting journal/execution. This requires the narrow S019/S020 engine change authorized under D-22.

## 13. Closed-period handling (D-15, D-26, approved)

A closed-period event rejects to the DLQ for human decision — never silent redating. If a replay lands in a period that has since closed, the journal posts to the current open period with the original business date preserved as a reference — never silently redated, never into a hard-closed period.

## 14. S218 reversal and corrected replay (D-27, approved)

Corrections to already-posted journals happen only via the existing S218 reversal mechanism (mandatory reason, reversible-once, `OPEN`-period-only target, mirrors DR/CR, single `PostingService.post()` door, `idempotencyKey: reverse:{id}`) or via a corrected replay under D-25's policy above. No other correction path is authorized.

## 15. Permissions (D-29, approved — see `S023_PERMISSION_MATRIX.md`)

Reuses the existing `posting_engine.<noun>.<verb>` permission namespace (6 permissions already live from S019/S020, catalog v1.16.0) for view/edit/validate/activate/execution/exception capabilities. New capabilities (simulate, S021 DLQ-case interaction if any S023-specific permission is needed) get new permission strings scoped under the same namespace, registered at the next free auth-catalog slot (1.27.0). Replay itself reuses S021's own existing `posting-recovery.replay.execute` permission rather than a new string.

## 16. Identity-based SoD (D-28, approved, joint)

A user who creates or materially changes a rule-pack version **cannot** activate that same version; activation requires a separately authorized user, with the refusal named and audited. Replay authority is provably distinct from both pack-authoring and activation rights. See the Decision Register's reconciliation note on D-22/D-28 scope boundary before implementation.

## 17. Mapping-change audit diffs (D-30, approved)

Every pack-version transition must produce a reconstructable before/after mapping-change diff (which account changed, from what, to what), and every posting-engine audit event must carry its real before/after state — not the current `before: null` placeholder. Reuses the existing `diffFields()`-based pattern already used elsewhere (apar-service, audit-service).

## 18. Tenant and legal-entity isolation; RLS (approved, cross-cutting)

Every new or extended S023 table follows the repository's standard tenant-isolation pattern (`tenant_id` column, `ENABLE`/`FORCE ROW LEVEL SECURITY`, four policies keyed on `tenant_id = current_setting('app.current_tenant_id')`), consistent with every other service in this repository. Legal entity is a first-class selection dimension (D-07), not a filter — "no legal entity selected" must never be a reachable state for a pack version.

---

## Approved workflow (end to end)

Canonical SourceEventEnvelope consumed → pack selection by event type + legal entity (D-07) → deterministic most-specific rule match; true ambiguity → distinct ambiguity failure code, never silent choice (D-08) → journal blueprint built from the governed mapping matrix (values pending) with journal source per D-11, business-date posting per D-13, rounding per D-19 (half-up, entity rounding-difference account, >|$0.01| imbalance rejects) → posted via the S013 gate (period validation at posting, D-14) → success posts exactly once (idempotent per envelope identity, duplicates return original, D-24) → deterministic failure taxonomy (D-21) → every eligible failure creates an S021 recovery case with event, failure code, attempted pack version, correlation (D-23) → authorized replay under the currently active approved pack version with dual-version audit (D-25) → corrections to posted journals only via S218 reversal + corrected replay (D-27).

## Relationships

**S019/S020 (D-22, approved narrow scope):** engine changes limited to deterministic ambiguity rejection, complete failure taxonomy, replay-version behavior, dual-version audit evidence — no redesign or replacement authorized (see reconciliation note on D-28's scope-boundary question in `S023_DECISION_REGISTER.md`). **S021 (D-23):** integrates with the merged, certified recovery service. **CE-08:** consumes schedule-effect declarations — UQ-18 reference/schedule-key semantics and the relieving-policy decision are both **resolved** (2026-08-01, see `S023_DECISION_REGISTER.md` → "Two program dependencies — RESOLVED"): S023 postings route through the existing gl-service→schedule-service `JOURNAL_ENTRY_POSTED` path; no independent schedule-posting mechanism is authorized inside the posting engine. **CE-09:** producer-side envelope changes to S039, S043A, S052 are in scope (D-06); further CE-09 stories consume the framework.

## Accounting boundary (D-12, approved in principle)

`APPROVED_IN_PRINCIPLE` / `ACCOUNT_MAPPING_VALUES_PENDING`. The DR/CR mapping matrix is Accounting-owned, tenant-configurable, versioned, subject to activation approval and audit. **No account numbers or debit/credit mappings are invented by Engineering or by this contract.** Values are supplied only via `S023_ACCOUNTING_RULE_MATRIX.md` through the governed authorship process.
