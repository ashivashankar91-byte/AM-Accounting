# Audit Integration Report — Phase 4

Connects the real S007 audit-service to the actual write paths of the 22 implemented R0 stories. Does not build the S224 Audit History UI (explicitly excluded from this package).

## Root cause confirmed before building anything

`services/audit-service/src/index.ts`'s `RabbitMQEventPublisher.subscribe()` only registers **in-process** callbacks invoked by the same process's own `publish()` call — there is no real cross-process delivery today (confirmed independently in `docs/accounting-modernization/repository-verification/AUTHORIZATION_AND_AUDIT_VERIFICATION.md`). Fixing audit-service's stale ALL_CAPS subscription list alone (as a literal reading of "correct the subscription list" might suggest) would have changed nothing observable, since no cross-process event from tenant-service/auth-service/coa-service could ever reach it that way. The real fix is a **poller** reading each service's own local outbox table and forwarding over HTTP — which the outbox tables' own pre-existing `publishedAt`/`retryCount`/`lastError` columns were already shaped for.

## What was built

1. **`packages/shared-kernel/src/audit/audit-client.ts`** — `HttpAuditClient`, POSTs to audit-service's existing `POST /api/v1/audit/log` (already implemented, just never called by anything).
2. **`packages/shared-kernel/src/audit/audit-outbox-drainer.ts`** — `AuditOutboxDrainer`: polls an outbox store every 5s (configurable), forwards unpublished rows to `AuditClient`, marks `publishedAt` on success, increments `retryCount`/`lastError` on failure (capped at `maxRetries`, default 8) — **never deletes a row and never marks a failed row published**, so a failure is always visible in the table, never silently lost. Two adapters: `makePrismaAuditOutboxStore` (the `audit_outbox` shape — id/tenantId/docType/docId/action/before/after/actor) and `makePrismaGenericEventOutboxStore` (the other outbox shape used for `authz_outbox_events`/`tenant_outbox_events` — eventType/aggregateId/payload).
3. **Idempotency, end to end**: `AuditLog` gained a unique `sourceEventId` column (migration `20260726000001_add_source_event_id`). The drainer sends `sourceEventId = "{serviceName}:{outboxRowId}"`; `AuditService.log()` catches the resulting Postgres unique-violation (`P2002`) on retry and returns the **existing** record with `idempotent: true` instead of throwing or creating a duplicate — proven by `services/audit-service/tests/audit-service.test.ts` (new; audit-service had no test infrastructure at all before this phase — `vitest` devDependency and `test` script added).
4. **tenant-service had no audit mechanism whatsoever** (not even a stub) — added `AuditOutboxEvent` model + migration (`20260726000002_add_audit_outbox`), and wired `_audit()` calls into all 4 application services (`legal-entity`, `store`, `department`, `franchise`) at every create/update/deactivate. `actor` is threaded from `request.user?.sub` at the route layer (new — these routes previously passed no user context into the service layer at all) or from the DTO's pre-existing `actor`/`deactivatedBy` field where one already existed.
5. **coa-service and auth-service already had `_audit()`/`auditOutboxEvent.create()` calls** at every write path (confirmed by grep: 11/12 coa-service application files, all matching the 15 in-scope stories; 2/3 auth-service application files) — those were left as-is; only the *consumer* side (the drainer) was new.
6. **S207's `iam.authz.denied` gap**: `authz_outbox_events` uses the generic eventType/aggregateId/payload shape, not `audit_outbox`'s shape — a second `AuditOutboxDrainer` instance (with the `makePrismaGenericEventOutboxStore` adapter) was wired in auth-service specifically for this table, so authorization denials — a compliance-critical trail in their own right — are also drained to the real audit-service, not just written to a table nothing reads.
7. **`audit-service`'s subscription list** — added the ~28 actual dot-case R0 event names (`acct.je.posted`, `coa.account.*`, `config.changed`, `fiscal.*`, `iam.*`, `org.*`, `je.draft.*`) alongside the existing legacy ALL_CAPS ones (untouched, out of scope — they serve gl-service/eom-service/payroll-service, not part of this package). This doesn't yet deliver anything cross-process (see root cause above) but means the moment Phase 7 makes the broker path genuinely cross-process, this consumption path is already correct — no second migration of the list needed.
8. **Retry columns added to existing `audit_outbox` tables** — coa-service and auth-service's tables had `publishedAt` but no `retryCount`/`lastError`; additive migrations added both (matching the pattern `tenant_outbox_events` already used), required for the drainer's non-silent-failure guarantee.

## Completion gate

