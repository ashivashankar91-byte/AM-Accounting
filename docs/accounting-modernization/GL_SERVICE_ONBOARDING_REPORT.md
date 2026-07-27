# GL Service — Certified Live-Stack Onboarding Report

**Date:** 2026-07-27
**Branch:** `golden-r0-fleet` (worktree `AM-Accounting-final-r0`)
**Onboarding status after this report:** `PASS_FOR_SHARED_STACK_ONBOARDING`

## 1. Scope

This work onboarded the pre-existing legacy `services/gl-service` into the controlled live stack without
rewriting business behavior: Prisma-compatible migrations from zero, database-level tenant isolation via
RLS, centralized S207 authorization, S007 audit delivery, fresh-database reproducibility, TypeScript/test
validation, and representative gateway/runtime verification. This was **not** an S014/S222/S227 feature
implementation; it is the shared hardening prerequisite those stories can now build on.

## 2. What was built

- **Prisma migration normalization for gl-service**
  - Converted the 22 loose SQL files under `services/gl-service/prisma/migrations/` into real Prisma
    migration folders (`<timestamp>_<name>/migration.sql`) and added
    `services/gl-service/prisma/migration_lock.toml` with `provider = "postgresql"`.
  - Preserved each historical loose SQL file's body byte-for-byte inside its new `migration.sql`; only
    the Prisma wrapper format changed.
  - Added a real bootstrap migration `20260506000000_init_gl_service` from the repo's existing
    `gl-init.sql`, plus compatibility shim migrations required to make the historical sequence actually
    deploy from an empty database.

- **Fresh-database-safe additive schema fixes**
  - Added `20260728010003_add_is_intercompany_flag_gl_svc` because runtime/schema expected
    `gl_accounts.is_intercompany` but no committed migration created it.
  - Added `20260728010004_add_ic_counterpart_entry_id_gl_svc` because runtime/schema expected
    `journal_entries.ic_counterpart_entry_id` but no committed migration created it.

- **Database-level RLS for tenant-owned GL tables**
  - Added `20260728010001_add_rls_policies_gl_svc` using the same certified 4-policy pattern already in
    coa-service/auth-service: SELECT/INSERT/UPDATE/DELETE policies keyed off
    `current_setting('app.current_tenant_id', true)` plus `FORCE ROW LEVEL SECURITY`.
  - Covered direct tenant tables and child tables whose ownership is derived from parent rows.
  - Added `20260728010002_exclude_outbox_tables_from_rls_gl_svc` so async drainers can still publish
    local outbox/audit records without request-scoped tenant context.

- **Centralized S207 authorization for all gl-service routes**
  - Added `services/gl-service/src/http/security.ts` with shared route permission resolution.
  - Added auth-service migration
    `services/auth-service/prisma/migrations/20260728000002_extend_authz_catalog_gl_service_onboarding/migration.sql`
    seeding four minimal real permission keys:
    - `gl.dashboard.view`
    - `gl.ledger.view`
    - `gl.ledger.manage`
    - `gl.admin.manage`
  - Granted them to existing roles using precedent from already-certified accounting permissions:
    `ADMIN` + `CONTROLLER` receive all four; `ACCOUNTANT` receives dashboard/view/manage but not
    `gl.admin.manage`; no `CLERK`/`OFFICE_MGR` grant was added without contract precedent.
  - Wired the real `createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId })`
    pattern into gl-service routes and inline dashboard/command-center/ESG endpoints.

- **S007 transactional audit emission**
  - Added `AuditOutboxEvent` support in gl-service schema/runtime.
  - Added read-path audit-on-view/export for GL/dashboard/inquiry surfaces.
  - Added transactional audit writes for real write paths (journal create/submit/post/reverse and related
    write handlers) so business row change + service outbox + audit outbox commit together.
  - Started the existing async audit drainer against the real audit-service and verified published rows.

- **Tenant-aware runtime wiring**
  - Added shared-kernel Prisma RLS middleware and tenant context hook so request-scoped tenant context is
    pushed to PostgreSQL before queries.
  - Updated serializable transaction helper paths so interactive transactions also set tenant context on
    the actual transaction connection.

## 3. Real defects found and fixed

1. **Historical gl-service migrations were not deployable from zero.**
   - **Before:** `services/gl-service/prisma/migrations/` contained only loose `.sql` files, no
     `migration_lock.toml`, no Prisma folder structure, and no guaranteed bootstrap path.
   - **Defect(s) exposed during real `prisma migrate deploy`:**
     - bootstrap conflict with later `build008` (`history_transactions.clear_code` already present)
     - `fix001_double_precision_to_numeric.sql` touched cross-service tables not created by current
       migration chain
     - `seed_intercompany.sql` assumed dealer-group tables that were absent from the current repo's
       tenant-service migration set
   - **Fix:** added Prisma folder wrappers plus compatibility shim migrations so the historical SQL can run
     from empty Postgres in chronological order. The historical SQL bodies remain unchanged; only the
     deployment scaffolding and additive prep/cleanup migrations were added.

