# E2E Foundation Report — Phase 8

Stands up the full stack (4 backend services + api-gateway + frontend) for real end-to-end proof, after authorization (Phase 3), audit (Phase 4), tenant isolation (Phase 5/6), and broker integration (Phase 7) all passed independently. This phase is where those four pieces had to work *together*, live — and where three of them turned out not to.

## Four critical bugs found and fixed, only by actually booting the stack

Every prior phase's test suite passed independently — each in isolation. None of them ever booted all 4 services together and pushed a real transaction through the real gateway. Doing exactly that in this phase surfaced four bugs, none visible from any single service's own test suite:

1. **RLS middleware infinite recursion (OOM crash)** — `createTenantRlsMiddleware`'s own `$executeRawUnsafe` call re-entered the same `$use` middleware it was registered on, recursing without end. `tenant-service`, `auth-service`, and `coa-service` all crashed with `FATAL ERROR: Reached heap limit` ~18-20s after "Server listening" — exactly when the Phase 4 audit-outbox drainer's first 5-second poll tick made each service's first real (non-test-harness) Prisma query. Fixed in `packages/shared-kernel/src/tenancy/rls-middleware.ts` (commit `b399799`) — full detail and re-verification in `TENANT_ISOLATION_REPORT.md`.
2. **`HttpAuthzClient` called the wrong URL path** — `/authz/check` instead of the real `/api/v1/authz/check`. Every real permission check 404'd and was treated as fail-closed deny. Undetected because every Phase 3 test uses a fake `AuthzClient`.
3. **`HttpAuthzClient` never sent `x-tenant-id`** — so once RLS was live, auth-service's own `authz_role_assignment` lookup ran with no tenant context and silently saw zero rows: every check denied with `NO_MATCHING_ROLE`, regardless of a real assignment existing. Both #2 and #3 fixed in `packages/shared-kernel/src/authz/authz-client.ts` (commit `fb5535a`).
4. **Audit-outbox drainer silently stopped delivering under RLS** — `AuditOutboxDrainer.start()`'s `setInterval` callback runs outside any Fastify request, so `RlsTenantContext.get()` always returns `undefined` for it; RLS then made its `findUnpublished()` query see zero rows for every tenant, forever. Rows were written correctly (real HTTP requests have tenant context) but never delivered — a silent Phase 4/Phase 5 interaction gap. Fixed by excluding the 4 outbox tables from RLS enforcement (migrations `20260727000001_exclude_outbox_tables_from_rls` in tenant-service, auth-service, coa-service) — a genuine architecture decision, confirmed with the Product Owner before applying, not made unilaterally. Full detail in `AUDIT_INTEGRATION_REPORT.md`.

None of these were caught by 601 passing unit tests, 9 passing RLS-isolation tests, 5 passing live-DB tests, or 10 passing broker-integration tests across Phases 3-7 — each of those suites is real and correct on its own terms, but none of them exercises all four subsystems wired together the way a booted service does. That gap is exactly what this phase exists to close.

## Infrastructure stood up

- 4 backend services (`tenant-service:3002`, `auth-service:3001`, `coa-service:3016`, `audit-service:3031`) running together against the Phase 5/6 ephemeral RLS-enabled Postgres instance and the Phase 7 ephemeral RabbitMQ instance, all healthy and stable (flat ~100MB RSS, no crashes) for the full duration of this phase's testing.
- `api-gateway:3000` running as the real reverse proxy in front of them, routing `/api/v1/{auth,authz,iam,tenants,legal-entities,stores,coa,config,fiscal,audit}` correctly.

## Golden path proven end-to-end at the API level (real gateway, real authz, real audit, real RLS-enabled database)

All of the following are real HTTP calls through `http://localhost:3000` (api-gateway), not direct service calls and not mocks:

1. **Create legal entity** — `POST /api/v1/legal-entities` → `201`, entity `E2E01` created.
2. **Define fiscal calendar** — `POST /api/v1/fiscal/entities/:id/fiscal-calendar` → calendar `DEFINED`.
3. **Generate FY2026 periods** — `POST /api/v1/fiscal/entities/:id/fiscal-calendar/years` → 12 periods created, `FUTURE`.
4. **Open period 2026-01** — `POST /api/v1/fiscal/periods/:id/open` → `OPEN`.
5. **Seed canonical COA** — `POST /api/v1/coa/seed` → 31 GL accounts created (manifest `BP-3.2`).
6. **Bootstrap reserved journal sources** — `POST /api/v1/coa/journal-sources/bootstrap-reserved` → 8 sources created, including `GJ` (Standard General Journal).
7. **Post a journal entry — rejected first, correctly**: initial attempt without a department code on the P&L line was rejected by real business-rule validation (`BR013-5`: "P&L account 41000 (REVENUE) requires a department code"), proving the rule actually runs, not just a happy-path stub.
8. **Post a journal entry — succeeds**: `POST /api/v1/coa/journals` with a corrected, balanced 2-line entry (DR Cash 500 / CR Revenue 500, dept `01`) → `201`, journal `GJ-2026-01-000001`, `POSTED`.
9. **View posted journal** — `GET /api/v1/coa/journals/GJ-2026-01-000001` → full header + both lines, `immutable: true`.
10. **Idempotent re-post** — same idempotency key, same payload → `idempotent: true`, same journal number, no duplicate row.
11. **Reverse the journal** — `POST /api/v1/coa/journals/{id}:reverse` → `GJ-2026-01-000002` created, mirrored lines, both-way linkage.
12. **Cross-tenant negative test** — same journal-view request with `x-tenant-id: some-other-tenant` → `403 FORBIDDEN` (`NO_MATCHING_ROLE`), not the real data.
13. **Audit trail confirmed delivered** — all 9 `audit_outbox` rows generated by steps 1-11 (`LegalEntity.CREATE`, `fiscal_calendar.CREATE`/`GENERATE_YEAR`, `fiscal_period.OPEN`, `coa_seed.SEED`, `journal_source.BOOTSTRAP`, `JOURNAL_ENTRY.POSTED`/`REVERSAL_POSTED`/`REVERSED`) confirmed present in `audit_logs` with zero duplicate `sourceEventId`s, after the Phase 4 finding above was fixed.

