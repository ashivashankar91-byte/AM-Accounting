# S026 Certification Evidence — Schedule Open-Item Core

**Status:** `S026_INTEGRATED_AND_CERTIFIED` (backend/database — see Integration Record below for exact scope)
**Source branch:** `r1-s026-s027-schedule-engine-v2`, certified at `62b5a39`.
**Implementation commit:** `fce3c4e`
**Live browser/database certification closure commit (source branch):** `1297228` (corrective fixes) — see sections 8-13.
**Integrated into `r1-integration`:** 2026-07-30 — see the `integrate(r1): add S026 schedule engine and S027 aging` commit for the full integration record (manifest, shared-frontend reconciliation, auth-catalog renumbering, quality-gate totals).
**Governed by:** `docs/accounting-modernization/S026_S027_IMPLEMENTATION_CONTRACT.md`
**Date:** 2026-07-30

This document is the S026 evidence record. It exists to let a Product Owner
and an Accounting SME independently verify — and then explicitly accept or
reject — the confirmed S026 slice, without re-deriving the evidence
themselves. It does **not** claim S027/S028/S029 status beyond what is
recorded here, and does **not** claim final R1 or production-readiness
certification.

## Integration Record (r1-integration, 2026-07-30)

Selectively integrated from the certified source branch. On `r1-integration`:
schedule-service's full 6-migration chain and auth-service's full migration
chain (including this story's renumbered `1.19.0` catalog entry — see the
integration commit for the exact renumbering) both replay cleanly from an
empty database with zero schema drift; the complete schedule-service suite
(87/87 — 78 unit + all 9 live-database tests) passes against a fully
isolated Postgres instance; `auth-service` (154/154) and `apps/web` (41/41)
suites pass unaffected; TypeScript is clean and the frontend production
build succeeds on the integration branch's own code. S019/S020 posting-engine
regression checked and unaffected (no gl-service/coa-service files were
touched by this integration).

**Not re-executed during this integration pass:** the S026 Playwright
journey against a full isolated integration-branch browser stack — Docker's
daemon was unresponsive (returning 500s / hanging under what appeared to be
resource contention from other concurrent sessions on this shared host,
not a crash) for an extended period during this integration session, and
was not force-restarted since doing so would have stopped other active
sessions' running containers. The journey passed 2/2 on the source branch's
own isolated stack (see section 10) against byte-identical application
code; it should be re-run against `r1-integration` once Docker is
available, before this integration is treated as browser-verified end to
end, not merely backend/database-verified.

## 1. Accepted Scope

- Extends the existing (previously undeployed) Wave-3 `schedule-service`
  scaffold — no new microservice.