2. **Committed schema drift: runtime expected columns that no migration created.**
   - **Before:** fresh-db test runs failed with Prisma `P2022` because the generated client/schema referenced
     columns missing from the committed migration chain.
   - **After:** additive migrations now create `gl_accounts.is_intercompany` and
     `journal_entries.ic_counterpart_entry_id`, matching the checked-in Prisma schema and runtime code.

3. **Route authorization hook initially failed open on prefixed URLs.**
   - **Before:** first live probe showed some `/api/v1/gl/...` routes still returned `200` to a no-role
     caller even after authz wiring, because Fastify's route URL included the `/api/v1/gl` prefix while
     the permission resolver expected prefixless route paths.
   - **Fix:** `services/gl-service/src/http/security.ts` now normalizes route URLs by stripping the mounted
     prefix before permission resolution. Re-probed live: invalid JWT -> `401`, no-role ledger caller ->
     `403`, ACCOUNTANT hitting admin route -> `403`.

4. **gl-service tests were not actually compatible with the real Vitest/generated-client runtime.**
   - **Before:** several tests used `@prisma/client` instead of the generated gl client, placeholder
     verification tests imported Jest globals under Vitest, and numeric assertions assumed primitive
     values where Prisma returns `Decimal`-backed values.
   - **Fix:** updated the affected tests to use the generated gl client, Vitest imports, cleanup/disconnect,
     and Decimal-safe assertions. Final suite passes cleanly (86/86).

5. **Shared live gl-service runtime was stale relative to committed code.**
   - **Observed defect:** the pre-existing shared instance on port `3010` still returned `200` for an
     invalid JWT, proving it was not running the hardened code.
   - **Action taken:** did **not** mutate the shared runtime blindly. Instead, restarted an isolated local
     probe instance of the updated gl-service on port `13010` and verified end-to-end behavior there,
     plus through a local gateway probe on `13110` using the real gateway routing code.

## 4. Migration verification — fresh database from zero

Ephemeral Postgres 15 container on port `55502`.

- `services/auth-service`: real `prisma migrate deploy` applied **13/13** migrations, including the new
  `20260728000002_extend_authz_catalog_gl_service_onboarding` permission-catalog extension.
- `services/gl-service`: real `prisma migrate deploy` applied **31/31** migrations from empty database,
  including the normalized historical sequence plus new audit/RLS/schema-fix migrations.
- No `db push`, no manual table creation, no migration reordering outside the explicit Prisma folder
  chronology.

Fresh-db result: **PASS**.

## 5. Live shared database deployment

Against the shared Postgres on `localhost:45433`, deployed via schema-owner role `amacc` (not the app role):

- auth-service permission-catalog migration applied successfully.
- gl-service migration chain applied successfully.
- Verified live via `psql`:
  - new permission keys exist at `since_version = '1.6.0'`
  - gl-service migrations are recorded in `_prisma_migrations`
  - RLS is enabled/forced on tenant-owned GL tables
  - app-role visibility is tenant-scoped: one tenant sees its own GL rows, another tenant sees only its
    rows, and unset tenant context sees zero rows.

Live shared DB deployment result: **PASS**.

## 6. Runtime, gateway, auth, RLS, and audit evidence

### 6.1 Direct updated gl-service probe (`localhost:13010`)

Started the updated gl-service code against the live shared Postgres and live auth-service data, with real
JWT auth and RLS enabled.

Verified with real HTTP calls:
- valid ADMIN JWT -> dashboard `200`
- invalid JWT -> `401`
- no-role caller on a ledger route -> `403`
- `ACCOUNTANT` caller on an admin route -> `403`

### 6.2 Gateway routing proof (`localhost:13110`)

The shared gateway on `13100` was returning `503` for the representative dashboard path during this work,
so it was not suitable as proof of the new code path. To avoid disturbing the shared environment, I started
an isolated local API-gateway probe on `13110` using the repo's real gateway routing code, pointed at the
updated gl-service probe on `13010`.

Verified through the gateway path:
- `GET /api/v1/dashboard/summary` with valid JWT + tenant header -> **`200`**
- same path with invalid JWT -> **`401`**

This proves the existing gateway route wiring works end-to-end with the hardened gl-service runtime; no new
route addition was required.

### 6.3 Database RLS proof (live shared DB, app role)

Verified under `amacc_app` against live shared DB:
- tenant A (`tenant-kunes`) saw only its own `gl_accounts` rows
- tenant B (`tenant-kunes-ford`) saw only its own `gl_accounts` rows
- no tenant context saw `0` rows

This is real PostgreSQL enforcement, not just application `where: { tenantId }` filtering.

### 6.4 S007 audit proof

