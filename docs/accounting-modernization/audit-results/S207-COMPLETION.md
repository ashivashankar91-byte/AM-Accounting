# S207 — Permission Catalog & Check API — Completion Evidence

**Package:** R0-ORG-FOUNDATION · **Epic:** CE-01 · **Release:** R0 · **Priority:** P0
**Status:** DONE
**Completed:** 2026-07-24
**Uses stubs:** no — this IS the AuthzPort provider

---

## 1. Scope delivered

A versioned, deny-by-default permission catalog and a `check(user, permission, scope)`
API so every service enforces authorization identically. Replaces the scattered,
static `ROLE_PERMISSIONS` maps that S200–S204 used as AuthzPort stubs.

| Layer | Artifact |
|-------|----------|
| Migration | `services/auth-service/prisma/migrations/20260724000002_add_authz_catalog/migration.sql` |
| Schema | `services/auth-service/prisma/schema.prisma` (`Permission`, `RolePermission`, `AuthzRoleAssignment`, `CatalogVersion`, `AuthzOutboxEvent`) |
| Service | `services/auth-service/src/application/authz-service.ts` |
| Routes | `services/auth-service/src/http/authz-routes.ts` |
| Wiring | `services/auth-service/src/index.ts`, `services/api-gateway/src/index.ts` |

---

## 2. Data model (additive, §8)

- **`permission`** — master catalog. `key` PK (dot-namespaced), `description`,
  `since_version`, `status` (DRAFT/SHIPPED/DEPRECATED). Catalog ships with releases
  (BR207-1) — no runtime-added permissions.
- **`role_permission`** — role → permission-key grants. Seeded from the R0 role model.
- **`authz_role_assignment`** — read-model projection of who holds which role in which
  scope. Populated later by S206 `iam.assignment.*` events. **No CRUD endpoints** —
  assignment management is S206.
- **`catalog_version`** — version metadata enabling the diff report.
- **`authz_outbox_events`** — transactional outbox for `iam.authz.denied` (mirrors
  `tenant_outbox_events`).

Seed for catalog **v1.0.0**: 10 permission keys, 34 role grants
(ADMIN/CONTROLLER/SERVICE manage; ACCOUNTANT view-only; `je.post` for ADMIN/CONTROLLER).

---

## 3. API (§9)

| Endpoint | Behavior |
|----------|----------|
| `GET /authz/check?user&permission&tenant&entity?&store?` | `200 {allow, matchedRole?, reason}` · `400 UNKNOWN_PERMISSION` on typo · `400 INVALID_REQUEST` on missing params |
| `GET /authz/catalog?version?&diffFrom?` | `200` versioned list (+ diff report) · `404 VERSION_NOT_FOUND` · `403` when a user context lacks `iam.catalog.view` |

Event `iam.authz.denied` `{eventId, userId, permissionKey, scope, route, reason, ts, schemaV:1}`
written to the outbox on **every** deny (BR207-3). Cache invalidation subscribes to
`iam.role.*` / `iam.assignment.*`; grants also self-expire on a 5 s TTL bound (AC:
"role grant reflects within 5 s").

Gateway routes `/api/v1/authz` → `auth-service:3001`.

---

## 4. Business rules & acceptance criteria

| Rule / AC | Behavior |
|-----------|----------|
| BR207-1 catalog ships with releases | No runtime add path; catalog is migration-seeded |
| BR207-2 check p99 < 10 ms cached | Benchmark test (2000 cached calls) — PROPOSED_TARGET |
| BR207-3 every deny audit-logged | `iam.authz.denied` outbox write on every deny |
| BR207-4 scope model tenant→entity→store | Hierarchy validated; store-without-entity = escalation |
| AC no-roles → deny + audit | `NO_MATCHING_ROLE` + outbox event |
| AC role grant → allow | `{allow:true, matchedRole}` |
| AC unknown permission → 400 | `UNKNOWN_PERMISSION` (typo guard) |
| AC catalog diff between releases | `diff {added, removed, unchanged}` migration report |
| AC (neg) scope-escalation denied + flagged | `SCOPE_ESCALATION` deny + flagged on event |

---

## 5. Test evidence — 27/27 green

| Suite | Count | Focus |
|-------|-------|-------|
| `tests/authz-service.test.ts` | 16 | deny-by-default, grants, unknown-permission, scope hierarchy/escalation, tenant isolation, catalog + diff, cache |
| `tests/authz-routes.test.ts` | 10 | §9 status-code mapping (200/400/404/403), scope pass-through |
| `tests/authz-benchmark.test.ts` | 1 | cached-check p99 within target |

## 6. Runtime transcript (Docker dev, gateway :3100)

| Flow | Result |
|------|--------|
| deny (no-role user) | `{allow:false, reason:NO_MATCHING_ROLE}` |
| allow (dev-user ADMIN, `acct.store.manage`) | `{allow:true, matchedRole:ADMIN}` |
| deny (acct-user cannot manage) | `{allow:false, reason:NO_MATCHING_ROLE}` |
| unknown permission | `400 UNKNOWN_PERMISSION` |
| scope escalation (store without entity) | `{allow:false, reason:SCOPE_ESCALATION}` |
| catalog list | `200` — version 1.0.0, 10 permissions |
| catalog diff | `200` — `{added:[], removed:[], unchanged:10}` |

3 `iam.authz.denied` rows confirmed in `authz_outbox_events` with the §9 payload.

---

## 7. Known limitations / carry-forward

- Role resolution reads the `authz_role_assignment` read-model, seeded minimally for
  R0. S206 will own assignment management and emit the `iam.assignment.*` events that
  populate it. The existing per-service `ROLE_PERMISSIONS` stub maps (S200–S204) can be
  swapped to call `GET /authz/check` at their integration gates.
- Deny events use the outbox pattern; the real S007 audit consumer wiring is deferred
  to the S007 integration gate.
- `p99 < 10 ms` is a PROPOSED_TARGET proven via unit benchmark; a CI benchmark gate and
  the "100% routes declare permission" CI gate (APPROVED_TARGET) are follow-ups.
