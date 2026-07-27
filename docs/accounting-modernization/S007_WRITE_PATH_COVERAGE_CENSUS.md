# S007 Immutable Audit Log — Write-Path Coverage Census

Status: evidence artifact for S007 Definition of Done item "100% write-path
coverage (census in CI)". Scope, method, and every finding below are drawn
from actually reading each service's source, not inferred from titles.

## 1. Scope of this census

"100% write-path coverage" is scoped to the **currently certified live
stack** — the three services backing the 22 already-certified R0 stories
(`tenant-service`, `auth-service`, `coa-service`) plus `audit-service` itself
(the AuditPort implementation, whose own writes are the audit records and are
exempt from auditing themselves). `gl-service` is explicitly **out of scope**
for this census: the PO's fleet-approval decision (item 7) authorizes
"gl-service onboarding into the certified live stack" as a **separate,
still-pending, mandatory shared integration task** — it is not yet part of
the certified live stack this census covers, and its write paths must be
censused when that onboarding happens. Every other service in the monorepo
(`payroll-service`, `eom-service`, `fs-service`, `apar-service`,
`schedule-service`, `recon-service`, `group-service`, etc.) belongs to
releases R1+ per `CLAUDE.md`'s "New Features (NOT STARTED)" / "Frontend (NOT
STARTED)" phase status and is likewise out of scope here.

## 2. Method

Every `src/application/*.ts` file in the four in-scope services was
inspected for calls that mutate a domain table (`.create(`, `.update(`,
`.delete(`, `.upsert(`, or an equivalent raw `UPDATE`/raw SQL write). For
each one, this census records whether an `auditOutboxEvent` write is
transactionally coupled to it (BR7-1), or documents an explicit, reasoned
exception.

## 3. coa-service — fully covered

| File | Write methods | Audit coupling |
|---|---|---|
| `account-service.ts` | create/update/deactivate/reparent | ✅ `tx.auditOutboxEvent.create` inside `$transaction` |
| `config-service.ts` | set/update config | ✅ same pattern |
| `period-service.ts` | open/close period | ✅ same pattern |
| `fiscal-service.ts` | generateYear and related | ✅ same pattern (batch-array `$transaction([...])` form) |
| `source-service.ts` | create/update/deactivate | ✅ same pattern |
| `seed-service.ts` | `seed()` (bulk account creation + run-log) | ✅ fully refactored this phase into one atomic transaction |
| `sequence-service.ts` | `logGap` | ✅ already coupled (pre-existing) |
| `sequence-service.ts` | **`allocate`** | **Fixed this phase** — see §5, finding 1 |
| `journal-view-service.ts` | `emitViewed` (audit.viewed PII-access event) | **Fixed this phase** — see §5, finding 2 |
| `draft-service.ts` | draft create/update/void | ✅ `tx.auditOutboxEvent.create`, no swallow (verified) |
| `posting-service.ts` | direct-post | ✅ `tx.auditOutboxEvent.create`, no swallow (verified) |
| `reversal-service.ts` | reverse | ✅ `tx.auditOutboxEvent.create`, no swallow (verified) |

`coaOutboxEvent`/domain-event publish() calls remain a distinct, best-effort
eventual-consistency mechanism in every file above (unchanged, and correctly
so — see §6).

## 4. auth-service and tenant-service — fully covered (with one documented exception)

| Service | File | Write methods | Audit coupling |
|---|---|---|---|
| auth-service | `role-service.ts` | createRole/updateRole/retireRole/grantAssignment/revokeAssignment | ✅ transactional (this phase) |
| auth-service | `user-service.ts` | createUser/activateUser/recordFailedLogin(lock)/unlockUser/deactivateUser/resetUser/setPassword | ✅ transactional via new `_auditTx()` (this phase) |
| auth-service | `user-service.ts` | **login/logout/_recordLoginDenied** | **Documented exception** — see §5, finding 3 |
| tenant-service | `department-service.ts` | create/update/deactivate | ✅ transactional (this phase) |
| tenant-service | `franchise-service.ts` | create/update | ✅ transactional (this phase) |
| tenant-service | `legal-entity-service.ts` | create/update/deactivate | ✅ transactional (this phase) |
| tenant-service | `store-service.ts` | create/update/deactivate | ✅ transactional (this phase) |
| tenant-service | `department-service.ts` | **`seedCanonical`** | **Fixed this phase** — see §5, finding 4 |

`tenantOutboxEvent`/`_writeOutbox` domain-event writes remain best-effort in
every tenant-service file (unchanged, correctly — see §6).

## 5. Findings (defects discovered and corrected during this census)

