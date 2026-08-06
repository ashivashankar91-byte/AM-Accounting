# S023 — EVENT CONTRACT (approved 2026-08-01)

Status: `S023_APPROVED_EXCEPT_ACCOUNT_MAPPING_VALUES`. See `S023_DECISION_REGISTER.md` for the full decision record.

## Canonical SourceEventEnvelope (D-06 — one envelope for AP, AR and Cash; producer-side changes to S039, S043A, S052 are IN SCOPE)

Required fields: `tenantId` · `legalEntityId` · `eventId` (unique) · `schemaVersion` · `sourceSystem` · `sourceEntityType` · `sourceEntityId` · `businessDate` · `correlationId` · `idempotencyIdentity` (deterministic per source doc + event type; duplicates return original result) · `accountingAmounts[]` (amount, currency, kind e.g. NET/TAX/GROSS per family) · `accountingReferences[]` (documentNumber, control/apply references per the resolved UQ-18 model: `scheduleNumber`/`controlNumber`/`applyNumber`/`referenceNumber`/`itemNumber` — see `S023_DECISION_REGISTER.md` → "Two program dependencies — RESOLVED") · optional `storeId`/`departmentCode` as mapping dimensions (D-10).

**AP tax-event normalization (approved 2026-08-01):** `ap.invoice.accepted` and `ap.invoice.posted-request`, when both are received for the same invoice, resolve to the **same** `idempotencyIdentity` — `ap.invoice.posted-request` is an internal posting-request / compatibility alias, never a second envelope that produces its own journal. The first-arriving event under that shared identity posts; the second returns the original result via the existing D-24 idempotency mechanism. See `S023_ACCOUNTING_RULE_MATRIX.md` for the full rule.

Envelope rules: missing mandatory field → deterministic rejection naming the field (AC-9); `schemaVersion` governs compatibility; producers version forward additively.

This replaces the three incompatible shapes that exist today: coa-service's structured `SourceEventEnvelope` (the only current producer emitting the full envelope shape), cash-service's generic `cashOutboxEvent` (missing `eventId`, `schemaVersion`, `sourceSystem`, `sourceEntityType/Id`, `businessDate`), and apar-service's generic `outboxEvent` helper (same gaps).

## Consumed event families (v1)

**AP:** `ap.invoice.accepted` (single authoritative event — carries any tax lines received per D-18) · `ap.invoice.posted-request` (normalized alias of `ap.invoice.accepted` for the same invoice — never an independent posting, see the normalization note above) · `ap.payment.posted` (S043A).
**AR/Cash:** `cash.receipt.applied` (S052) · `cash.deposit.posted` (S053) · `ar.invoice.posted-request` (**DEFINED_NOT_YET_EXERCISED** until CE-09 AR producers exist — labeled in the matrix; S048 has no commit or branch anywhere in this repository today).

## Emitted (D-35)

`pack.version.created` / `pack.version.activated` (with author, activator, diff ref) · `rule.evaluation.completed` (outcome, pack version, correlationId) · `rule.evaluation.failed` (taxonomy code → S021 case linkage — S021 is merged and certified on `r1-integration`) · via the engine: `journal.posted` (existing S019/S020 emission, version-pinned).

## Tax boundary (D-18)

Packs map received tax lines to accounts only; zero tax calculation (CE-10 owns); expected-but-absent tax lines → deterministic rejection.
