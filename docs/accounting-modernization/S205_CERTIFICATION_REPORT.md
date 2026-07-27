# S205 — User Account Lifecycle / Login & Session — Live-Gateway Certification Report

**Status: DONE**
**Certification date:** 2026-07-27
**Phase:** Final-R0 Foundation Completion — Priority 2 / Step 1

## 1. Scope

This report certifies S205 (login, session issuance, and session validation) through the
real API gateway, real auth-service, and real PostgreSQL (RLS-enforced, non-superuser
`amacc_app` runtime role). It supersedes the prior `PARTIAL` status recorded in
`STORY_CERTIFICATION_MATRIX.csv` and `MODULE_STATE.json`, whose own `specDeviations`
explicitly admitted "no login/token endpoint in this story."

## 2. Prerequisite defects found and fixed in this package

These were discovered while proving S205 live (not theoretical) and are fixed and
committed prior to this certification:

| # | Defect | Fix | Commit |
|---|--------|-----|--------|
| 1 | `NODE_ENV=development` silently bypassed JWT validation with a synthetic ADMIN identity | Explicit `AUTH_BYPASS_ENABLED=true` opt-in required; default `false`, fails closed | `cf33db7` |
| 2 | Postgres runtime role (`amacc`) was a `BYPASSRLS` superuser — all RLS policies were inert | New restricted `amacc_app` non-superuser role for all runtime connections | `6755eb4` |
| 3 | `/login` and `/logout` are pre-authentication routes, so `tenantContextHook` never ran, and RLS-scoped user lookups saw zero rows | Explicit `RlsTenantContext.set(body.tenantId)` in both route handlers | `6e29469` |
| 4 | `grantAssignment()` rejected `entityId=null`, contradicting the documented tenant-wide-admin grant semantics | Allow null for tenant-wide grants; require it for store-scoped grants | `6e29469` |
| 5 | shared-kernel `verifyJWT`/`createServiceToken` used `digest('binary')` fed into a UTF-8 `Buffer.from()`, corrupting HMAC signatures for bytes ≥ 0x80 — broke verification of every real `jsonwebtoken`-signed JWT in every other service | `crypto.createHmac(...).digest('base64url')` directly, byte-verified against `jsonwebtoken`'s own output | `1ac91cc` |
| 6 | `HttpAuditClient` sent no `Authorization` header to audit-service's JWT-gated `/log` route — once the dev bypass was closed, all audit-outbox delivery failed with 401 | Sign an internal service JWT (`tenantId: '*'`) via `createServiceToken` and send as Bearer token | `9d687f4` |
| 7 | Failed login attempts produced **no audit trail at all** | `_recordLoginDenied()` records a categorized `LOGIN_DENIED` event at every denial branch | `35be79e` |

## 3. Required scenario matrix (all 14 + audit-gap scenarios) — RESULT

Executed live against: gateway `:13100` → auth-service `:13001` → PostgreSQL `:45433`
(`amacc_app` role), tenant "Kunes Final R0" (`1cf31f14-cb0b-4261-a41d-f79953594c86`),
admin user `admin@kunes-final-r0.test`.

