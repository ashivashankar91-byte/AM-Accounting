# S206 — Basic Role Management — Completion Evidence

**Package:** R0-ORG-FOUNDATION · **Epic:** CE-01 · **Release:** R0 · **Priority:** P0
**Status:** DONE_PENDING_INTEGRATION
**Completed:** 2026-07-24
**Uses stubs:** yes — `AuditPort` stub (writes `audit_outbox`, no S007 consumer yet). `AuthzPort` is **real** (co-located S207).

---

## 1. Scope delivered

Named roles that bundle catalog permissions, and scoped role→user assignments, so
administrators grant *jobs* (Accountant, Controller) rather than one-off permission
switches. S206 is the **write authority** for authorization: it projects into the S207
read models (`role_permission`, `authz_role_assignment`), emits `iam.role.*` /
`iam.assignment.*` events, and invalidates the AuthzPort cache so grants take effect
within the 5 s AC window.

| Layer | Artifact |
|-------|----------|
| Migration | `services/auth-service/prisma/migrations/20260724000003_add_role_management/migration.sql` |
| Schema | `services/auth-service/prisma/schema.prisma` (`Role`, `RoleAssignment`, `AuditOutboxEvent`) |
| Service | `services/auth-service/src/application/role-service.ts` |
| Routes | `services/auth-service/src/http/role-routes.ts` |
| Wiring | `services/auth-service/src/index.ts`, `services/api-gateway/src/index.ts` |

---

## 2. Data model (additive, §8)

- **`role`** — a named bundle of catalog permission keys. `key` (stable slug, e.g.
  `ADMIN`), `name` (1–60, unique per tenant), `permissions String[]` (catalog keys,
  BR206-1), `built_in`, `status` (ACTIVE | RETIRED). Unique on `(tenant_id, name)` and
  `(tenant_id, key)`.
- **`role_assignment`** — write-model of who holds which role in which scope. `entity_id`
  **nullable** — `null` = tenant-wide (platform/tenant admin); a value = entity-scoped;
  `store_ids[]` / `all_stores` narrow within an entity. `status` (GRANTED | REVOKED).
- **`audit_outbox`** — AuditPort transactional outbox (`doc_type`, `doc_id`, `action`,
  `before`/`after` JSON, `actor`). Consumed by S007 at the integration gate.

Seed (catalog **v1.1.0**): 3 new permissions `iam.role.view|manage|assign`; role_permission
grants (ADMIN: view/manage/assign; CONTROLLER: view/assign; ACCOUNTANT: view). 4 starter
roles for tenant-kunes (BR206-4): **Administrator**, **Controller**, **Accountant**,
**Read-Only** (`built_in = true`). 2 bootstrap assignments (dev-user→ADMIN, acct-user→
ACCOUNTANT) seeded **tenant-wide** (`entity_id NULL`) so platform admins retain full
access at tenant level.

---

## 3. API (§9)

Mounted under `/api/v1/iam` (gateway `/api/v1/iam` → `auth-service:3001`). Every route is
deny-by-default guarded via the real S207 `check()`:

| Endpoint | Permission | Behavior |
|----------|-----------|----------|
| `GET /roles` | `iam.role.view` | list tenant roles |
| `GET /roles/:id` | `iam.role.view` | one role · `404` |
| `POST /roles` | `iam.role.manage` | `201` · `409 ROLE_EXISTS` · `422` validation |
| `PATCH /roles/:id` | `iam.role.manage` | update name/permissions |
| `DELETE /roles/:id` | `iam.role.manage` | `204` retire · **`409 ROLE_IN_USE`** if assigned (BR206-2) |
| `GET /role-assignments` | `iam.role.view` | list assignments |
| `POST /role-assignments` | `iam.role.assign` | `201` · **`422 ENTITY_OUTSIDE_TENANT` / `STORE_OUTSIDE_ENTITY`** |
| `DELETE /role-assignments/:id` | `iam.role.assign` | `204` revoke |

Events (schemaV:1): `iam.role.created|updated|retired`, `iam.assignment.granted|revoked`
`{eventId, tenantId, roleId, userId?, scope, actor, ts}`. Consumes `iam.user.deactivated`
→ auto-revokes all of that user's assignments. S207 subscription invalidates the AuthzPort
cache on these events; `RoleService` also calls `authz.invalidateCache()` directly (the
dev bus has no broker, so the 5 s TTL is the backstop).

