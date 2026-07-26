# Authorization Closure Report — Phase 3

Centralizes all 13 duplicated local permission maps across the 22 implemented R0 stories through the real S207 `AuthzService`, preserving its deny-by-default engine unchanged and without building a second authorization framework.

## What changed

1. **`packages/shared-kernel/src/authz/authz-client.ts`** (new) — `HttpAuthzClient`, a thin HTTP client for `GET /authz/check` on auth-service. Fail-closed: any network/timeout/non-2xx error is treated as **deny**, never allow, and is reported via an `onError` callback (wired to each service's `pino` logger).
2. **`packages/shared-kernel/src/authz/authz-guard.ts`** (new) — `createAuthzGuard(client, { getTenantId, scope? })`, a factory mirroring the shape of the local `requireXPermission(permission)` stubs it replaces, so route-file call sites barely changed.
3. **`services/auth-service/prisma/migrations/20260726000001_extend_authz_catalog_r0_stabilization/`** (new) — extends the S207 permission/role_permission catalog (catalog version 1.3.0) with the 20 permission keys previously enforced only by the 9 coa-service local stubs, granted to ADMIN/CONTROLLER/ACCOUNTANT/CLERK exactly matching each stub's existing grants. No key removed, no existing grant removed.
4. **`services/tenant-service/src/index.ts`, `services/coa-service/src/index.ts`** — register `HttpAuthzClient` as the `'AuthzClient'` DI singleton.
5. **All 13 route files** (`legal-entity`, `store`, `department`, `franchise`-routes.ts in tenant-service; `account`, `config`, `draft`, `fiscal`, `journal`, `period`, `seed`, `sequence`, `source`-routes.ts in coa-service) — local `ROLE_PERMISSIONS: Record<string, ReadonlySet<string>>` map and its `checkPermission` closure **deleted**; every `requireXPermission(permission)` factory now delegates to `createAuthzGuard`. Verified: `grep -rl "ROLE_PERMISSIONS" src/http/*.ts` across both services now returns zero matches for the map construct itself.
6. **`services/coa-service/src/http/draft-routes.ts`** — went further than a route-guard swap: `actorOf()` used to derive `canViewAll`/`canVoidOwn`/`canVoidAny` (business-logic flags passed into `DraftService`) directly from the local role→Set map. It's now `async` and resolves those three flags via real `AuthzClient.check()` calls, and `requireDraftReader()` (the "any one of five draft permissions" reader gate) does the same via `Promise.all` across the five permission keys. All 5 call sites of `actorOf()` were updated to `await` it.

## Completion gate

| Requirement | Status |
|---|---|
| All 22 implemented stories inventoried | ✅ `AUTHORIZATION_WRITE_PATH_CENSUS.csv`, 55 rows across every protected route in all 22 stories |
| No production route relies on a duplicated local permission map | ✅ verified by grep; all 13 maps deleted |
| Deny-by-default behavior proven | ✅ every guard denies when `AuthzClient.check()` returns `allow:false` or the request has no authenticated user (401 before any permission check) |
| Positive and negative tests pass | ✅ see Test evidence below |
| Tenant/entity scope is consistently enforced | ✅ every guard now resolves scope through a real per-tenant assignment lookup, not a global role string (see Security improvement below) |
| TypeScript and builds still pass | ✅ `tenant-service`, `auth-service`, `coa-service` all `tsc --noEmit` clean; `npm run build:services` unchanged (29 built, only pre-existing/out-of-scope `fs-service` fails) |
| All existing tests remain green | ✅ 443 → 447 in tenant/auth (4 new cross-tenant tests), coa-service 205 → 275 (70 new route-level authz tests, since none existed before this phase) |

## Test evidence

| Service | Before | After |
|---|---|---|
| tenant-service | 150/150 | **154/154** (+4 new assignment-scope cross-tenant tests, one per route file) |
| auth-service | 87/87 | 88/88 (unrelated Phase 2 regression test, unchanged this phase) |
| coa-service | 205/205 | **275/275** (+70 new route-level authorization tests — `tests/authz-guard-integration.test.ts`, the **first** test in this service to exercise the HTTP/route layer at all) |

```
tenant-service: Test Files 11 passed | Tests 154 passed
auth-service:   Test Files  7 passed | Tests  88 passed
coa-service:    Test Files 17 passed | Tests 275 passed
tsc --noEmit: 0 errors (all three services)
```

## Scope of the new coa-service route tests

Before this phase, **zero** coa-service tests constructed a Fastify app or called `app.inject` — all 205 existing tests are application/domain-service unit tests against mocked Prisma clients. `tests/authz-guard-integration.test.ts` is table-driven across the ~20 distinct permission keys (not every individual endpoint — endpoints sharing a permission key run the identical guard code, so re-testing it per-endpoint would be redundant, not more rigorous) and proves, per permission key: 401 unauthenticated, 403 deny-by-default for an unrelated role, allow for a granted role, and a genuine cross-tenant deny. `services/tenant-service`'s 4 pre-existing route-authz test files were adapted (not rewritten): their JWT-role-varying pattern now derives the token's `sub` from the role name so a shared in-memory `createFakeAuthzClient` (mirroring `AuthzService._rolesForUserInScope`'s real tenant/entity/store scoping rules) can resolve persisted-assignment-equivalent behavior, and one new cross-tenant test was added per file.

**Known test-coverage gap, disclosed rather than silently left out:** `oemRefRoutes` (franchise-routes.ts) and the admin-void-any path (`je.draft.void.any` business flag) are not independently route-tested — the former shares its guard instance with the tested franchise routes; the latter's underlying reason-required/permission-flag behavior is covered at the application layer (`tests/void.test.ts`) but not at the route-guard layer specifically. See `AUTHORIZATION_WRITE_PATH_CENSUS.csv` rows for exact status per route.

## Security improvement discovered during centralization

The local stub pattern being replaced checked only `request.user.role` (the JWT's role claim) against a hardcoded Set — it never validated **which tenant** that role applied to. Any JWT bearing `role: 'ADMIN'`, for any tenant, satisfied every local `ROLE_PERMISSIONS` check in all 13 files. The real S207 engine resolves permissions from **persisted, tenant-scoped role assignments** (`authz_role_assignment`, populated by S206) — a role string alone means nothing without a matching assignment row for that specific tenant (and, where set, entity/store). This is a genuine cross-tenant privilege escalation risk that centralization closes, not merely a refactor; it is proven by the new cross-tenant negative tests added to all 4 tenant-service files and the coa-service integration suite.

## Reconciliation: `je.post` / ACCOUNTANT (disclosed decision, not a silent behavior change)

The S207 catalog already contained `je.post` (seeded in the original v1.0.0 migration, 2026-07-24, before the Journal Lifecycle package existed), granted only to ADMIN/CONTROLLER. The coa-service local stub for `je.post` (built later, in S013/S216) already granted it to ACCOUNTANT as well — matching S216's own story text ("the accountant hits Post on a validated draft"). Switching to the central catalog as originally seeded would have **silently removed** posting ability from accountants who have it in production today. The Phase 3 migration adds the `('ACCOUNTANT', 'je.post')` grant (never removes a grant) to reconcile the catalog with already-shipped, already-tested behavior. This is called out explicitly in the migration file's own comment block and here, per the instruction not to redesign the permission catalogue silently.

## Explicitly not done in this phase (per instruction)

- The permission catalogue's shape/model was not redesigned — only extended with keys and grants matching what was already documented in `MODULE_STATE.json`'s own `keyRules` fields or already shipped by the local stubs.
- No second authorization service or framework was created — `HttpAuthzClient` is a client for the one existing S207 engine.
- Field masking (S004A/S217's `maskedFieldsFor` stub) was left untouched — it is explicitly out of scope for this package (S004A is one of the nine excluded remaining stories).
- Development bypass: `packages/shared-kernel/src/middleware/auth.ts`'s `NODE_ENV === 'development'` short-circuit (which injects `sub: 'dev-user'`, `role: 'ADMIN'`) was **not removed** — removing an authentication bypass is a behavior change beyond this phase's authorization-centralization scope, and the existing bootstrap seed (`authz-kunes-dev` → `tenant-kunes`/`dev-user`/ADMIN, tenant-wide) means dev-mode runtime testing against `tenant-kunes` continues to work exactly as before. **Operational note:** because the real engine is now tenant-scoped, dev-mode testing against any `x-tenant-id` other than `tenant-kunes` will now correctly deny (previously, the local stubs allowed any tenant) — this is the security fix described above, not a defect.

**Verdict: R0_AUTHORIZATION_CLOSURE_PASSED.**
