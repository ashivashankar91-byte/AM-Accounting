# UQ-15 — Audit Log Retention / WORM Tiering

**Status:** OPEN QUESTION, unresolved by engineering (requires a real
business/compliance decision). Explicitly does not block R0/Golden-R0
completion per the approved S007 Story Contract Definition of Done.

## What UQ-15 is

The approved S007 (Immutable Audit Log) Story Contract's Definition of Done
includes BR7-3: audit-log **retention and WORM (write-once-read-many)
tiering**. Question UQ-15 (raised during the original story-contract
authoring, referenced throughout `S007_WRITE_PATH_COVERAGE_CENSUS.md`) asks:
how long must audit events be retained, and by what mechanism should older
events be moved to (or additionally protected by) true WORM storage, beyond
what this repository's application-level immutability trigger provides
today?

This is fundamentally a **business/compliance/regulatory question**
(retention period, applicable jurisdiction rules, cost tradeoffs of a
managed WORM tier such as S3 Object Lock/Glacier Vault Lock or an
equivalent), not a technical implementation question engineering can decide
unilaterally.

## Current state (what IS implemented)

- **Application-level immutability**: `audit_logs` rows are protected by a
  database trigger rejecting `UPDATE`/`DELETE` (confirmed deployed to both
  the fresh-certification DB and the live `amacc` DB during Phase 3; a
  real defect where this trigger had never been deployed by `prisma migrate
  deploy` was found and fixed in this Golden R0 effort).
- **Hash-chain tamper detection (BR7-2)**: `verifyChain()` in
  `services/audit-service/src/application/audit-service.ts` proves
  contiguous, unbroken hash linkage forward from a partition's genesis
  event (fixed in Phase 3, commit `2875ced`; extended in Phase 4 for the
  legacy pre-chain cutoff — see `LEGACY_AUDIT_CHAIN_DECISION.md`).
- **No retention/expiry job exists.** Nothing in this codebase deletes,
  archives, or tiers audit rows today; every row, once written, is kept
  indefinitely in the primary `audit_logs` table.
- **No dedicated WORM storage tier exists.** All audit data lives in the
  same PostgreSQL database as the rest of the operational data; there is no
  separate archival store.

## Why this is intentionally NOT resolved in Golden R0

Per the approved S007 Story Contract, BR7-3 was explicitly scoped as
`PENDING UQ-15` from the outset — retention/WORM tiering was never a
Golden R0 in-scope deliverable, and fabricating a retention policy or a
WORM-tier implementation without a real compliance/business decision would
itself violate the zero-fabrication mandate governing this project (it
would encode an arbitrary retention period as if it were an approved
requirement).

## Disposition (GOLDEN-R0 Phase 4)

UQ-15 remains **OPEN**, unchanged by this Phase 4 closure pass. It is
carried forward explicitly as a known limitation (not silently dropped) in:

- `MODULE_STATE.json` (`_meta.phase4Note`, S007 entry).
- `STORY_CERTIFICATION_MATRIX.csv` (S007's `RemainingGapToFullDONE` column
  already states `BR7-3 retention/WORM tiering explicitly PENDING UQ-15 per
  approved Story Contract DoD; does not block DONE.`).
- `CURRENT_RELEASE.md` (auto-generated from `MODULE_STATE.json`).

**Recommended next step (not performed here):** a real Product
Owner/compliance decision defining (a) minimum retention period per event
category, and (b) whether a managed WORM tier (e.g. S3 Object Lock) is
required in addition to the existing application-level immutability
trigger and hash-chain — followed by a scoped implementation story once
that decision exists.
