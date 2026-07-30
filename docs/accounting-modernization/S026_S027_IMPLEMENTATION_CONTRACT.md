# S026 / S027 Implementation Contract

Status: implementation-phase working contract (not a certification doc). Written from the
current `r1-integration` base (HEAD `eb8c3f2`), before any S026/S027 production changes.

## Authoritative sources consulted

- Canonical registry: `docs/accounting-modernization/AutoMate2_Accounting_Backlog_Package_v1.1.zip`
  (`out/canonical_registry.json` lines 466-483, `out/ACCOUNTING_MASTER_BACKLOG.md` lines 172-179,
  711-712 — S026 "Schedule Open-Item Core" / S027 "Schedule Aging Engine", epic CE-08, release R1,
  level L2, status EXPANSION_PENDING — condensed AC only, no 88-field expansion exists).
- `out/OPEN_QUESTIONS_AND_DECISIONS.md` row UQ-18: "Control#/Apply# semantics (schedule keys?)",
  stories S026/S214, DoR impact "BLOCKS S026", **temp assumption: "schedule_key model (interim)"**.
  UQ-18 does explicitly name S026, but the register itself supplies the unblocking interim
  assumption (the same pattern used for UQ-06/UQ-12/UQ-14/UQ-16, none of which halted their
  stories) — used below rather than inventing new policy or stopping.
- COBOL extractions: `docs/cobol-extractions/schedmgr.extraction.md`, `schedup.extraction.md`,
  `komdetail.extraction.md`, `schedprn.extraction.md`, `schedsec.extraction.md`.
- `docs/gap-analysis/wave-3-schedule-subsystem.md` — the existing architecture decision record for
  `services/schedule-service` (Schedule/ScheduleDetail/SchedulePermission/OutboxEvent), confirmed to
  have **no migrations ever applied** and **no open-item/application/balance model**.
- Live code: `services/gl-service/src/application/gl-service.ts` (`approveJournalEntry`, lines
  590-734) — the actual `JOURNAL_ENTRY_POSTED` event contract; `services/schedule-service/src/**`
  (existing consumer); `services/apar-service` S036A migrations (RLS/authz/audit convention
  template); `packages/shared-kernel` (RLS middleware, authz guard, audit outbox, outbox processor).

## UQ-18 resolution — `schedule_key`

`schedule_key = (tenantId, scheduleNumber, controlNumber)`. This is not invented: it is already
the live routing key gl-service uses to address `JOURNAL_ENTRY_POSTED` events at schedule-service
(`account.scheduleCode` → `scheduleNumber`, `line.controlNumber` → `controlNumber`), and matches the
legacy `DE-SCHDNO`/`DE-CONTNO` alternate-key pair documented in `komdetail.extraction.md`. No new
config or accounting policy is introduced.

Open-item identity is `schedule_key + itemNumber`, where `itemNumber` is the already-existing
legacy `DE-APPLYNO` target reference (`referenceNumber`, falling back to `journalEntryId` when no
reference number is present). A posted line with `applyNumber` unset opens a new item; a line with
`applyNumber` set applies against the open item whose `itemNumber` matches it. This generalizes the
legacy Type-5 "apply-to" mechanic (documented as payment-to-invoice linkage) into a real balance
ledger, which is the accounting-correctness enhancement S026 asks for — it does not redefine what
Control#/Apply# mean.

## S026 contract

- **Ownership**: `services/schedule-service` (extends the existing Wave-3 scaffold; no new
  microservice).
- **Source transaction identity**: `journalEntryId` + the outbox event's `correlationId`
  (`${entryCorrelationId}-line-${lineNumber}`, already unique per posted line at
  `gl-service.ts:685`) — the natural per-line idempotency key. The existing consumer's
  `findByJournalEntryId` guard is too coarse (it dedupes at the *entry* level, so a second
  schedule-relevant line on the same entry is silently dropped); S026 corrects this to a per-line
  key as part of "creation is idempotent."
- **Schedule key**: see above.
- **Open-item identity**: `schedule_key + itemNumber`.
- **Original/applied/remaining amount, status**: `ScheduleOpenItem.originalAmount` /
  `appliedAmount` / `remainingBalance` (denormalized, DB CHECK-enforced), `status` ∈
  `OPEN | PARTIALLY_APPLIED | CLOSED`.
- **Posting-event integration**: extends the existing `JOURNAL_ENTRY_POSTED` consumer
  (`ScheduleEventHandlers.handleJournalEntryPosted`) — no gl-service/posting-engine changes.
  `GLAccount.scheduleCode` (already gl-service's "requires schedule tracking" flag) is reused
  as-is; no new flag invented.
- **Idempotency / atomicity**: `withSerializableRetry` (copied from `coa-service`/`gl-service`
  pattern) wraps ScheduleDetail + open-item-or-application writes in one transaction, guarded by a
  DB-unique `source_correlation_id`.
- **Partial/full application, over-application, cross-tenant, closed-item protection**: enforced
  both in the service layer (inside the serializable transaction) and by a DB CHECK constraint
  tying `remaining_balance` to `original_amount`'s sign and magnitude — defense in depth, same
  posture as the rest of the repo (RLS + explicit tenant checks).
- **Reversal/correction**: append-only, matching this repo's existing convention (`APPayment`
  `voidedAt`/`voidReason`, and komdetail's own "amount immutable once posted from a journal entry"
  rule) — a reversal is a new negating `ScheduleApplication` row, never a mutation of the original.
- **Nightly tie-out**: new `ScheduleGlTieOut` table inside schedule-service; compares
  `SUM(remainingBalance)` per `(scheduleNumber, glAccountNumber)` against gl-service's existing
  `GET /trial-balance` ending balance for the same account/period (no new gl-service endpoint).
  `recon-service` is bank-reconciliation-only (different domain) and is not reused. Discrepancies
  are persisted and exposed, never auto-corrected.
- **Unresolved apply-to references** (an application event whose target open item can't be found):
  logged as a warning and the ScheduleDetail line is still written for legacy report fidelity, but
  no phantom application is fabricated. Formal escalation/exception workflow is explicitly S028
  scope and is not built here.

## S027 contract

- **Source**: exclusively `ScheduleOpenItem.remainingBalance` (never re-derives from raw
  `ScheduleDetail` lines) — guarantees reconciliation to S026 totals by construction.
- **As-of-date**: explicit query param, defaults to today; age = asOfDate − (`dueDate` ??
  `transactionDate`) in days, matching `schedprn.cbl`'s documented Julian-date-diff approach
  (`schedprn.extraction.md:65-68`).
- **Buckets**: configurable per tenant (`ScheduleAgingBucketConfig`), not hard-coded, defaulting to
  Current / 1-30 / 31-60 / 61-90 / 90+ — the legacy `CUR/OVR30/OVR60/OVR90` convention
  (`komdetail.extraction.md:151`) extended with the standard AR 1-30 split since legacy did not
  document exact day boundaries.
- **Partial-payment / unapplied-balance handling**: a partially-applied item ages on its
  `remainingBalance`, not its original amount; a fully-unapplied item ages on the full original
  amount; closed items are excluded.
- **Reporting/UI**: new `/api/v1/schedules/:id/aging-report` (bucketed) — additive, does not change
  the existing `/api/v1/schedules/aging` endpoint that `ScheduleInquiry.tsx` already consumes.

## Explicit non-goals (out of scope here)

S028 (exception rules/escalation) and S029 (split/transfer/writeoff) are not started. No changes to
S019/S020 posting-engine or gl-service beyond consuming the existing, unmodified
`JOURNAL_ENTRY_POSTED` event. `r1-integration` is not touched.