---

## 4. Business rules & acceptance criteria

| Rule / AC | Behavior |
|-----------|----------|
| BR206-1 role = set of catalog permissions | `permissions[]` validated against S207 catalog; projected to `role_permission` |
| BR206-2 delete blocked while assigned | `DELETE /roles/:id` → `409 ROLE_IN_USE` when GRANTED assignments exist |
| BR206-3 assignments scoped (entity/store) | `entity_id` + `store_ids[]`/`all_stores`; projected per-store into read model |
| BR206-4 starter roles seeded | Administrator / Controller / Accountant / Read-Only (`built_in`) |
| AC assign outside user's entity → 422 | `ENTITY_OUTSIDE_TENANT` (entity not in tenant); `STORE_OUTSIDE_ENTITY` |
| AC role edit propagates ≤ 5 s | cache invalidation on event + 5 s TTL |
| AC (neg) delete assigned role → 409 | proven in transcript flow 4 |

---

## 5. Test evidence — 29/29 green (full suite 56/56)

| Suite | Count | Focus |
|-------|-------|-------|
| `tests/role-service.test.ts` | 17 | BR206-1..4, projection into read models, ENTITY_OUTSIDE_TENANT, STORE_OUTSIDE_ENTITY, retire-blocked, auto-revoke on deactivation |
| `tests/role-routes.test.ts` | 12 | §9 status-code mapping (201/204/403/404/409/422), permission guards, scope pass-through |

`npx vitest run` (auth-service) → **56 passed** (S207 27 + S206 29).

---

## 6. Runtime transcript (Docker dev, auth-service :3001)

| # | Flow | Result |
|---|------|--------|
| 1 | list roles (dev-user ADMIN) | `200` — 4 starter roles [ACCOUNTANT, ADMIN, CONTROLLER, READONLY] |
| 2 | create "Sales Manager" (dev-user) | `201` — key `SALES_MANAGER`, 2 perms |
| 3 | create role as acct-user | `403 FORBIDDEN` — Missing `iam.role.manage` |
| 4 | delete assigned ADMIN role | `409 ROLE_IN_USE` (BR206-2) |
| 5 | grant ACCOUNTANT → test-cashier @ store 01 | `201` — entity-scoped, store 01 |
| 6a | authz check test-cashier `acct.store.view` @ store 01 | `{allow:true, matchedRole:ACCOUNTANT}` |
| 6b | authz check test-cashier @ store 02 | `{allow:false, reason:NO_MATCHING_ROLE}` (cross-store) |
| 7 | grant entity outside tenant | `422 ENTITY_OUTSIDE_TENANT` |
| 8 | catalog diff 1.0.0 → 1.1.0 | `200` — version 1.1.0, 13 perms, added `iam.role.assign|manage|view` |

Post-run verification:
- `audit_outbox` — `role/CREATE/dev-user`, `role_assignment/GRANT/dev-user`.
- write-model `role_assignment` consistent with read-model `authz_role_assignment`
  (test-cashier: entity KUNES + store 01; bootstrap admins tenant-wide `entity_id NULL`).

---

## 7. Spec deviations

- **Roles placed in `auth-service`** (co-located with S207), not `tenant-service`, so the
  write-model → read-model projection into `role_permission` / `authz_role_assignment` is a
  single same-DB transactional write and the AuthzPort is real rather than an HTTP hop.
- **`role_assignment.entity_id` is nullable**: `null` denotes a **tenant-wide** grant
  (platform/tenant administrator). API-driven grants always specify an entity, so the
  "assign outside entity → 422" AC is unaffected; only the two bootstrap admin seeds use
  the tenant-wide projection. This restores the pre-S206 S207 super-admin behavior.

## 8. Known limitations / carry-forward (integration gate)

- **AuditPort is a stub** (`audit_outbox` outbox only) — S007 audit consumer wiring is
  deferred to the S007 integration gate. Status is therefore `DONE_PENDING_INTEGRATION`.
- Event delivery relies on the in-memory dev bus (RabbitMQ unavailable in dev); cache
  invalidation is proven via direct `invalidateCache()` + 5 s TTL. Broker-backed
  fan-out is validated at the integration gate.
- `iam.user.deactivated` auto-revoke handler is wired and unit-tested; end-to-end
  validation depends on S205 emitting that event (next story).
