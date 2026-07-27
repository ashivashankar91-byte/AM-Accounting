# ADR-JL-001 — coa-service and gl-service Are Separate Ledgers

**Status:** ACCEPTED (documented limitation, not a defect).
**Referenced by:** S014, S220, S221, S222, S227 certification reports;
GOLDEN-R0 Phase 4 Final Product Closure.

## Context

The Golden R0 controlled fleet built two independently-migrated,
independently-owned services against the manual-journal domain:

- **coa-service** — chart of accounts, fiscal calendar/periods, journal
  draft/validate/post/reverse/void (S013-S219), journal source and sequence
  registries.
- **gl-service** — GL account activity inquiry and search (S220/S221),
  Trial Balance (S014), Balance Sheet/Income Statement (S227), all reading
  from `gl_account_period_balances` and its own posted-ledger tables.

These two services use **separate PostgreSQL databases with separate
migration histories**. There is no synchronous or asynchronous data pipe
copying a journal posted through coa-service into gl-service's ledger
tables in this Golden R0 scope, and vice versa.

## Consequence

A journal created, validated, posted, or reversed through coa-service's
Golden Path (S013-S219) does **not** appear in gl-service's GL Inquiry, GL
Search, Trial Balance, Balance Sheet, or Income Statement, and a balance
recorded in gl-service was not necessarily posted through coa-service's
draft workflow. Any reconciliation performed *between* S220/S221/S014/S227
and S013-S219 in this Golden R0 evidence is therefore one of two honestly
distinguishable kinds, never conflated:

1. **Same-service reconciliation** (real, live): S227's Balance Sheet/Income
   Statement reconciling to S014's Trial Balance — both computed from the
   same gl-service ledger tables via the same `TrialBalanceService`. This is
   a genuine structural proof.
2. **Fixture-level / like-for-like reconciliation** (documented as such, not
   claimed as live cross-service): where S014 evidence was checked against
   an S220 result using the same manually-constructed fixture data on both
   sides, because gl-service and coa-service do not share a live ledger.

No certification report for S014, S220, S221, S222, or S227 claims a live
cross-service reconciliation between coa-service's posted journals and
gl-service's ledger. Where a drill-through or reconciliation *label*
appears in the UI (e.g. S222's account-number correlation), it is
documented as best-effort correlation, proven live to honestly report "no
matching account" rather than fabricate a match.

## Options considered (not pursued in Golden R0 scope)

- **Merge into one service/one database.** Rejected for this release: too
  large a change to the already-certified coa-service surface area within
  the Golden R0 timeline; would require re-certifying every coa-service
  story.
- **Build a real-time sync pipe (outbox/CDC) from coa-service into
  gl-service's ledger tables.** Not built in this scope; flagged as the
  natural next step for a scoped follow-up release if live cross-service
  drill-through becomes a hard product requirement.
- **Fabricate cross-service reconciliation evidence.** Explicitly rejected
  per the zero-fabrication mandate governing this entire certification.

## Current disposition (GOLDEN-R0 Phase 4)

This ADR remains **accepted as a known, disclosed limitation**, not a
defect blocking any of S014/S220/S221/S222/S227's DONE_PENDING_INTEGRATION
status. The limitation is carried forward, unchanged, into Phase 4 Final
Product Closure. No new work was undertaken in Phase 4 to close this gap;
it is explicitly out of scope for Golden R0 and is listed in the known
limitations register (`MODULE_STATE.json` `_meta.phase4Note`,
`STORY_CERTIFICATION_MATRIX.csv`, and `CURRENT_RELEASE.md`).
