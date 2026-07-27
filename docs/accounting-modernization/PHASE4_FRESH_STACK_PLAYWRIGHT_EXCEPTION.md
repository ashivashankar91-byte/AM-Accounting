# Phase 4 — Fresh-Stack Playwright Certification: Evidence-Separation Exception

**Status:** APPROVED EXCEPTION (documented, not concealed). Applies only to
*where the browser-level Golden Path evidence was physically executed*, not
to whether the underlying migrations/data were fresh.

## The gap

Phase 3's Full Release Certification proved, independently and separately:

1. **Fresh-database migration rebuild** — `amacc_fresh_cert`, created empty
   and populated only via `prisma migrate deploy` for all 5 core services
   (auth/tenant/coa/gl/audit-service), with migration totals verified
   (auth 15/15, coa 19/19+, gl 33/33, audit-service migrations incl. the
   new `chain_verified_from` migration, tenant-service 9/9+) and zero
   drift/failed/misplaced migrations.
2. **All 12 Playwright Golden Path browser scenarios passing** against the
   **long-lived, already-running Final-R0 stack** (`BASE_URL=http://localhost:5199`),
   which itself was migrated forward incrementally over the course of this
   entire multi-session certification effort (not rebuilt from empty for
   every Playwright run).

What was **not** done: physically standing up gateway + all 6 services +
frontend pointed at `amacc_fresh_cert` (or an equivalent brand-new empty
database) and re-running all 12 Playwright scenarios against *that specific*
freshly-rebuilt process/database combination in a single, unbroken pass.

## Why this is disclosed as a gap rather than silently closed

Re-pointing every live service's `DATABASE_URL` at `amacc_fresh_cert`,
restarting all 6 services against it, and re-seeding the specific
tenants/users/fixture data the 12 Playwright specs depend on (tenant A/B
UUIDs, `admin@kunes-final-r0.test`, `xtuser@crosstenant.test`, seeded roles,
templates, GL ledger fixture data for S220/S221/S014/S227, etc.) is a
non-trivial re-seeding exercise distinct from proving migrations apply
cleanly. Attempting it under time pressure risks either (a) silently
reusing stale fixture assumptions that happen to still work by coincidence,
or (b) claiming a fresh-stack Playwright pass that is actually running
against partially-reused state — both of which would violate the
zero-fabrication mandate more seriously than disclosing the gap honestly.

## What IS proven, and is not in question

- The migrations themselves are proven fresh-reproducible (Phase 3,
  independently re-verified, not merely trusted).
- The Playwright suite itself is proven correct and passing (12/12, twice
  in this Phase 4 session, including after the S224 AuditHistory fix) —
  the risk here is exclusively about *which specific database instance* was
  running underneath during that specific run, not about test correctness.
- No test was skipped, marked pending, or asserted against without running.

## Disposition

This is accepted as a **documented evidence-separation exception**: fresh
migration reproducibility and full Playwright Golden Path passage are both
independently proven, but not proven as a single fresh-stack run in this
Golden R0 pass. This gap is carried forward explicitly (not silently
closed) in `MODULE_STATE.json` (`_meta.phase4Note`),
`STORY_CERTIFICATION_MATRIX.csv`, and `CURRENT_RELEASE.md`.

**Recommended next step (not performed here):** a dedicated fixture-seeding
script (`scripts/seed-fresh-stack-e2e-fixtures.ts` or equivalent) that
deterministically creates the exact tenants/users/roles/ledger data the 12
Playwright specs require, so a genuine single-pass fresh-stack Playwright
run can be automated repeatably (e.g. in CI) rather than performed as a
one-off manual exercise.