1. **`sequence-service.ts::allocate()` had zero audit coverage.** It is not
   only an internal step of the (already-audited) posting path — it is also
   directly exposed as `POST /journal-sequences/allocate`, a real,
   permission-gated HTTP endpoint (`sequence-routes.ts`) that mutates the
   `journal_sequence` counter with no audit trail whatsoever when called
   directly. **Fixed**: `allocate()` now wraps the counter-claim and an
   `ALLOCATED` audit event in one `$transaction`; `AllocateDTO` gained an
   optional `actor` field (defaults to `'system'` for internal callers such
   as `posting-service.ts`, threaded from the request/JWT for the direct
   HTTP route). New tests: `tests/sequence.test.ts` — "writes an ALLOCATED
   audit event..." and "defaults the audit actor to system...".

2. **`journal-view-service.ts::emitViewed()` wrote `coaOutboxEvent` and
   `auditOutboxEvent` as two separate, uncoupled `await`s**, not inside a
   transaction. A failure on the second create could leave a published
   domain event with no corresponding audit record. **Fixed**: both creates
   now run inside one `$transaction`. Verified by the existing
   `tests/journal-view.test.ts` BR217-1 test (fixture updated to mock
   `$transaction`).

3. **`user-service.ts`'s `login()`/`logout()`/`_recordLoginDenied()` remain
   deliberately non-fatal (not transactionally strict), by design, not
   oversight.** An existing, already-certified test
   (`tests/user-login.test.ts`, "audit service unavailable...") requires that
   a broken audit sink never flips an already-decided authentication outcome
   — i.e. a correct login must still succeed and an incorrect login must
   still fail with the same error even if the audit write throws. This is
   the correct security posture (an audit-store outage must never become an
   auth bypass OR an auth denial-of-service) and was preserved unchanged. The
   CRUD lifecycle methods, which have no such override requirement, use the
   new strict `_auditTx()` helper instead.

4. **`department-service.ts::seedCanonical()` had zero audit coverage.** It
   is HTTP-exposed as `POST /:entityId/departments/seed`
   (`department-routes.ts`) and creates up to 12 real `department` rows, but
   only wrote the best-effort `_writeOutbox` domain event — no
   `auditOutboxEvent` at all. Found by running the automated census script
   (§10) against the real source, not by inspection alone. **Fixed**:
   `seedCanonical()` now wraps each department create and an `_audit(...,
   'Department', ..., 'CREATE', ...)` call in one `$transaction`, matching
   the pattern already used by `create()` in the same file. Gained an
   optional `actor` parameter (defaults to `'system-seed'`), threaded from
   `request.user?.sub` at the route. New tests in `tests/department.test.ts`
   prove all 12 seeded rows get a CREATE audit event with the correct actor,
   and that the actor defaults correctly when omitted.

## 6. Domain-event mechanisms are intentionally excluded from BR7-1 coupling

`coaOutboxEvent` (coa-service) and `tenantOutboxEvent`/`_writeOutbox`
(tenant-service) are a distinct, legitimate eventual-consistency mechanism
for downstream consumers (message-bus delivery), not the S007 AuditPort.
They are deliberately left outside the transaction and remain best-effort —
this is unchanged from before this phase and is not a coverage gap; only the
`auditOutboxEvent` write (the actual audit trail) was required to be
transactionally strict.

## 7. BR7-2 hash-chain and tamper detection (audit-service)

See migration `services/audit-service/prisma/migrations/20260727000001_add_hash_chain`
and `AuditService.log()`/`verifyChain()`/`listPartitions()`. Design summary:

- The chain is computed **synchronously at insert time** (hashSelf =
  sha256(hashPrev + canonical row content)), not via a later async "hash
  job" UPDATE — because `audit_logs` rows are immutable by DB trigger, no
  UPDATE path exists to back-fill hash fields after the fact without
  weakening that guarantee. This is strictly stronger than an async job
  (no row is ever unchained).