With `AUDIT_SERVICE_URL` pointed at the real local audit-service (`localhost:13031`), a gateway dashboard
view produced:
- a tenant-scoped `outbox_events` row (`event_type = 'audit.viewed'`) with `published_at` set
- a tenant-scoped local `audit_outbox` row (`doc_type = 'GL_DASHBOARD'`, `action = 'VIEWED'`) with
  `published_at` set
- a central `audit_logs` row (`entity_type = 'GL_DASHBOARD'`, `entity_id = 'summary'`) attributed to the
  real calling user id

Audit delivery result: **PASS**.

## 7. Isolated runtime configuration

Verified gl-service uses its own runtime configuration surface (`DATABASE_URL`, `AMACC_JWT_SECRET`,
`AUTHZ_SERVICE_URL`, `AUDIT_SERVICE_URL`, `RABBITMQ_URL`) from `services/gl-service/src/index.ts`. It is
not piggy-backing on coa-service configuration or database handles. Probe runs were started with an explicit
`DATABASE_URL` for gl-service pointing at the intended Postgres instance.

## 8. Tests and typecheck

### Baseline before onboarding changes

- `services/gl-service npx tsc --noEmit`: **failed** before this work (pre-existing generated-client / TS
  compatibility issues; non-zero exit).
- `services/gl-service npm test`: **failed** before completion of this work due the same pre-existing drift
  and test/runtime mismatches described in §3. Exact pre-fix pass counts are intentionally not fabricated;
  the important evidence is that the baseline was not green and required real fixes.

### Final after onboarding changes

- `services/gl-service npx tsc --noEmit`: **PASS**
- `services/gl-service DATABASE_URL=postgresql://amacc:amacc_dev@localhost:55502/amacc npm test`:
  **PASS — 11/11 test files, 86/86 tests**

## 9. Files changed

Primary onboarding files:
- `services/gl-service/prisma/migration_lock.toml`
- `services/gl-service/prisma/migrations/**` (31 Prisma migration folders; historical loose SQL replaced by
  Prisma-compatible folders, plus additive bootstrap/compatibility/RLS/audit/schema-fix migrations)
- `services/auth-service/prisma/migrations/20260728000002_extend_authz_catalog_gl_service_onboarding/migration.sql`
- `services/gl-service/prisma/schema.prisma`
- `services/gl-service/src/http/security.ts`
- `services/gl-service/src/infrastructure/audit.ts`
- `services/gl-service/src/index.ts`
- `services/gl-service/src/http/routes.ts`
- `services/gl-service/src/http/inquiry-routes.ts`
- `services/gl-service/src/application/gl-service.ts`
- `services/gl-service/src/infrastructure/journal-repository.ts`
- `services/gl-service/src/lib/serializable-retry.ts`
- `services/gl-service/tests/1099-reports.test.ts`
- `services/gl-service/tests/floor-plan.test.ts`
- `services/gl-service/tests/tax-accrual.test.ts`
- `services/gl-service/tests/verification/*.test.ts`

`docs/accounting-modernization/stabilization/STORY_CERTIFICATION_MATRIX.csv` was checked for existing
`S014`/`S222`/`S227` rows; none were present, so no fake story note was added.

## 10. Explicit assumptions / disclosed gaps

- **Permission naming:** chose the smallest route-behavior-aligned set of four keys
  (`gl.dashboard.view`, `gl.ledger.view`, `gl.ledger.manage`, `gl.admin.manage`) instead of inventing
  finer-grained keys not justified by current routes/contracts.
- **Role grants:** deliberately did not grant `CLERK` or `OFFICE_MGR` without explicit precedent.
- **Audit-on-view coverage:** implemented audit-on-view for dashboard and GL/inquiry read surfaces, plus
  transactional audit on mutating journal/write paths actually present in the service. No fictitious write
  surfaces were invented.
- **Intercompany RLS exception:** intercompany rows intentionally allow counterpart visibility where needed
  to preserve the service's pre-existing cross-tenant intercompany workflow semantics.
- **Gateway evidence source:** final gateway proof uses a local gateway probe (`13110`) because the shared
  gateway instance (`13100`) was returning `503` during this task. The route code itself is the real repo
  gateway code; only the listener instance was isolated.
- **Shared runtime restart:** I did not replace the stale shared `3010` gl-service process in-place. That
  would be an environment mutation beyond the scope of safe certification evidence gathering.

## 11. Final verdict

`services/gl-service` now has:
- real Prisma-deployable migrations from empty Postgres,
- real database-enforced tenant isolation via RLS,
- real centralized S207 authorization,
- real S007 audit emission/delivery,
- real JWT authentication still enforced,
- real PostgreSQL-backed reads unaffected by RLS,
- isolated runtime config,
- clean `tsc` and clean test suite,
- and representative gateway/runtime/live-DB evidence.

**Verdict: PASS — gl-service onboarding is complete enough for downstream work such as S014 Trial Balance to
build on top of it.**