- `ScheduleOpenItem`: original/applied/remaining balance, status
  (`OPEN`/`PARTIALLY_APPLIED`/`CLOSED`), created only from a successfully
  posted `JOURNAL_ENTRY_POSTED` line whose GL account is schedule-linked
  (`GLAccount.scheduleCode`, gl-service's existing flag — no new config).
- `ScheduleApplication`: append-only application/reversal history against an
  open item. Partial and full application; reversal via a new negating row
  (never a mutation of the original).
- UQ-18 (Control#/Apply# schedule-key semantics) resolved via its own
  recorded interim assumption: `schedule_key = (tenantId, scheduleNumber,
  controlNumber)`, open-item identity = `schedule_key + itemNumber`
  (`referenceNumber`, falling back to `journalEntryId`).
- Idempotent, atomic creation: one `SERIALIZABLE` transaction per posted
  line, keyed by the posting event's own per-line `correlationId` — fixes a
  pre-existing defect in the Wave-3 scaffold where the old
  `journalEntryId`-only dedup silently dropped a second schedule-relevant
  line on the same journal entry.
- Over-application, cross-tenant, closed-item, and duplicate-application
  protection, enforced in the service layer **and** by a DB `CHECK`
  constraint (defense in depth).
- Nightly (and on-demand) GL-to-schedule tie-out against gl-service's
  existing `GET /api/v1/gl/trial-balance` — discrepancies persisted and
  exposed, never silently corrected.
- Row-Level Security (schedule-service had none before this), a permission
  catalog extension (`schedule.open_item.*`, `schedule.tie_out.*`), and an
  audit-outbox mechanism (schedule-service had none before this).
- Operator UI: open-item list/filter, manual apply, reversal, and a GL
  tie-out results panel — `apps/web/src/pages/accounting/ScheduleOpenItems.tsx`.

## 2. Explicitly Excluded Scope

- S028 (Schedule Exception Rules & Escalation) and S029 (Schedule Item
  Split/Transfer/Writeoff) — not started.
- Formal escalation/exception workflow for an unresolvable apply-to
  reference (target item not found, or would over-apply from an automated
  posting event) — logged as a warning and surfaced at the next tie-out as a
  discrepancy, not routed through a dedicated exception queue. That queue is
  S028 scope.
- Any change to S019/S020 posting-engine or gl-service beyond consuming the
  already-existing, unmodified `JOURNAL_ENTRY_POSTED` event and calling the
  already-existing `GET /api/v1/gl/trial-balance` endpoint.
- `r1-integration` is untouched.

## 3. Schema & Migrations

`services/schedule-service/prisma/migrations/`:
- `20260518000000_schedule_service_baseline` — captures the pre-existing
  Wave-3 schema (`schedules`, `schedule_details`, `schedule_permissions`,
  `outbox_events`), which had been applied directly against the shared dev
  database with **no Prisma migration history at all** before this branch.
  Baselined via `prisma migrate resolve --applied` (not re-executed —
  the tables and their live data already existed).
- `20260730010000_s026_open_items` — `schedule_open_items`,
  `schedule_applications`, `schedule_details.source_correlation_id`, and the
  `schedule_open_items_balance_check` CHECK constraint.
- `20260730010001_add_rls_policies_schedule_svc` — RLS on all six
  tenant-owned tables (base + new), `outbox_events`/`audit_outbox` excluded
  per the repo-wide convention.
- `20260730010002_add_audit_outbox_schedule_svc` — `audit_outbox` (shared
  physical table; `CREATE TABLE IF NOT EXISTS` per the established
  cross-service pattern).

`services/auth-service/prisma/migrations/20260730010000_extend_authz_catalog_s026_open_items`
— catalog version `1.18.0`, `schedule.open_item.view/apply/reverse`,
`schedule.tie_out.view/run`.

## 4. APIs

```
GET    /api/v1/schedules/:id/open-items
GET    /api/v1/schedules/:id/open-items/:itemId
POST   /api/v1/schedules/:id/open-items/:itemId/apply
POST   /api/v1/schedules/:id/open-items/applications/:applicationId/reverse
GET    /api/v1/schedules/tie-outs
POST   /api/v1/schedules/tie-outs/run
```

All require `x-tenant-id` (400 if missing — this also corrected the
pre-existing base-layer routes in this file, which incorrectly returned 401,
to comply with CLAUDE.md rule #3) and a JWT (401 if missing/invalid), and are
individually permission-gated per section 1.

## 5. Permissions / RLS

See section 3. `schedule.open_item.apply/reverse` and `schedule.tie_out.run`
are ADMIN/CONTROLLER-only; `*.view` keys are also granted to ACCOUNTANT.

## 6. Audit Events

`SCHEDULE_OPEN_ITEM` `CREATED`/`APPLIED`/`MANUAL_APPLY`,
`SCHEDULE_APPLICATION` `REVERSED`, and `SCHEDULE_GL_TIE_OUT`
`DISCREPANCY_DETECTED` — written to `audit_outbox` inside the same
transaction as the domain change, drained by `AuditOutboxDrainer` to the
real S007 audit-service (wiring added; audit-service itself unmodified).

## 7. Test Totals (as of the live browser certification closure, commit `1297228`)

- Focused (mocked) unit tests: 67 (`open-item-service.test.ts` — 19,
  including one added regression test for the docId defect fixed in this
  closure pass; `tie-out-service.test.ts` — 6; plus 42 pre-existing Wave-3
  tests, themselves fixed and, for the first time, actually wired to run:
  they lived at `src/tests/test-*.ts`, a location/naming vitest's default
  glob never picked up, so they had never executed before this branch).
- Live-database tests (real, fully isolated Postgres — see Gate 1 below):
  9 (`live-db/open-item-live.test.ts` ×5, `live-db/tie-out-live.test.ts`
  ×2, `live-db/aging-live.test.ts` ×2 — the S027 aging live tests also
  exercise S026 open-item creation as their fixture data).
- Combined schedule-service suite: **87/87 passing** — 78 unit + 9
  live-database, verified against a fully isolated Postgres instance (Gate 1).
- `tsc --noEmit` (schedule-service, `apps/web`, `auth-service`): clean.
- `apps/web` `vite build`: clean (production build succeeds; pre-existing
  >500kB chunk-size warning is unrelated to this change).
- `apps/web` vitest: 41/41 passing (pre-existing suite, unaffected).
- `auth-service` vitest: 154/154 passing (unaffected — only migration files
  were added, no `src/` changes).

## 8. Gate 1 — Isolated Live Database

A disposable, single-purpose Postgres instance, entirely separate from any
shared development database:

- Container: `s026s027-cert-pg` (plain `docker run`, not part of any
  compose project), image `postgres:15`.
- Host port: `55432` → container `5432` (verified free before use).
- Database: `amacc_cert`, superuser `amacc_cert` / `amacc_cert_dev_only`
  (throwaway credentials, generated for this session, never committed).
- Migration replay: all 6 schedule-service migrations
  (`20260518000000_schedule_service_baseline` through
  `20260730020001_add_rls_policies_aging_config_schedule_svc`) applied via
  `prisma migrate deploy` from a **freshly created, empty** database.
  `prisma migrate diff --from-url ... --to-schema-datamodel` against the
  result: `-- This is an empty migration.` (zero drift). Replayed twice in
  this closure pass (once before the corrective fix, once after, to prove
  the fix was schema-neutral) with the identical zero-drift result both
  times.
- All 9 live-database tests passed against this instance (section 7),
  covering: RLS/tenant isolation (a real, throwaway, non-`BYPASSRLS`
  Postgres role, created and dropped by the test itself), idempotent
  open-item creation, partial and full application, two concurrent manual
  applications resolving to exactly one winner (real `SERIALIZABLE`
  transaction, not application-level locking), over-application prevention
  (both the service-layer check and a raw-SQL-bypassing-the-app-layer proof
  of the DB `CHECK` constraint), tie-out persistence, audit evidence (a
  direct query of the real `audit_outbox` rows an open item's
  create+apply+apply lifecycle produces — this is what caught the docId
  defect below), and aging reconciliation to an independent DB aggregate.
- Torn down after use (`docker stop`/`rm`) — no resources left running.

## 9. Gate 2 — Isolated Live Browser Stack

A complete, isolated application stack built entirely from this branch's
own source, under a unique Docker Compose project name so it could not
collide with or disturb any other active stack in this shared environment:

- Compose project: `s026s027cert2` (`docker compose -p s026s027cert2 -f
  docker-compose.yml -f <scratchpad>/docker-compose.cert-override.yml`).
  The override file uses Compose's `!override` YAML merge tag (plain list
  merging otherwise *appends* to, rather than replaces, the base file's
  hardcoded host ports and `depends_on` lists — confirmed empirically
  before proceeding).
- Services, all built from this branch's current source
  (`docker compose build`, not pulled images): `postgres`, `redis`,
  `rabbitmq`, `auth-service`, `gl-service`, `schedule-service`,
  `api-gateway`, `web`. `tenant-service` and the various `agent-*`/other
  domain services were deliberately excluded — the S026/S027 browser
  journeys authenticate via `tenantId` fixed at login (independent of
  legal-entity selection; see `apps/web/src/auth/AuthContext.tsx`) and
  never call tenant-service, so including it (and the large transitive
  `depends_on` graph api-gateway's base definition carries) would not have
  added certification value.
- Host ports (all pre-verified free): postgres `61432`, redis `61379`,
  rabbitmq `61672`/`61673`, auth-service `61001`, gl-service `61010`,
  schedule-service `61018`, api-gateway `61100`, web `61174`.
- Database: fresh volume, `amacc_app` role auto-created by the existing
  `infra/postgres/init/01-create-app-role.sql` init script (mounted
  unmodified) — confirming application services genuinely connect through
  the RLS-enforcing role, not the bypassing superuser.
- Migrations: full `prisma migrate deploy` histories for `auth-service`
  (25 migrations, including this branch's own `1.18.0`/`1.19.0` catalog
  additions), `gl-service` (full history), and `schedule-service` (6
  migrations) all applied from empty against this one shared database —
  matching the real multi-service-shares-one-database production topology.
  One environment-level (not code-level) accommodation was required:
  `outbox_events` is not namespaced per service (unlike `audit_outbox`,
  which already uses `CREATE TABLE IF NOT EXISTS` for exactly this reason)
  — gl-service's migration creates a table literally named `outbox_events`,
  and schedule-service's own baseline migration creates a table of the same
  name with identical columns. Applying both migration chains to a single
  fresh database (never previously exercised — every prior run of these
  histories was against a database where only one service's migrations had
  ever run) surfaces this pre-existing collision. Not a committed migration
  file was modified for this: the environment's `schedule_service_baseline`
  migration was applied with only that one already-satisfied `CREATE TABLE`
  statement skipped (verified column-for-column identical first), then
  marked applied via `prisma migrate resolve`, exactly the same
  already-established technique this branch's baseline migration itself
  documents for the pre-existing Wave-3 tables.
- Secrets (`AMACC_JWT_SECRET`, `JWT_SECRET`, `ADMIN_API_KEY`,
  `AMACC_INTERNAL_TOKEN`): freshly generated (`openssl rand -hex`) into a
  scratchpad-only `.env.cert` file, passed via `--env-file`, never written
  into this repository.
- Fixture data: two auth-service users seeded via the repo's own
  `services/auth-service/scripts/bootstrap-role-user.ts` (ADMIN role,
  holding the S026/S027 permission set; a `SCHEDULE_NO_GRANT` role, holding
  none of them) — verified end to end with real `curl` calls through the
  gateway (login, then a `schedule.open_item.view`-gated call) before any
  browser test ran: the no-grant user's call returned a real
  `403 {"reason":"NO_MATCHING_ROLE"}`. Schedule master rows and open items
  were seeded by calling `OpenItemService.processPostingEvent` directly
  against the isolated database (the same production code path the real
  `JOURNAL_ENTRY_POSTED` consumer uses) — not fixtures written straight
  into the open-item tables.
- Torn down after use (`docker compose down -v`, then the built images
  removed) — no resources left running; nothing else in this shared
  environment was stopped or modified.

## 10. Playwright — S026 Result

`tests/e2e/s026-schedule-open-items.spec.ts`, executed against the Gate 2
stack (`BASE_URL=http://localhost:61174`): **2/2 passing**, reproduced
clean on two consecutive runs after the corrective fixes in this closure
(commit `1297228`) — see that commit message and section 11 below for the
two real defects (and two test-only bugs) this run actually found. HTML
report and screenshots were generated locally under `test-results/` /
`playwright-report/` during this session (both gitignored, not committed —
ephemeral artifacts of an isolated, subsequently-torn-down stack; not a
permanent, browsable location, consistent with the disposable-environment
approach directed for this closure).

## 11. Defects Found and Corrected (this closure pass)

1. **Production defect (fixed):** `OpenItemService.processPostingEvent`'s
   `CREATED` audit event wrote a composite `"schedule:control:item"` string
   as `docId` instead of the real `ScheduleOpenItem.id` every other
   `SCHEDULE_OPEN_ITEM` audit event uses — found by a live-database
   assertion querying real `audit_outbox` rows (the mocked unit suite never
   asserted on `docId`). Fixed; regression coverage added at both the unit
   and live-database level.
2. **Production defect (fixed):** `ScheduleOpenItems.tsx` rendered each
   open-item table row as a bare `<>` fragment with no `key` prop — a real
   React defect, found by a live-browser Playwright run's console-error
   assertion (`Warning: Each child in a list should have a unique "key"
   prop`). Fixed with an explicit `<Fragment key={item.id}>`.
3. **Test problem (fixed):** the S026 Playwright journey's reversal step
   used `.first()` on the reverse-application buttons, reversing the
   chronologically-earliest (75.00) application instead of the intended
   most recent (125.00) one — masked by an imprecise
   `row.toContainText('125.00')` assertion that happened to match a
   *different* column's coincidentally-equal value. Fixed to `.last()` plus
   cell-precise assertions targeting the Remaining column specifically.
4. **Test problem (fixed):** both Playwright specs' failed-request
   listeners were unscoped and occasionally caught unrelated third-party
   resource failures (a Google Fonts CDN request) in this sandbox. Scoped
   to `/api/` requests only.
5. **Environment problem (worked around, not a code defect):** with no
   `audit-service` present in this minimal isolated stack, the pre-existing
   `@amacc/shared-kernel` `AuditOutboxDrainer` (not S026/S027 code — the
   same shared component `tenant-service`/`auth-service`/`coa-service`/
   `apar-service` already use identically) retries every undelivered
   `audit_outbox` row on every 5-second poll cycle indefinitely, with no
   backoff cap. Combined with a slow DNS-NXDOMAIN failure against the
   default `http://audit-service:3031` hostname, this produced intermittent
   multi-second request latency spikes that occasionally tripped
   api-gateway's proxy timeout — the browser would see a false
   `500 Internal Server Error` on a request whose underlying transaction
   had, in fact, already committed successfully (confirmed by querying the
   database directly: the mutation was present despite the reported
   client-side failure). Worked around for this isolated environment by
   pointing `AUDIT_SERVICE_URL` at an unbound local port (`http://127.0.0.1:1`,
   which `fetch` rejects near-instantly rather than incurring a slow DNS
   timeout) and by periodically clearing the accumulated `audit_outbox`
   backlog between certification runs. This is a disclosed characteristic
   of the pre-existing shared-kernel audit-delivery component under a
   long-unreachable audit-service, not a change to any S026/S027 code, and
   is out of this narrow closure's scope to fix.

## 12. UQ-18 Status

`schedule_key = (tenantId, scheduleNumber, controlNumber)` remains recorded
as `INTERIM_ACCEPTED_IMPLEMENTATION_ASSUMPTION` — the interim assumption
already on record in `OPEN_QUESTIONS_AND_DECISIONS.md` for UQ-18, adopted
as-is (see `S026_S027_IMPLEMENTATION_CONTRACT.md`). UQ-18 is **not**
described as permanently closed: no explicit Product Owner / Controller SME
decision has been recorded superseding the interim assumption, and final
product confirmation may still change Control Number and Apply Number
semantics.

## 13. Auth Catalog Version Collision (documented, not fixed here)

- S026 (this branch): `auth-service` catalog version `1.18.0`
  (`20260730010000_extend_authz_catalog_s026_open_items`).
- S027 (this branch): `auth-service` catalog version `1.19.0`
  (`20260730020000_extend_authz_catalog_s027_aging`).
- S038 (a separate, sibling feature branch not present in this worktree):
  reported by the integration coordinator to also claim catalog version
  `1.18.0`. This cannot be independently verified from this worktree (no
  S038 migration file exists here to inspect) and is recorded as asserted
  by the closure instructions, not directly confirmed by this branch's own
  evidence.
- Status: `AUTH_CATALOG_VERSION_RENUMBERING_REQUIRED_DURING_SELECTIVE_INTEGRATION`.
  This is the same, already-established renumbering pattern this branch's
  own `20260730010000_extend_authz_catalog_s026_open_items` migration
  itself documents happening to it (originally `1.13.0`, renumbered around
  S011/S032/posting-engine). Per this closure's explicit instructions, no
  certified feature migration in this branch is modified or renumbered
  here; resolution is deferred to whichever branch integrates second.

## 14. Known Limitations

- Unresolved apply-to references (target item not found, or would
  over-apply) are logged and become visible at the next tie-out as a
  discrepancy, but are not routed through a dedicated exception/escalation
  workflow — that is explicitly S028 scope.
- The GL tie-out compares against gl-service's per-account **period** ending
  balance (`/api/v1/gl/trial-balance?year=&month=`), not an arbitrary
  as-of-date balance — a limitation of the existing gl-service API surface,
  not something this change could address without modifying gl-service
  (out of scope per the task's explicit boundary).
- The Gate 2 isolated stack's `audit_outbox` mitigation (section 11, item 5)
  is environment-specific to this closure session; a persistently-deployed
  environment should run a real `audit-service` rather than relying on the
  fast-failing-URL workaround.

## 15. References

- `docs/accounting-modernization/S026_S027_IMPLEMENTATION_CONTRACT.md`
- `docs/gap-analysis/wave-3-schedule-subsystem.md`
- `docs/cobol-extractions/komdetail.extraction.md`,
  `schedmgr.extraction.md`, `schedprn.extraction.md`
- Canonical backlog: `S026` — `docs/accounting-modernization/AutoMate2_Accounting_Backlog_Package_v1.1.zip:out/canonical_registry.json`
