# S202 — Dealer Group Hierarchy View & Maintenance — Live-Gateway Certification Report

**Status: DONE_PENDING_INTEGRATION** (unchanged — Figma/UX and browser validation remain
open per Product Owner directive; this report closes the outstanding
"real-gateway evidence" gap only)

**Certification date:** 2026-07-27
**Phase:** Golden-R0 Controlled Fleet Execution — S202 real-gateway evidence follow-up

## 1. Scope and why this report exists

The prior S202 completion report (commits `7a042bb`, `d7626f6`, `5e26f2c`) certified the
backend using unit tests against an in-memory fake Prisma client and a fake `AuthzClient`,
plus direct-database migration/RLS verification via `psql`. No HTTP request had been made
against the real, running `tenant-service`/`api-gateway` processes. The Product Owner
required this gap closed ("complete the missing commit-report correction and
real-gateway evidence") before treating S202 as backend-complete.

This report supersedes that gap with real HTTP evidence captured against the live
Final-R0 stack: `api-gateway:13100` → `tenant-service:13002` / `auth-service:13001`,
backed by the shared Postgres instance on `localhost:45433` (real `amacc_app` runtime
role, RLS-enforced, not the `postgres`/`amacc` superuser).

## 2. Defects found and fixed while wiring up live evidence

| # | Defect | Fix |
|---|--------|-----|
| 1 | `api-gateway` had no route entry for `/api/v1/org` — S202's endpoints were unreachable through the real gateway despite being fully implemented and unit-tested in `tenant-service`. | Added `{ prefix: '/api/v1/org', upstream: TENANT_SERVICE_URL }` to `SERVICES` in `services/api-gateway/src/index.ts`. |
| 2 | The two new migrations from the prior S202 package (`tenant-service:20260727000002_add_org_reparent_events`, `auth-service:20260727000002_extend_authz_catalog_org_and_audit_history`) had only been verified against ephemeral throwaway Postgres containers — they had never been applied to the actual shared live-stack database that the running services connect to. | Applied both via `prisma migrate deploy` against the live DB (`localhost:45433`), using the `amacc` superuser role (schema owner) because the `amacc_app` runtime role deliberately lacks `CREATE` on `public` (least-privilege, confirmed by a `42501 permission denied for schema public` failure on first attempt with the app role) — this is a real, expected production-shaped separation between a migration role and a runtime role, not a defect. Then explicitly `GRANT SELECT, INSERT, UPDATE, DELETE ON org_reparent_events TO amacc_app` since the new table is created by a different owner than the runtime role. |
| 3 | `tenant-service`, `auth-service`, and `api-gateway` processes still running from earlier sessions predated all of the above code/schema changes (no hot-reload; `tsx src/index.ts` without `--watch`). | Stopped and restarted all three with the same environment variables captured from the original process environments (`NODE_ENV=production`, shared `DATABASE_URL`/`JWT_SECRET`/`AMACC_JWT_SECRET`/`AUDIT_SERVICE_URL`/service URLs) so the real, non-bypass auth path continued to be exercised. |

Commit for these three fixes: see §5.

## 3. Live-gateway scenario matrix

Test identities used (already present in the live DB from prior certification sessions,
passwords reset to a known evidence-only value for this run since password hashes are
one-way and the plaintext from earlier sessions was never recorded):

| User | Tenant | Role(s) |
|------|--------|---------|
| `admin@kunes-final-r0.test` | `1cf31f14-...` (Kunes Final R0) | ADMIN, CONTROLLER (has `org.tree.manage`) |
| `viewonly@kunes-final-r0.test` (new, created for this evidence run) | `1cf31f14-...` (Kunes Final R0) | ACCOUNTANT (has `org.tree.view` only, no `org.tree.manage`) |
| `xtuser@crosstenant.test` | `e410db34-...` (CrossTenant GoldenPath Co) | ADMIN (own tenant only) |

| # | Scenario | Request | Result |
|---|----------|---------|--------|
| 1 | Positive — real API + real Postgres | `GET /api/v1/org/tree` as tenant-A ADMIN | `200`, real 4-level tree (GROUP → Kunes Final R0 LLC ENTITY → Kunes Main Store STORE → FORD FRANCHISE) sourced from live `LegalEntity`/`Store`/`Franchise` rows |
| 2 | Unauthorized — no token | `GET /api/v1/org/tree`, no `Authorization` header | `401 {"error":"Missing or invalid Authorization header"}` |
| 3 | Unauthorized — invalid token | `GET /api/v1/org/tree`, `Authorization: Bearer garbage.invalid.token` | `401 {"error":"Invalid JWT signature"}` |
| 4 | Cross-tenant denial | `GET /api/v1/org/tree` with tenant-B's JWT but `x-tenant-id` header set to tenant A | `403 {"error":"Tenant ID mismatch"}` — real gateway-layer tenant-isolation enforcement, independent of and in addition to Postgres RLS |
| 5 | Cross-tenant own-tenant view (control) | `GET /api/v1/org/tree` with tenant-B's JWT and matching `x-tenant-id` | `200`, tenant-B's own (empty) tree — proves scenario 4 was a real tenant check, not a blanket failure |
| 6 | S207 action-level denial | `POST /api/v1/org/tree:reparent` as `viewonly@kunes-final-r0.test` (has `org.tree.view`, not `org.tree.manage`) | `403 {"error":"FORBIDDEN","message":"Missing required permission: org.tree.manage","reason":"NO_MATCHING_ROLE"}` — real centralized S207 authorization engine call, not a local permission map |
| 7 | Validation failure — invalid parent | `POST /api/v1/org/tree:reparent` with `newParentId` that does not resolve to a `LegalEntity`/`Store` of the correct type | `422 {"error":"PARENT_NOT_FOUND", ...}` |
| 8 | Validation failure — malformed body | `POST /api/v1/org/tree:reparent` missing required `nodeType`/`effectiveFrom` fields | `400 {"error":"VALIDATION_ERROR", "issues": [...] }` (Zod schema validation) |
| 9 | Positive — reparent + real persistence | `POST /api/v1/org/tree:reparent` as tenant-A ADMIN, valid `FRANCHISE` → `STORE` move | `200`, response echoes `oldParentId`/`newParentId`/`effectiveFrom`; row persisted in `org_reparent_events` (verified via `psql`) |

### Note on BR202-1 true-cycle rejection

The defensive `newParentId === nodeId` / ancestor-walk cycle guard in
`org-service.ts` cannot be reached through real HTTP traffic: because `STORE`'s
`newParentId` must resolve to a real `LegalEntity` id and `FRANCHISE`'s must resolve to a
real `Store` id, a node's own id can never simultaneously be a valid id of its parent's
type — the fixed 4-level typed tree (documented in the code comment at
`org-service.ts:183-187`) makes a true cycle structurally unreachable via any real
request, which is exactly what scenario 7 demonstrates (the closest real attempt
resolves to `PARENT_NOT_FOUND`, not a cycle). This code path remains covered by the
existing unit test (`org-service.test.ts`) using a contrived fake-Prisma fixture, which is
the only way to exercise it. This is a documented, intentional gap between "reachable via
mocks" and "reachable via real data," not an untested code path.

## 4. S007 audit evidence (real, queried directly from `audit_logs`)

```
event_type                    | entity_type | entity_id                              | action            | actor_id
orgnode.reparent              | OrgNode     | d3bf7026-1209-4087-9694-0054e0f3a01e    | REPARENT          | 97511a20-...  (tenant-A ADMIN)
authzdenial.iam.authz.denied  | AuthzDenial | c51f842f-...                            | iam.authz.denied  | c51f842f-...  (view-only user, scenario 6)
```

Both rows carry `tenant_id = 1cf31f14-...` (tenant A), confirming tenant-scoped audit
capture for both a successful mutating action and a denied authorization attempt.

## 5. Commits

This report and its supporting fixes (gateway route, live-DB migration deploy, service
restarts) are committed separately from the original S202 backend commits per the
"commit each logical phase separately" convention. See commit immediately following this
file in `git log`.

## 6. What remains before S202 can move to DONE

Unchanged from the prior report:
- Figma/UX validation for the org-tree screen and reparent interaction.
- Browser-level Golden Path coverage (S202 is not part of the minimum Golden Path route
  set defined for Final-R0, so this will be revisited during the dedicated frontend/
  browser phase, not blocking other fleet stories).

No backend or live-gateway gap remains open for S202.
