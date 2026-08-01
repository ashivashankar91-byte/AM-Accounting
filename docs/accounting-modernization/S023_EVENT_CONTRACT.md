# S023 — EVENT CONTRACT (approved 2026-08-01)

Status: `S023_APPROVED_EXCEPT_ACCOUNT_MAPPING_VALUES`. See `S023_DECISION_REGISTER.md` for the full decision record.

## Canonical SourceEventEnvelope (D-06 — one envelope for AP, AR and Cash; producer-side changes to S039, S043A, S052 are IN SCOPE)

Required fields: `tenantId` · `legalEntityId` · `eventId` (unique) · `schemaVersion` · `sourceSystem` · `sourceEntityType` · `sourceEntityId` · `businessDate` · `correlationId` · `idempotencyIdentity` (deterministic per source doc + event type; duplicates return original result) · `accountingAmounts[]` (amount, currency, kind e.g. NET/TAX/GROSS per family) · `accountingReferences[]` (documentNumber, control/apply references per the UQ-18 outcome — slot defined, exact semantics pending the two surviving program dependencies recorded in `S023_DECISION_REGISTER.md`) · optional `storeId`/`departmentCode` as mapping dimensions (D-10).

Envelope rules: missing mandatory field → deterministic rejection naming the field (AC-9); `schemaVersion` governs compatibility; producers version forward additively.

This replaces the three incompatible shapes that exist today: coa-service's structured `SourceEventEnvelope` (the only current producer emitting the full envelope shape), cash-service's generic `cashOutboxEvent` (missing `eventId`, `schemaVersion`, `sourceSystem`, `sourceEntityType/Id`, `businessDate`), and apar-service's generic `outboxEvent` helper (same gaps).

## Consumed event families (v1)

**AP:** `ap.invoice.accepted` · `ap.invoice.posted-request` (with tax lines received per D-18) · `ap.payment.posted` (S043A).
**AR/Cash:** `cash.receipt.applied` (S052) · `cash.deposit.posted` (S053) · `ar.invoice.posted-request` (**DEFINED_NOT_YET_EXERCISED** until CE-09 AR producers exist — labeled in the matrix; S048 has no commit or branch anywhere in this repository today).

## Emitted (D-35)

`pack.version.created` / `pack.version.activated` (with author, activator, diff ref) · `rule.evaluation.completed` (outcome, pack version, correlationId) · `rule.evaluation.failed` (taxonomy code → S021 case linkage — S021 is merged and certified on `r1-integration`) · via the engine: `journal.posted` (existing S019/S020 emission, version-pinned).

## Tax boundary (D-18)

Packs map received tax lines to accounts only; zero tax calculation (CE-10 owns); expected-but-absent tax lines → deterministic rejection.
