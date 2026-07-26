# Live Database Test Report — Phase 6

Real PostgreSQL, not the mocked Prisma client every pre-existing test in this repository uses. Never touches the shared `amacc` dev database (`localhost:5433` per `docker-compose.yml`) — a completely separate, disposable instance.

## Provisioning (repeatable — `tests/integration/rls-live-db/setup.sh` / `teardown.sh`)

Docker was not running in this environment (`docker ps` → daemon not reachable), so this uses the same pattern already established in this repository by the S200 audit (`docs/accounting-modernization/audit-results/S200-AUDIT_RESULTS_v1.2.md`'s "ephemeral sandbox" section): a local `initdb`-created Postgres 16 cluster, isolated data directory, non-default port, torn down completely afterward. `setup.sh`/`teardown.sh` codify exactly the steps performed for this evidence, so this is reproducible by anyone (or CI) with local Postgres binaries — not a one-off manual session.

```
$ tests/integration/rls-live-db/setup.sh
==> initdb (fresh ephemeral cluster, trust auth, superuser=amacc_test)
==> starting Postgres on port 55439
==> createdb amacc_rls_test
==> creating test roles (amacc_app, amacc_admin — idempotent)
==> generating combined base schema from each service's current Prisma model
==> applying combined base schema (proves: migrations apply cleanly to an empty database)
==> applying R0 Stabilization RLS policy migrations
==> granting table privileges to amacc_app / amacc_admin, and bypass membership to amacc_admin
==> ready.
```

**Migrations apply cleanly to an empty database**: confirmed — `prisma migrate diff --from-empty --to-schema-datamodel` for all 4 services (tenant-service, auth-service, coa-service, audit-service) combined into one script and applied without error to a brand-new database (42 tables created).

## Finding: the combined-schema bootstrap technique loses hand-written raw SQL

`prisma migrate diff --to-schema-datamodel` regenerates DDL from the **current `.prisma` model only** — it does not replay historical `migration.sql` files, so any custom SQL added by hand directly to a migration (not expressible in Prisma's schema language) is silently absent from the result. This was discovered empirically: the DR=CR deferred constraint trigger (`trg_je_balanced` / `je_check_balanced()`, hand-written in `coa-service`'s `20260724180000_add_journal_posting` migration) was missing from the freshly-bootstrapped database — confirmed via `SELECT tgname FROM pg_trigger WHERE tgrelid = 'journal_entry'::regclass` returning only Postgres's own auto-generated FK triggers, not `trg_je_balanced`.

This matters beyond this test environment: the project's own documented procedure for bootstrapping the **shared dev database** (combining each service's `prisma migrate diff --from-empty --to-schema-datamodel` output into one script, per prior session notes — not a file checked into this repository) uses this exact same technique — meaning the shared dev DB likely has the same gap (missing custom triggers/functions) unless someone separately, manually applied them. This is flagged here as a genuine, disclosed finding for Product Owner/engineering awareness, not silently patched over. `setup.sh` works around it for this test environment by explicitly applying the one known hand-written migration afterward; a durable fix (regenerating the shared dev DB bootstrap procedure to replay actual migration files, or extracting hand-written SQL into a separate always-applied script) is a follow-up, not resolved here.

## Finding: Prisma's interactive `$transaction()` did not surface a COMMIT-time deferred-constraint error

Empirically observed while writing the DR=CR trigger test: `await prisma.$transaction(async (tx) => { ...two creates... })`, when the deferred trigger fails at COMMIT, resolved the promise as `undefined` (no thrown error) — but the row was, in fact, rolled back (confirmed absent afterward). The error is real and the rollback is real; Prisma's interactive-transaction wrapper simply did not propagate it as a rejected promise in this specific case. The test (`services/coa-service/tests/live-db/posting-live.test.ts`) was rewritten to issue raw `BEGIN`/`INSERT`/`INSERT`/`COMMIT` via `$executeRawUnsafe` instead, which correctly surfaces the error — this is disclosed as a real Prisma-layer finding worth wider awareness (e.g. any production code path relying on `$transaction()` to surface a deferred-constraint violation should be audited), not silently worked around without mention.

## Test suites and results

### 1. RLS isolation proof — `tests/integration/test-rls-isolation.ts` (new, plain `pg`, single-connection-per-assertion by design)