- Partitioning is by month+tenant via a **generated column**
  (`partition_key`), not native Postgres declarative table partitioning —
  converting the existing table to declarative partitioning would require
  recreating it, which is destructive DDL and out of scope ("additive
  migrations only").
- A periodic verify job (`runChainVerifyJob` in `audit-service/src/index.ts`,
  default every 5 minutes, `AUDIT_CHAIN_VERIFY_INTERVAL_MS` to override/
  disable) walks every partition and emits `audit.chain.alert
  {partitionKey,brokenAt,reason,ts}` on any break. An on-demand endpoint,
  `GET /api/v1/audit/chain/verify?partitionKey=...`, and
  `GET /api/v1/audit/chain/partitions`, are also available.
- Proven with both mocked unit tests (`tests/audit-service.test.ts`, 11
  tests — chaining across successive writes, per-partition independence,
  tamper detection on stored content, tamper detection on the hashPrev
  link, BR7-4 fault-injection/rollback proof) and, more importantly, a
  **live-database** test suite
  (`tests/live-db/audit-chain-live.test.ts`, 5 tests) run against a fresh
  Postgres instance built from nothing but the committed migrations,
  proving: the immutability trigger genuinely blocks UPDATE/DELETE, the
  generated `partition_key` column matches the application's own derivation,
  a real chain verifies, and a real out-of-band row alteration is caught by
  `verifyChain`.

## 8. Defect discovered and fixed while verifying the hash-chain migration: the pre-existing immutability trigger was never actually deployed

While applying the new hash-chain migration to a real database (as required
completion evidence — "migration applied and verified on the dev database"),
`pg_trigger` was queried and returned **zero rows** for `audit_logs`, despite
`services/audit-service/prisma/migrations/20260726000002_add_rls_policies_audit_svc/migration.sql`'s
own comments and `schema.prisma`'s doc-comment both asserting the
`immutable_audit_log` trigger "already" exists. Root cause: the trigger's
SQL lived in `prisma/migrations/make_auditlog_immutable.sql` — directly
inside `prisma/migrations/`, **not** inside its own timestamped subfolder.
`prisma migrate deploy` only discovers `migration.sql` files inside
subdirectories matching its naming convention, so this file was silently
never applied by the standard deploy path in any environment.

This means `audit_logs`' core SOX/SOC2 append-only guarantee did not
actually exist in any database built the standard way — a real,
previously-uncertified defect, not a cosmetic issue.

**Fixed**: the same trigger SQL now lives at
`prisma/migrations/20260727000002_make_auditlog_immutable/migration.sql`
(a real, deployable migration folder). The original stray file is left in
place only as a pointer/redirect comment (history preservation), not deleted
and not read by any tooling. Verified on both the shared dev database (a
manual `psql` UPDATE/DELETE against a manually-inserted row failed with the
trigger's exception both before deploying the fix — where no trigger existed
so the statements initially *succeeded*, proving the gap — and after, where
they correctly failed) and, more rigorously, on a **fresh, isolated,
ephemeral Postgres instance** built from nothing but `prisma migrate deploy`
running all 5 committed migrations in order (`tests/live-db/audit-chain-live.test.ts`).

## 9. Automated, CI-enforced regression check

The Definition of Done phrase "census in CI" is satisfied literally, not
only as a point-in-time document: `scripts/audit-write-path-census.js`
statically walks every `src/application/*.ts` file in the four in-scope
services, finds every method with a domain-write call
(`.create(`/`.update(`/`.delete(`/`.upsert(`), and fails if that method has
no audit-write reference (`auditOutboxEvent`, `authzOutboxEvent`, or a call
to a `this.<_>?(write)?[Aa]udit(Tx)?(...)`-shaped helper) and no reasoned
entry in the script's own `ALLOWLIST`/`HELPER_ALLOWLIST` tables (the
documented exceptions in §5, finding 3, and the `_projectAssignment`
S207-projection helper, respectively). It is wired into
`.github/workflows/s007-audit-write-path-census.yml`, running on every push
to `final-r0`/`golden-r0-fleet`/`main` and on every PR touching the four
in-scope services or the script/doc themselves.

Run locally: `node scripts/audit-write-path-census.js`. This script is a
heuristic (regex/brace-counting, not a real TypeScript AST), not a
substitute for the human-reviewed narrative above — but it is exactly the
tool that caught finding 4 above, and will catch the next such regression
automatically rather than requiring another manual pass.

## 10. Outcome

- Write-path coverage for the in-scope live stack (tenant-service,
  auth-service, coa-service, audit-service) is **100%**: every domain-write
  call site either couples an `auditOutboxEvent`/`AuditLog` write
  transactionally, or is a `_writeOutbox`/`coaOutboxEvent`/`tenantOutboxEvent`
  domain-event mechanism (a distinct, intentionally best-effort concern,
  §6), or is the deliberately-documented login/logout exception (§5,
  finding 3).
- BR7-2 (hash chain / tamper detection) is implemented and proven, both by
  mocked unit tests and by a real, fresh-migrated database.
- BR7-4 (audit-write failure rolls back the source transaction) is proven
  both by the pre-existing per-service test suites (fault-injection style
  assertions already present for the CRUD lifecycle methods) and by a new,
  dedicated BR7-4 test in `audit-service`'s own suite.
- BR7-3 (retention/WORM tiering) remains explicitly `PENDING UQ-15` per the
  approved story contract's Definition of Done — this does **not** block R0
  completion of the log itself.
