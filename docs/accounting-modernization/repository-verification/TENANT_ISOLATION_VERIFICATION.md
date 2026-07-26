# ADR-001 Tenant Isolation Verification

**Classification: PRODUCTION_HARDENING_GATE for the app-layer control; CONTRADICTED_BY_REPOSITORY for the claimed RLS control.**

## What ADR-001 actually decided

Read in full from `docs/accounting-modernization/decisions/ADR-001_TENANT_ISOLATION.md` (accepted 2026-07-23):

1. Shared schema with row-level `tenant_id` column (continuing pattern).
2. **PostgreSQL RLS as a database-level backstop** — session variable `app.current_tenant_id` injected by a Prisma middleware, RLS policies on every table with `tenant_id`.
3. `Tenant.schemaName` is vestigial (deferred cleanup, WI-S200-07).
4. **"WI-UQ01-01 (the currently released work item) implements the RLS pattern for `legal_entities` and `tenant_outbox_events` as the reference implementation."** — i.e., the ADR asserts RLS was *already delivered* as of acceptance, not merely planned.
5. An automated cross-tenant isolation test suite "must be established... and must pass before S201 is released."

`DECISION_REGISTER.md` marks `UQ-01` as **"RESOLVED → DEC-001 (RLS)"** and `CURRENT_RELEASE.md`'s "Binding decisions" section repeats: *"Isolation: shared schema with application-layer tenantId scoping + PostgreSQL RLS."*

## What the repository actually contains

- **App-layer `tenantId` scoping — real and broad.** Every tenant-owned Prisma model across `tenant-service`, `auth-service`, and `coa-service` schemas carries a `tenantId`/`tenant_id` column with an `@@index([tenantId])` (confirmed by reading all three `schema.prisma` files in full: `LegalEntity`, `Store`, `Department`, `Franchise`, `TenantOutboxEvent`; `ApiKey`, `RefreshToken`, `AuthzRoleAssignment`, `AuthzOutboxEvent`, `Role`, `RoleAssignment`, `AuditOutboxEvent`, `User`, `Session`; `ConfigSetting`, `AuditOutboxEvent`, `FiscalCalendar`, `FiscalPeriod`, `CoaOutboxEvent`, `GlAccount`, `GlAccountReparent`, `CoaSeedRun`, `JournalSource`, `JournalSequence`, `SequenceGapLog`, `JournalEntry`, `JournalLine`, `BalanceSnapshot`, `ManualJeDraft`, `ManualJeDraftRevision`, `Attachment`). No tenant-owned table was found missing a `tenantId` column.
- **Composite tenant-aware keys**: present — e.g. `@@unique([tenantId, entityCode])` (LegalEntity), `@@unique([entityId, storeCode])` + `@@index([tenantId, entityId])` (Store), `@@unique([tenantId, idempotencyKey])` (JournalEntry).
- **Repository/query tenant filtering**: consistent with the pattern in the application-service files sampled; each service's route layer requires an `x-tenant-id` header (`getTenantId()` helper throws 400 if absent — confirmed in `legal-entity-routes.ts` and mirrored across other route files by naming convention).
- **Cross-tenant negative tests**: real. `services/tenant-service/tests/{store,department,franchise}-isolation.test.ts` exist and were executed as part of the 150/150 passing tenant-service run; they assert cross-tenant denial, not just same-tenant happy paths (file names and content match the isolation-test pattern ADR-001 calls for). **However, no `legal-entity-isolation.test.ts` exists** — S200 itself (the story that produced the ADR) has an authz test (`legal-entity-authz.test.ts`) but not a same-named cross-tenant *data* isolation test file, unlike S201/S203/S204.
- **PostgreSQL RLS — NOT FOUND.** `grep -rln "ROW LEVEL SECURITY\|CREATE POLICY\|ENABLE ROW LEVEL SECURITY" services/ k8s/ docker-compose.yml` across the entire repository returned **zero matches**. No migration file, no raw SQL file, no Prisma middleware setting `app.current_tenant_id`, anywhere in the codebase, implements RLS. This directly contradicts ADR-001 §4's claim that RLS was already delivered as "the currently released work item" and "reference implementation" for `legal_entities`/`tenant_outbox_events`.
- **API tenant validation**: `x-tenant-id` header requirement confirmed at the route layer (see above) in every service sampled.
- **Background-worker tenant propagation**: no queue-consumer/cron/worker process was found in any of the three services (the RabbitMQ client's `subscribe()` only registers in-process handlers invoked synchronously by the same process's own `publish()` call — see `AUTHORIZATION_AND_AUDIT_VERIFICATION.md`/git evidence on the broker). There is no separate worker process to check for tenant propagation because no such worker exists yet.
- **Event tenant propagation**: outbox event models (`TenantOutboxEvent`, `AuthzOutboxEvent`, `CoaOutboxEvent`) all carry a `tenantId` column, so payload-level propagation is structurally present, though — per the audit finding above — nothing consumes these events cross-service to exercise that propagation end-to-end.
- **Development bypasses**: none found in the tenant-scoping code path itself (distinct from the authz stub-map bypass documented in `AUTHORIZATION_AND_AUDIT_VERIFICATION.md`).

## Tables/write paths still lacking the ADR-001-mandated control

Every tenant-owned table in the repository lacks the RLS backstop ADR-001 calls for — this is not a partial gap, it is total: **0 of the ~25 tenant-owned tables across the three services have an RLS policy.** The app-layer `tenantId` WHERE-clause convention is the *only* enforcement mechanism actually operating, exactly the "sole enforcement, no DB-level backstop" state the ADR was written to fix.

## Verdict

ADR-001's app-layer half is real and reasonably well-tested (isolation tests exist and pass for 3 of 4 tenant-service stories). Its DB-layer half (RLS) — which the ADR explicitly claims is already delivered — **does not exist anywhere in the repository**. This is a direct, checkable contradiction between an accepted architectural decision record and the actual codebase, not merely an "integration still pending" situation, since the ADR does not describe RLS as future work — it describes it as already shipped.

Given app-layer scoping is real and functioning (tests pass), but the claimed DB backstop is entirely fictional, and the current stub-authz situation (`AUTHORIZATION_AND_AUDIT_VERIFICATION.md`) means the app layer is the *only* thing standing between tenants, classify as **PRODUCTION_HARDENING_GATE** (not yet an active build blocker — tests pass — but not safe to call production-hardened given the RLS claim is false and the authz layer that would compensate for a missed WHERE clause is itself stubbed for 20/22 stories).