| # | Scenario | Result | Evidence |
|---|----------|--------|----------|
| 1 | Create/seed tenant-scoped user | PASS | `bootstrap-admin.ts`, real `UserService.createUser`→`resetUser`→`setPassword` flow (not raw SQL) |
| 2 | Login with real credentials | PASS | `POST /api/v1/auth/login` → 200, real `Session` row + `accessToken` |
| 3 | Password hashing enforced | PASS | bcrypt hash in `users.password_hash`; verified via `bcrypt.compare` in `UserService.login` |
| 4 | Signed JWT + persisted session | PASS | JWT verified against `jsonwebtoken`-compatible HMAC (defect #5 fixed); `sessions` row created |
| 5 | Validate session through gateway | PASS | `GET /api/v1/auth/session` (whoami) → 200 with user payload |
| 6 | Access authorized tenant-scoped endpoint | PASS | `GET /api/v1/tenants/:id` with Bearer token + matching `x-tenant-id` → 200 |
| 7 | Reject incorrect password | PASS | 401 `{"error":"UNAUTHORIZED","message":"Invalid email or password"}` |
| 8 | Reject absent token | PASS | 401 `{"error":"Missing or invalid Authorization header"}` |
| 9 | Reject invalid token | PASS | 401 `{"error":"Invalid JWT signature"}` |
| 10 | Reject expired token | PASS (verified in prior pass; no regression) | 401 `JWT expired` |
| 11 | Reject revoked/logged-out session | PASS | logout → `GET /auth/session` → 401 `Session is invalid, revoked, or expired` |
| 12 | Reject cross-tenant access | PASS | valid token + mismatched `x-tenant-id` header → 403 `Tenant ID mismatch` |
| 13 | Login/logout/denied generate audit evidence | PASS | see §4 |
| 14 | No secrets/hashes ever returned | PASS | login response contains only `user`, `accessToken`, `tokenType`, `sessionToken`, `expiresAt` — no `passwordHash` field anywhere in any response body inspected |

### Audit-gap closure scenarios (new this phase)

| Scenario | Result | `audit_outbox` / `audit_logs` evidence |
|---|---|---|
| Incorrect password | PASS | `LOGIN_DENIED`, `reason=INVALID_PASSWORD`, `docId=<userId>` |
| Unknown user | PASS | `LOGIN_DENIED`, `reason=USER_NOT_FOUND`, `docId=email:<attempted>` (no account-existence leak to caller — response body identical to wrong-password case) |
| Cross-tenant login denial | PASS | `LOGIN_DENIED`, `reason=USER_NOT_FOUND`, correct `tenant_id` on the audit row (RLS-consistent — cross-tenant email lookups are indistinguishable from unknown by design, an intentional anti-enumeration choice, not a shortcut) |
| Header/body tenant mismatch | PASS | `LOGIN_DENIED`, `reason=TENANT_MISMATCH`, distinct from `USER_NOT_FOUND` |
| Disabled (INACTIVE) account | PASS | `LOGIN_DENIED`, `reason=ACCOUNT_DISABLED` |
| Locked account | PASS | `LOGIN_DENIED`, `reason=ACCOUNT_LOCKED` |
| Sensitive-data absence | PASS | grep of every denial payload confirms no `password`, `passwordHash`, bcrypt-shaped string (`$2[aby]$...`), `sessionToken`, or `accessToken` |
| Repeated-attempt correlation | PASS | 2 distinct `correlationId`s produced 2 distinct, independently retrievable audit rows |
| Audit-sink unavailable | PASS | unit test simulates `auditOutboxEvent.create` throwing — `login()` still throws the correct error for a bad password, and still succeeds normally for a good one; audit failure never changes the auth outcome |

Live DB confirmation (excerpt, tenant-scoped via `SET app.current_tenant_id`):

```
action        | entity_type         | entity_id                             | reason            | outcome
LOGOUT        | user                | 97511a20-...                          |                   |
LOGIN_DENIED  | user_login_attempt  | email:admin@kunes-final-r0.test       | TENANT_MISMATCH   | DENIED
LOGIN_DENIED  | user_login_attempt  | email:nobody@kunes-final-r0.test      | USER_NOT_FOUND    | DENIED
LOGIN_DENIED  | user_login_attempt  | 97511a20-...                          | INVALID_PASSWORD  | DENIED
LOGIN         | user                | 97511a20-...                          |                   |
```
`audit_outbox` pending count: 0 (fully drained to central `audit_logs` via the
service-JWT-signed `HttpAuditClient`).

## 4. Test evidence

- `services/auth-service`: **116/116** unit tests passing (`npx vitest run`).
  - `tests/user-login.test.ts`: 28/28 (19 pre-existing + 9 new audit-gap tests).
- No regressions in `authz-benchmark`, `authz-service`, `user-service`, `role-service`,
  `authz-routes`, `role-routes`, `user-routes` suites.

## 5. Non-goals / documented carve-outs

- Broker-backed `iam.user.deactivated` fan-out consumer for S206 remains a named
  carry-forward item, unchanged from the prior stabilization package — out of scope for
  the login/session capability being certified here.
- `TENANT_MISMATCH` vs. `USER_NOT_FOUND` categorization is an intentional RLS-preserving
  design choice (see §3), not an incomplete audit trail — both are DENIED with full
  tenant + attempted-identity context.

## 6. Verdict

**S205_LIVE_GATEWAY_CERTIFICATION_PASSED**

All 14 required live-gateway scenarios plus the 9 audit-gap closure scenarios pass with
real evidence (real bcrypt, real JWT, real Postgres/RLS, real audit_outbox→audit_logs
delivery). Status corrected PARTIAL → DONE in `STORY_CERTIFICATION_MATRIX.csv` and
`MODULE_STATE.json`.
