# S205 — User Account Lifecycle — Completion Evidence

**Package:** R0-ORG-FOUNDATION · **Epic:** CE-01 · **Release:** R0 · **Priority:** P0
**Status:** DONE_PENDING_INTEGRATION
**Completed:** 2026-07-24
**Uses stubs:** yes — `AuditPort` stub (`audit_outbox`, no S007 consumer yet). `AuthzPort` is **real** (co-located S207).

---

## 1. Scope delivered

Full staff-login lifecycle: create (INVITED), activate, lockout after failed logins,
admin unlock, password reset, and deactivation with session revocation — each scoped
to entity/store and each audit-logged. Users hold **no permissions directly** (BR205-4);
authorization comes solely from S206 role assignments. The prototype auth-service token
issuance (unvalidated credentials) is **discarded** per §6/§7; this story owns the real
user record and its state machine.

| Layer | Artifact |
|-------|----------|
| Migration | `services/auth-service/prisma/migrations/20260724000004_add_user_lifecycle/migration.sql` |
| Schema | `services/auth-service/prisma/schema.prisma` (`User`, `Session`) |
| Service | `services/auth-service/src/application/user-service.ts` |
| Routes | `services/auth-service/src/http/user-routes.ts` |
| Wiring | `services/auth-service/src/index.ts` (gateway `/api/v1/iam` already routes to auth-service) |

---

## 2. Data model (additive, §8)

- **`user`** — `email` (unique per tenant, BR205-1), `display_name` (1–80), `status`
  (INVITED | ACTIVE | LOCKED | INACTIVE), `failed_logins`, `entity_scope[]`,
  `store_scope[]`, `version` (optimistic), `reset_token_hash` / `reset_token_expires_at`,
  `deactivated_at`. No password/permission columns — access is role-only (BR205-4).
- **`session`** — issued sessions; `status` (ACTIVE | REVOKED) + `revoked_at`.
  Deactivation flips every ACTIVE session to REVOKED (BR205-2).

Status machine: `INVITED → ACTIVE → LOCKED (5 failed logins) → ACTIVE (admin unlock);
ACTIVE → INACTIVE (deactivate; sessions revoked)`.

Seed (catalog **v1.2.0**): permissions `iam.user.view` / `iam.user.manage`;
role_permission grants (ADMIN: view+manage; CONTROLLER: view); the starter roles'
`permissions[]` kept in sync. Two bootstrap user rows (`dev-user`, `acct-user`,
status ACTIVE) matching the existing authz assignment holders so the lifecycle and the
last-admin guard operate on real users.

---

## 3. API (§9)

Mounted under `/api/v1/iam` (gateway `/api/v1/iam` → `auth-service:3001`). Deny-by-default
via the real S207 AuthzPort — mutations require `iam.user.manage`, reads `iam.user.view`:

| Endpoint | Behavior |
|----------|----------|
| `GET /users` / `GET /users/:id` | `200` list / one · `404` |
| `POST /users` | `201 {status:INVITED}` · **`409 DUPLICATE_EMAIL`** · `422` validation |
| `POST /users/:id/deactivate` | `200 {user, revokedSessions}` · **`422 LAST_ADMIN`** (self) |
| `POST /users/:id/unlock` | `200` — status ACTIVE, `failedLogins:0` |
| `POST /users/:id/reset` | `202 {resetToken}` (hash stored, raw returned once) |

Events (schemaV:1): `iam.user.created | deactivated | locked | unlocked`
`{eventId, tenantId, userId, email, actor, ts}`. Consumes: none. `iam.user.deactivated`
is consumed by **S206** to auto-revoke that user's role assignments (wired; broker
delivery validated at the integration gate).

---

## 4. Business rules & acceptance criteria