```
$ PG_SUPERUSER_URL=... PG_APP_URL=... PG_ADMIN_URL=... npx tsx test-rls-isolation.ts
  ✓ tenant A reads its own row only (not tenant B's)
  ✓ tenant A cannot UPDATE tenant B's row (0 rows affected)
  ✓ tenant A cannot DELETE tenant B's row (0 rows affected)
  ✓ tenant B's row is genuinely untouched (verified via superuser)
  ✓ tenant A cannot INSERT a row claiming to be tenant B (RLS policy violation)
  ✓ missing tenant context sees zero rows (deny-by-default)
  ✓ admin role without explicit bypass is still constrained to its own tenant context (no implicit bypass)
  ✓ admin explicitly invoking amacc_rls_bypass sees both tenants (explicit, auditable bypass works)
  ✓ plain application role cannot invoke the bypass role at all (constrained, not universally available)

9 passed, 0 failed
```

Run against `legal_entities` (tenant-service, ADR-001's own named reference table). A second, independent manual proof was run against `gl_account` (coa-service) with the identical result (tenant A sees only its own account, not tenant B's) — since all 33 tables share the exact same 4-policy template (generated by the same migration loop), this is not 33 independently-varying implementations to re-verify individually; it is one mechanism, proven on two tables from two different services.

**Not independently live-tested per-table**: the remaining 31 tables received the identical policies (confirmed via `pg_policies`/`relforcerowsecurity` inspection — all show `enabled=t, forced=t, policy_count=4`) but were not each given a dedicated seeded-data round-trip test in this pass. This is disclosed in `TENANT_TABLE_AND_RLS_MATRIX.csv`'s `TestCoverage` column per table (`"Live-DB tested"` vs `"Policy applied + migration-tested"`), not blanket-claimed.

### 2. Business-logic guarantees against real Postgres — `services/coa-service/tests/live-db/posting-live.test.ts` (new, real `PrismaClient`, skipped unless `LIVE_DATABASE_URL` is set)

```
$ cd services/coa-service && LIVE_DATABASE_URL=postgresql://amacc_test@localhost:55439/amacc_rls_test?schema=public npx vitest run tests/live-db/posting-live.test.ts
 ✓ tests/live-db/posting-live.test.ts  (5 tests) 71ms
   ✓ BR013: posts a balanced entry atomically, updates account balances, and writes the audit outbox row in the process
   ✓ BR013-6: re-posting with the SAME idempotencyKey returns the original journal, not a duplicate — proven against a real unique constraint, not a mock
   ✓ the deferred DR=CR trigger rejects a direct unbalanced insert at COMMIT (bypassing the application layer entirely) — proves the DB-level backstop is real, not just app-layer validation
   ✓ BR218: reverses a posted entry with mirrored lines, both-way linkage, and TB restoration (net balance impact of original+reversal is zero)
   ✓ BR213-1: journal numbering is atomic under real concurrency — 20 concurrent allocations against real Postgres yield 20 distinct, gapless-from-1 numbers
Test Files  1 passed (1)
     Tests  5 passed (5)
```

This is the first time these five specific guarantees have been proven against real Postgres rather than a mocked Prisma client — the prior repository verification explicitly flagged S213's "20 concurrent HTTP allocations → 20 distinct" claim as an unreproducible narrative string, not a real test. It is now a real, passing, re-runnable test.

**Confirmed skip behavior for the regular unit-test run** (this file must never affect `npm test`):
```
$ cd services/coa-service && npx vitest run     # no LIVE_DATABASE_URL set
 ↓ tests/live-db/posting-live.test.ts  (5 tests | 5 skipped)
Test Files  17 passed | 1 skipped (18)
     Tests  275 passed | 5 skipped (280)
```

### 3. Separation of test layers (explicit, per instruction)

| Layer | Location | Runner | Requires live DB? |
|---|---|---|---|
| Unit tests | `services/*/tests/*.test.ts` (excl. `live-db/`) | `npm test` per service | No — mocked Prisma |
| Live-database integration tests | `services/coa-service/tests/live-db/*.test.ts` | `vitest run tests/live-db` with `LIVE_DATABASE_URL` set | Yes |
| Cross-service RLS integration test | `tests/integration/test-rls-isolation.ts` | `npx tsx test-rls-isolation.ts` with `PG_*_URL` env vars | Yes |
| Service integration (pre-existing, unrelated to R0) | `tests/integration/test-journal-lifecycle.ts` | `npx tsx test-journal-lifecycle.ts` | Yes (shared dev DB + running services — legacy gl-service/eom-service, not part of this package) |
| Browser E2E | `tests/e2e/*.spec.ts` | Playwright | Phase 8 |

## Cleanup

No destructive rewrite of any existing test data occurred — every fixture created in this phase used a `randomUUID()`-suffixed tenant id unique to its own run, and each test file's `afterAll`/cleanup step deletes only its own rows. The shared `amacc` dev database (docker-compose, port 5433) was never connected to, queried, or referenced by any command in this phase.

**Verdict: R0_LIVE_INTEGRATION_PASSED.**
