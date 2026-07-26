# ADR-001 — Tenant Isolation Architecture

**Status:** ACCEPTED
**Date:** 2026-07-23
**Deciders:** Shiva (Product Owner)
**Source:** S200 audit finding GAP-S200-ISOLATION; UQ-01 from S200-AUDIT_RESULTS_v1.2.md §5

---

## Context

The S200 audit (2026-07-23) found that tenant isolation across all AMACC services, including the newly implemented Legal Entity feature, is enforced solely by application-code convention: every Prisma query is expected to include a `tenantId` WHERE clause per the standing CLAUDE.md critical rule #2. There is no database-level enforcement mechanism (no PostgreSQL Row Level Security, no per-tenant schema, no per-tenant database).

The `Tenant` model carries a `schemaName` column that is generated at tenant-creation time and displayed in the admin UI, but is never used to route any query anywhere in the codebase — it is vestigial and misleading about the system's actual isolation model.

Two independent application-layer defenses do exist and were verified working during the audit:
1. Every query includes `tenantId` in the WHERE clause.
2. `authMiddleware` verifies that the JWT `tenantId` matches the `x-tenant-id` header (`403` on mismatch).

However, zero automated regression tests exercise cross-tenant rejection, meaning a missed `tenantId` clause in any future query would not be caught until runtime.

---

## Decision

**Adopt shared-schema with application-layer scoping + PostgreSQL Row Level Security (RLS) as the AMACC tenancy model.**

Specifically:

1. **Shared schema with row-level `tenant_id` column** — the current model. All tables have a `tenant_id` column. This is the continuing primary pattern.

2. **PostgreSQL RLS as the database-level backstop** — add RLS policies on all tables that contain `tenant_id`, using a session variable (`SET app.current_tenant_id = '...'`) injected by a Prisma middleware before every query. This means even a query missing its `tenantId` WHERE clause is still rejected at the database layer.

3. **`Tenant.schemaName` is vestigial** — the field is retained for now (removing it is a non-breaking migration that can be deferred) but must not be used to imply schema-per-tenant routing. A follow-up cleanup task (WI-S200-07) will remove or repurpose it.

4. **WI-UQ01-01 (the currently released work item) implements the RLS pattern for `legal_entities` and `tenant_outbox_events` as the reference implementation.** All new tables added in S201+ must follow the same pattern.

5. **An automated cross-tenant isolation test suite** must be established as part of WI-UQ01-01 and must pass before S201 is released.

---

## Rationale

| Option | Considered | Rejected because |
|---|---|---|
| Application-layer only (status quo) | Yes | Zero DB backstop; single missed WHERE clause causes data leak; no automated regression |
| Schema-per-tenant | Yes | Too costly to retrofit onto existing services; complicates migrations; not needed at current scale |
| Database-per-tenant | Yes | Major operational complexity; defeats shared Postgres deployment model |
| RLS on shared schema | **CHOSEN** | Enforces isolation at the database level without requiring schema changes; composable with existing Prisma pattern; minimal migration cost; well-understood PostgreSQL feature |

---

## Consequences

**Positive:**
- Any Prisma query missing a `tenantId` WHERE clause is rejected at the DB layer, not just by code convention.
- Cross-tenant leaks become impossible to commit accidentally.
- The `authMiddleware` + RLS combination provides defense-in-depth.
- WI-UQ01-01 delivers a reusable reference pattern for all subsequent stories.

**Negative / risks:**
- RLS session variables must be set inside a Prisma middleware on every request — adds latency (sub-millisecond).
- `prisma.$executeRawUnsafe` or raw queries that bypass Prisma must still be audited manually.
- The vestigial `schemaName` field will remain confusing until WI-S200-07 cleans it up.

---

## Implementation reference (WI-UQ01-01)

The reference implementation targets:
- `services/tenant-service/prisma/schema.prisma` — `legal_entities`, `tenants`, `tenant_outbox_events`
- A Prisma client extension or `$use` middleware to `SET app.current_tenant_id` per request
- PostgreSQL RLS policies on the three tables above
- Automated isolation tests in `services/tenant-service/tests/tenant-isolation.test.ts`

Pattern to extend to all new tables in S201+.

---

## Supersedes / amends

No prior ADR. This is the first explicit tenancy isolation decision for AMACC.

---

## Review trigger

This ADR must be revisited if:
- AMACC is deployed as a self-hosted single-tenant product (RLS becomes unnecessary overhead)
- Scale requirements demand schema-per-tenant (>1,000 tenants with significant data separation needs)
- A security audit finds RLS session-variable injection insufficient as a mechanism