| Rule / AC | Behavior |
|-----------|----------|
| BR205-1 unique email per tenant | `@@unique(tenantId,email)` + pre-check → `409` |
| BR205-2 deactivation revokes sessions ≤ 15 min | Sessions flipped REVOKED **synchronously** on deactivate (well within SLA) |
| BR205-3 all lifecycle actions audit-logged | `audit_outbox` record on every state change |
| BR205-4 users hold no permissions directly | No permission columns; access via S206 roles only |
| lockout at 5 failed logins | `recordFailedLogin` → LOCKED at threshold + `iam.user.locked` |
| AC created user sees nothing until role assigned | Deny-by-default authz check for a role-less user → `NO_MATCHING_ROLE` |
| AC deactivation terminates sessions | Verified: 2 ACTIVE sessions → REVOKED |
| AC (neg) duplicate email → 409 | `DUPLICATE_EMAIL` |
| AC (neg) last-admin self-deactivation → 422 | `LAST_ADMIN` |

---

## 5. Test evidence — 31/31 green (full auth-service suite 87/87)

| Suite | Count | Focus |
|-------|-------|-------|
| `tests/user-service.test.ts` | 19 | create/INVITED, duplicate-email, email/name validation, activate, lockout at 5, unlock, deactivate + session revocation, last-admin guard, reset token hashing, tenant isolation, §9 event payload |
| `tests/user-routes.test.ts` | 12 | §9 status codes (201/202/200/409/422/403/404/400), deny-by-default guard |

`npx vitest run` (auth-service) → **87 passed** (S207 27 + S206 29 + S205 31).

---

## 6. Runtime transcript (Docker dev, auth-service :3001)

| # | Flow | Result |
|---|------|--------|
| 1 | list users (dev-user ADMIN) | `200` — dev@ / acct@ ACTIVE |
| 2 | create jane | `201` — status INVITED |
| 3 | duplicate email | `409 DUPLICATE_EMAIL` |
| 4 | create as acct-user (view-only) | `403` — Missing `iam.user.manage` |
| 5 | authz check jane before role | `{allow:false, reason:NO_MATCHING_ROLE}` (deny-by-default) |
| 6 | reset jane | `202` — `resetToken` issued (hash stored) |
| 7 | deactivate jane (2 active sessions) | `200` — `revokedSessions:2`, both sessions REVOKED |
| 8 | last-admin self-deactivation (dev-user) | `422 LAST_ADMIN` |
| 9 | unlock a LOCKED user | `200` — status ACTIVE, `failedLogins:0` |
| 10 | catalog diff 1.1.0 → 1.2.0 | `200` — 15 perms, added `iam.user.manage|view` |

Audit trail (`audit_outbox`, doc_type=user): `CREATE`, `RESET`, `DEACTIVATE`, `UNLOCK`
by `dev-user` — proving BR205-3 (100% lifecycle actions logged).

---

## 7. Spec deviations

- **User routes co-located in `auth-service`** under `/api/v1/iam/users` (alongside
  S206 roles / S207 authz), so the deny-by-default guard calls the real AuthzPort
  in-process. No gateway change needed (the `/api/v1/iam` prefix already routes here).
- **No login/token endpoint** in this story. The prototype token issuance (unvalidated
  credentials) is discarded per §7; the "authenticate but sees nothing until a role is
  assigned" AC is proven via the deny-by-default authz check for a role-less user.
  Credential auth / session issuance is a follow-up (out of this story's §9 surface).
- **Lockout** is driven by `recordFailedLogin` (unit-tested at the threshold); with no
  login endpoint yet, the runtime transcript demonstrates the **unlock** path against a
  LOCKED user.

## 8. Known limitations / carry-forward (integration gate)

- **AuditPort is a stub** (`audit_outbox` outbox only) — S007 audit consumer wiring is
  deferred to the S007 integration gate → status `DONE_PENDING_INTEGRATION`.
- **`iam.user.deactivated` → S206 auto-revoke** is wired and unit-tested, but the dev
  in-memory event bus `subscribe` is a no-op stub (RabbitMQ unavailable), so cross-story
  fan-out is proven by unit test rather than the runtime bus. Broker-backed delivery is
  validated at the integration gate.
- Session **revocation SLA** is met by synchronous revocation on deactivate; the async
  15-min timed-test target is a PROPOSED_TARGET for the integration gate.