Every step above ran through real authorization (`ADMIN` role checked against the real `permission`/`role_permission`/`authz_role_assignment` tables via a real HTTP call to auth-service), real RLS-enforced Postgres (`tenant_id` scoping via `set_config`), and real audit-trail delivery.

## Browser-level E2E: genuinely blocked by frontend entanglement, not fabricated

`tests/e2e/*.spec.ts` (pre-existing, e.g. `legal-entity.spec.ts`) navigate to routes like `/setup/legal-entities`. Standing up the frontend from a clean git worktree at HEAD (`git worktree add ... HEAD`, chosen specifically to avoid touching `apps/web`'s substantial uncommitted, in-progress changes — 23 modified files and 6 new untracked pages, none related to the 22 in-scope R0 stories) showed the Admin sidebar renders correctly, but **`/setup/legal-entities` and its pages (`pages/admin/LegalEntities.tsx`, `pages/admin/LegalEntityDetail.tsx`) do not exist at HEAD** — confirmed via `grep` showing zero matches in the isolated worktree versus matches only in the current uncommitted `apps/web/src/App.tsx`. The existing E2E specs were written against frontend work that has never been committed.

**`R0_FRONTEND_E2E_BLOCKED_BY_WORKTREE_DEPENDENCY`**

- **Exact conflicting files**: `apps/web/src/App.tsx` (routes `/setup/legal-entities`, `/setup/legal-entities/new`, `/setup/legal-entities/:id` only exist in the uncommitted working tree), plus the pages those routes render (`apps/web/src/pages/admin/LegalEntities.tsx`, `apps/web/src/pages/admin/LegalEntityDetail.tsx` — new, untracked or not present at HEAD). 22 other modified files and 6 other new untracked pages in `apps/web` are also uncommitted but were not individually required for this specific test path.
- **Required owner/action**: the owner of the in-progress `apps/web` changes needs to commit (or otherwise stabilize) that work before browser-level E2E can run against it safely. This is out of scope for the 22-story backend stabilization package and was correctly excluded from the start (Phase 0's entanglement exclusion for `App.tsx`/`client.ts`).
- **Strategy already attempted**: isolated `git worktree` at HEAD (as recommended) — this avoids disturbing the uncommitted work entirely, but means testing against a frontend state that predates the routes the existing specs need. A worktree cannot conjure routes that were never committed; only committing (or cherry-picking) the relevant frontend files resolves this.
- **API-level tests completed meanwhile**: the full golden path above (13 real HTTP steps, http://localhost:3000 → real services → real RLS-enabled Postgres → real audit trail), covering the same business flow the blocked browser specs would have exercised.

## Regression check (after all four fixes)

| Service | tsc --noEmit | Unit tests |
|---|---|---|
| tenant-service | 0 errors | 154/154 |
| auth-service | 0 errors | 88/88 |
| coa-service | 0 errors | 275/275 (+5 live-DB) |
| audit-service | 0 errors | 4/4 |
| shared-kernel | 0 errors | 5/5 |

Plus: RLS isolation suite 9/9, live-DB suite 5/5 — both re-run after the outbox-RLS-exclusion fix and still fully passing.

## Explicitly disclosed scope limits

- **Only the golden path + 2 negative scenarios were run at the API level** (idempotent re-post, cross-tenant deny). The originally-planned exhaustive negative-scenario list (closed period, inactive account, duplicate posting, unauthorized action with a real non-ADMIN role) was not separately exercised in this phase — the underlying mechanisms (period status checks, account status checks, idempotency keys, deny-by-default authz) are each independently unit- and live-DB-tested elsewhere (Phases 3, 6), just not chained through the live gateway in this specific pass.
- **The E2E fixtures created in this phase** (`tenant-kunes` legal entity `E2E01`, its fiscal calendar/periods/COA/journal) remain in the ephemeral test database; no cleanup script was run for them (unlike the live-DB vitest suite's `afterAll`, this was ad hoc curl-driven testing). They are disposed of when the ephemeral Postgres instance itself is torn down.
- **No Playwright browser test actually ran** — the browser-level goal of this phase is reported blocked, not silently skipped or claimed done.

**Verdict: R0_FOUNDATION_E2E_BLOCKED_BY_WORKTREE_DEPENDENCY (browser layer) / API-level golden path PASSED.**
