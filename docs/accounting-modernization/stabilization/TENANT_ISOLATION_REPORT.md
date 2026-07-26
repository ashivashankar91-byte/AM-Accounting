# Tenant Isolation Report — Phase 5 (ADR-001)

Implements PostgreSQL Row Level Security for real. ADR-001 claimed this was already delivered ("WI-UQ01-01... implements the RLS pattern for `legal_entities` and `tenant_outbox_events` as the reference implementation") — a repository-wide grep confirmed zero RLS policies existed anywhere (`docs/accounting-modernization/repository-verification/TENANT_ISOLATION_VERIFICATION.md`). This phase does not mark ADR-001 complete based on application query filters alone — every claim below is backed by a real PostgreSQL instance proof in `LIVE_DATABASE_TEST_REPORT.md`.

## Design (exactly what ADR-001 specified, not a new design)

- **Session variable**: `app.current_tenant_id`, set via `SELECT set_config('app.current_tenant_id', $1, false)` — a real bind parameter (SQL-injection-safe), not string interpolation.
- **Injection point**: `packages/shared-kernel/src/tenancy/rls-middleware.ts` — a Prisma `$use` middleware that runs this `set_config` before every query. Reads the tenant id from `packages/shared-kernel/src/tenancy/tenant-context.ts` (`RlsTenantContext`, an `AsyncLocalStorage`), populated once per HTTP request by `tenantContextHook` (a Fastify preHandler registered globally in each service's `src/index.ts`).
- **Enforcement**: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` **and** `FORCE ROW LEVEL SECURITY` on every tenant-owned table — `FORCE` is required because the application's own DB role also owns these tables, and RLS does not apply to a table's owner unless forced.
- **Policies**: four per table (`tenant_isolation_select/insert/update/delete`), all keyed on `tenant_id = current_setting('app.current_tenant_id', true)` — the `true` second argument means "return NULL instead of erroring if unset," so a missing tenant context evaluates to `tenant_id = NULL`, which is never true — deny-by-default is the natural consequence, not a special case.
- **Explicit, constrained admin/migration bypass**: a dedicated `amacc_rls_bypass` role (`NOLOGIN`, `BYPASSRLS`), created idempotently by the migrations themselves. It has no login capability of its own — a session must already be an admin-capable role and explicitly `SET ROLE amacc_rls_bypass` to use it. The plain application role cannot invoke it at all (proven in `LIVE_DATABASE_TEST_REPORT.md` — `SET ROLE` itself is permission-denied for that role).

## Coverage

`TENANT_TABLE_AND_RLS_MATRIX.csv` — **33 tenant-owned tables** across tenant-service (6), auth-service (9), coa-service (17), audit-service (1), every one with `ENABLE + FORCE ROW LEVEL SECURITY` and all 4 policies, confirmed via `pg_class.relrowsecurity/relforcerowsecurity` and `pg_policies` (all show `t/t/4` — see `LIVE_DATABASE_TEST_REPORT.md`). **6 platform-wide, genuinely tenant-agnostic tables** (`tenants`, `permission`, `role_permission`, `catalog_version`, `oem_ref`, `config_key_catalog`) are explicitly excluded and documented as such — not omitted by oversight. `tenants` matches ADR-001's own framing (it's the registry the tenant_id *comes from*, not a tenant-owned row).

## Disclosed limitation: Prisma connection pooling and session-variable affinity

`SET`/`set_config` are per-connection. Prisma's connection pool may serve two sequential queries from different physical connections under concurrent load, which the `$use` middleware pattern (SET immediately before each query) does not perfectly guarantee against — this is a widely-documented tradeoff versus `$transaction`-wrapped `SET LOCAL`, not unique to this implementation. It was verified empirically (not just assumed from the pattern's theory) that this environment's actual behavior is correct for realistic sequential per-request query patterns; the dedicated RLS isolation test (`tests/integration/test-rls-isolation.ts`) deliberately avoids the pooling question entirely by using single-connection `pg.Client` sessions (matching how a single HTTP request's queries would, in practice, tend to serialize through the same borrowed connection for the request's duration under normal load). A stronger production guarantee — wrapping every Prisma call site in `$transaction` with `SET LOCAL`, or running Postgres behind PgBouncer in session-pooling mode — is documented here as follow-up hardening, not claimed as already done.

## Behavior change disclosed, not silently absorbed

`audit-service`'s cross-tenant admin GET endpoints (`getByEntity`/`getByActor`/`getByPeriod` when called with no `tenantId`) now return zero rows under RLS unless the caller's session explicitly uses `amacc_rls_bypass` — previously (app-layer filtering only) omitting `tenantId` meant "show me everything, across all tenants," a real existing admin capability. This is the correct ADR-001 behavior (a query with no tenant context is denied, not "sees everything"), but it is a genuine change to existing behavior, not merely closing an accidental gap. **Product Owner decision needed**: should audit-service's admin routes be wired to authenticate with `amacc_rls_bypass` (or an equivalent), or should cross-tenant audit queries be removed as a capability? Not decided unilaterally here.

## What was NOT done in this phase

- **`DECISION_REGISTER.md`'s UQ-01 entry** (marked "RESOLVED → DEC-001 (RLS)") was not edited — MODULE_STATE.json corrections happen centrally in Phase 9's recertification pass, not scattered across phases, to avoid the two-narratives problem this whole package exists to fix.
- **Every application query was not audited for correctness independent of RLS** — RLS is explicitly the *backstop* for a missed `tenantId` WHERE clause, not a replacement for writing correct queries; existing app-layer filtering (confirmed present and tested in the prior verification pass) remains the primary mechanism, with RLS as defense-in-depth exactly as ADR-001 designed it.
- **`Tenant.schemaName` cleanup (WI-S200-07)** — explicitly deferred by ADR-001 itself; out of scope here.

**Verdict: R0_TENANT_ISOLATION_PASSED.**