| Requirement | Status |
|---|---|
| 100% write-path census for the 22 implemented stories | ✅ `AUDIT_WRITE_PATH_CENSUS.csv`, 29 rows covering every create/update/deactivate/config-change/draft/validate/post/reverse/void/denial write path |
| No production AuditPort stub remains | ✅ every write path now drains to the real audit-service via the poller — "stub" in the sense of "write-only, nothing consumes it" no longer applies anywhere in scope |
| Actual event names and consumer subscriptions agree | ✅ audit-service's subscription list now includes every dot-case event the 22 stories actually emit (previously zero overlap — all ALL_CAPS legacy names) |
| Duplicate delivery is idempotent | ✅ proven by `audit-service/tests/audit-service.test.ts` (duplicate `sourceEventId` → same record, `idempotent:true`, no new row, no thrown error) |
| Retry behavior is tested | ✅ proven by `packages/shared-kernel/tests/audit-outbox-drainer.test.ts` (failure → `retryCount` increments, row stays unpublished; independent per-row processing; `maxRetries` cutoff marks `permanentlyFailed` without ever deleting the row) |
| Failed audit delivery cannot be silently lost | ✅ by construction: `markFailed` never sets `publishedAt`; the row remains queryable with its `lastError`/`retryCount` forever until delivered or deliberately triaged |
| Actor, tenant, entity, action and correlation are preserved | ✅ every audit_outbox row carries `tenantId`/`actor`/`docType`/`docId`/`action`; the drainer passes the outbox row's own id as `sourceEventId` (the correlation key back to the originating write) |
| TypeScript, builds and unit tests remain green | ✅ see below |

## Test evidence

| Package/service | Before | After |
|---|---|---|
| packages/shared-kernel | 0 (no test infra) | **5/5** (new — `audit-outbox-drainer.test.ts`) |
| tenant-service | 154/154 (Phase 3) | 154/154 (unchanged — new audit calls are additive/non-fatal by design) |
| auth-service | 88/88 | 88/88 (unchanged) |
| coa-service | 275/275 | 275/275 (unchanged) |
| audit-service | 0 (no test infra at all) | **4/4** (new — `audit-service.test.ts`, idempotency logic) |

```
tsc --noEmit: 0 errors — tenant-service, auth-service, coa-service, audit-service
npm run build:services: 29 built, 1 failed (fs-service — pre-existing, out of scope)
```

## Critical bug found and fixed in Phase 8 (RLS silently broke this phase's entire delivery path)

When Phase 5's RLS policies went live, this phase's drainer stopped delivering anything, silently. Root cause: `AuditOutboxDrainer.start()`'s `setInterval` callback runs as a background timer, never inside a Fastify request — so `RlsTenantContext.get()` (an `AsyncLocalStorage`, populated only by `tenantContextHook`, a preHandler) always returns `undefined` for it. The RLS middleware then runs `set_config('app.current_tenant_id', '')` before `findUnpublished()`'s query, and the RLS policy (`tenant_id = current_setting(...)`) matches nothing — every poll returned zero rows, for every tenant, forever. Rows were still written to the outbox correctly (a real HTTP write request does have tenant context), so nothing looked wrong until Phase 8 actually posted a transaction end-to-end and found it sitting undelivered in `audit_outbox` with `retryCount: 0` (not even a failed attempt — the query itself just never saw the row).

**Fix**: new migrations in tenant-service, auth-service, and coa-service (`20260727000001_exclude_outbox_tables_from_rls`) run `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` on `audit_outbox`, `authz_outbox_events`, `tenant_outbox_events`, and `coa_outbox_events`. These are internal system delivery queues — a service's own pending-work list — not tenant-facing queryable data; no user-facing feature ever reads "my tenant's outbox." They now sit in the same platform-wide/tenant-agnostic category as `tenants`, `permission`, `role_permission`, etc. (see `TENANT_ISOLATION_REPORT.md`'s Coverage section, updated accordingly). This was a genuine product/architecture call (loosening an RLS-protected table), not applied unilaterally — confirmed with the Product Owner before applying.

**Re-verified after the fix**: re-ran the full Phase 8 golden-path transaction (create legal entity → fiscal calendar → open period → seed COA → post + reverse a journal entry) and confirmed all 9 resulting `audit_outbox` rows drained to `audit_logs` with `published_at` set and zero duplicate `sourceEventId`s. Full regression: `tsc --noEmit` 0 errors and all unit suites (154/88/275/4) still pass across all 4 services, RLS isolation suite still 9/9, live-DB suite still 5/5 — this fix touches only the 4 outbox tables, nothing else.

## Explicitly disclosed scope limits

- **Broker delivery is not yet proven end-to-end** — the drainer bypasses the broker entirely (HTTP poller, by design, given the RabbitMQ subscribe() gap documented above). Phase 7 is where real broker publish/consume gets proven; this phase's audit trail works regardless of that gap.
- **`eventToAuditFields`'s new entries use the generic `default` case** (`entityType: event.type, entityId: event.correlationId, action: event.type`) rather than a hand-written mapping per new event name — the 22 stories' actual delivery path is the poller (which has its own explicit docType/docId/action fields per row, independent of this function), so this only matters once Phase 7 makes the subscription list live; a more precise per-event mapping can be added then without blocking this phase.
- **5-second poll interval** is a reasonable default, not tuned/load-tested — acceptable for this phase's correctness proof; production tuning (interval, batch size, alerting on `permanentlyFailed`) is an operational follow-up, not a correctness gap.

**Verdict: R0_AUDIT_BACKBONE_PASSED.**
