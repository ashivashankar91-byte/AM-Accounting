# S004A — Dealership Position Role Templates: Live-Gateway Certification Report

**Date:** 2026-07-27
**Branch:** `golden-r0-fleet` (worktree `AM-Accounting-final-r0`)
**Story status after this report:** `DONE_PENDING_INTEGRATION` (per PO condition 8/9 — no separate
AuditPort/AuthzPort stub is used, S007/S207 are both real; the remaining gap to full `DONE` is the
required Figma/UX validation, per `GOLDEN_R0_STORY_CONTRACT_GAPS.md` Class 4, still PENDING).

## 1. Scope

S004A implements reusable, position-shaped role templates (`BILLER`, `CASHIER`, `TITLE_CLERK`,
`AP_CLERK`, `AR_CLERK`, `ACCOUNTANT`, `OFFICE_MGR`, `CONTROLLER`, `SALESPERSON_RO`) that a security
administrator can list, clone, customize, and apply in one action. Per the PO's explicit instruction,
**no separate local permission map was created** — applying a template delegates to the real S206
`RoleService` (`ensureRoleForPositionTemplate` + `grantAssignment`), so every template-derived grant is
enforced by the exact same real S207 `AuthzService.check()` path already certified for S206, and every
mutation produces a real S007 audit row via the same transactional outbox pattern.

## 2. What was built

- **Schema (additive only):** `RoleTemplate` (nullable `tenantId`: `NULL` = global shipped default,
  set = tenant-owned clone/customization) and `RoleTemplateAssignment` (links a template application to
  the real underlying `RoleAssignment`).
- **Migration** `20260727000004_add_role_templates`: creates both tables with RLS; `role_template` uses
  a novel hybrid policy (`SELECT` allows `tenant_id = current tenant OR tenant_id IS NULL`; `INSERT`/
  `UPDATE`/`DELETE` require the caller's own tenant — a global row can never be forged or mutated by a
  tenant, only shipped via a migration run as the schema-owning role). `role_template_assignment` uses
  the standard 4-policy tenant-isolation pattern used everywhere else in this service. Seeds catalog
  version `1.2.0`, permissions `iam.roletemplate.manage` / `iam.roletemplate.apply` (granted to
  `ADMIN`: both; `CONTROLLER`: apply only), and the 9 global shipped templates, built exclusively from
  permission keys that already exist in the real catalog (no invented domain permissions).
- **`RoleService.ensureRoleForPositionTemplate()`**: finds-or-creates a tenant-scoped `Role` keyed
  explicitly by the template's position slug (bypassing `_deriveKey()` name-derivation, since e.g.
  "Office Manager" would derive to `OFFICE_MANAGER`, not the contract's `OFFICE_MGR`), re-syncing
  projected permissions if the template's set has changed since the last apply.
- **`RoleTemplateService`** (`services/auth-service/src/application/role-template-service.ts`):
  `listTemplates`, `getTemplate`, `createTemplate` (bespoke or clone-by-value via `sourceTemplateId`),
  `cloneTemplate`, `updateTemplate` (blocks editing the immutable global row), `deactivateTemplate`
  (blocks while `APPLIED` assignments exist, mirroring S206's `RoleInUseError`/409 pattern),
  `applyTemplate` (the primary workflow), `listAssignments`, `revokeAssignment` (revokes the real
  underlying `RoleAssignment` too), `resolveFieldMasks()` / `applyFieldMasks()` (BR4A-2).
- **Routes** (`role-template-routes.ts`), mounted at the already-proxied `/api/v1/iam` prefix (no
  gateway change required): `GET/POST /role-templates`, `GET/PATCH/DELETE /role-templates/:id`,
  `POST /role-templates/:id/clone`, `POST /role-templates:apply`, `GET /role-template-assignments`,
  `DELETE /role-template-assignments/:id` — all gated by the real `AuthzService.check()` guard.

## 3. Real defect found and fixed (pre-live-evidence)

**Clone permission loss.** `cloneTemplate()` called `createTemplate({ ..., permissions: [], sourceTemplateId, ... })`,
and inside `createTemplate` the fallback was `permissions = dto.permissions ?? source.permissions`.
Because `??` only falls back on `null`/`undefined` — **not** on a present-but-empty array — every clone
silently received zero permissions instead of copying the source's set. Found by a unit test
(`clones a global template by value...`) before any live-gateway evidence was attempted.

**Fix:** `permissions` is now optional in `CreateTemplateDTO`; `cloneTemplate()` omits it entirely
(rather than passing `[]`); the clone-fallback branch was changed to
`(dto.permissions && dto.permissions.length > 0) ? dto.permissions : source.permissions`. Re-verified
live below (scenario 9): cloning `rt-global-cashier` correctly returns
`permissions: ["je.view","je.draft.create"]`, matching the source exactly.

## 4. Fresh-database migration verification

Ran all 11 auth-service migrations (`20260724000001_init` → `20260727010000_add_user_password_hash`,
including the new `20260727000004_add_role_templates`) via `prisma migrate deploy` against an ephemeral
Postgres 15 container (`docker run postgres:15`, no `prisma db push`, no pre-created tables). Result:
**all 11 applied successfully with zero errors.**

Verified directly via `psql` against that ephemeral instance, connected as a real non-superuser role
(`NOSUPERUSER NOBYPASSRLS`, not `postgres`, which always bypasses RLS):

- `relrowsecurity` / `relforcerowsecurity` both `true` on `role_template` and `role_template_assignment`.
- 9 global shipped templates present with `tenant_id IS NULL`, keyed exactly `BILLER`, `CASHIER`,
  `TITLE_CLERK`, `AP_CLERK`, `AR_CLERK`, `ACCOUNTANT`, `OFFICE_MGR`, `CONTROLLER`, `SALESPERSON_RO`.
- `iam.roletemplate.manage` / `iam.roletemplate.apply` present in `permission`.
- **Cross-tenant RLS proof (all 4 verbs) against the fresh DB:**
  - `SELECT` with `app.current_tenant_id='tenant-a'` sees all 9 globals (no tenant-a rows yet) — correct.
  - `INSERT` of a tenant-a-owned clone succeeds; **`INSERT` of a row claiming `tenant_id='tenant-b'`
    while `app.current_tenant_id='tenant-a'` is rejected** with
    `new row violates row-level security policy for table "role_template"`.
  - Tenant-b's `SELECT ... WHERE tenant_id IS NOT NULL` returns **0 rows** (tenant-a's clone invisible).
  - Tenant-b's `UPDATE` of tenant-a's clone by id affects **0 rows**; tenant-a's row is unchanged.
  - Tenant-b's `DELETE` of tenant-a's clone by id affects **0 rows**; the row still exists afterward.
- Ephemeral container torn down after verification (`docker rm -f`).

## 5. Live-gateway HTTP evidence (running Final-R0 stack)

Deployed the same migration to the live shared Postgres (port 45433) via the schema-owning `amacc`
role (`amacc_app` deliberately lacks `CREATE` on `public`), granted `amacc_app` table privileges on the
2 new tables, restarted `auth-service` with the new code, and exercised the following through the real
`api-gateway` (port 13100) using real logged-in JWTs (bcrypt password verification, no shortcuts):

| # | Scenario | Result |
|---|----------|--------|
| 1 | Positive: `GET /role-templates` as tenant-A ADMIN | **200**, 9 real global templates returned |
| 2 | Positive: `POST /role-templates` (bespoke create) | **201**, persisted `role_template` row |
| 3 | 401 no token | **401** `Missing or invalid Authorization header` |
| 4 | 403 unauthorized: ACCOUNTANT-only user (`iam.roletemplate.manage` not granted) attempts create | **403** `Missing permission: iam.roletemplate.manage` |
| 5 | Cross-tenant denial: tenant-B ADMIN fetches tenant-A's private template by id | **404** `Role template not found` (RLS makes the row invisible to tenant-B's query; the honest choice here is 404 not 403 — no existence is leaked to the wrong tenant, and this is the correct S207 outcome, not a workaround) |
| 6 | Validation failure: unknown permission key | **422** `UNKNOWN_PERMISSION` |
| 7 | Positive primary workflow: `POST /role-templates:apply` | **201**; verified via direct `psql`: real `Role` row created (`key='BILLER'`, exact permission set `{je.view, je.draft.create}` — nothing more, proving no privilege escalation), real `role_permission` projection, real `authz_role_assignment` projection, real `role_assignment` row, real `role_template_assignment` row |
| 8 | Segregation of duties: caller applies a template to their **own** userId | **403** `SELF_APPLY_FORBIDDEN` |
| 9 | Positive: `POST /role-templates/:id/clone` of a global template | **201**, clone's permissions exactly match the source's (`je.view`, `je.draft.create`) — confirms the defect fix holds live |
| 10 | Deactivate blocked while an `APPLIED` assignment exists | **409** `TEMPLATE_IN_USE` |
| 11 | Direct edit of the immutable global template | **403** `TEMPLATE_IMMUTABLE` |
| 12 | Revoke assignment, then deactivate | **204**, **204** — real underlying `role_assignment.status` verified `REVOKED` via `psql` |

**Real S007 audit evidence** — 5 `audit_outbox` rows for this session, all `published_at IS NOT NULL`
(drained to `audit_logs`): `role_template`/CREATE, `role_template_assignment`/APPLY,
`role_template`/CLONE, `role_template_assignment`/REVOKE, `role_template`/DEACTIVATE — all correctly
tenant-scoped to tenant-A, `actor_id` = the real acting admin's user id. (`hash_self` is `NULL` on
these rows exactly as it is on every other entity type already certified under S007 in this database —
the hash-chain fill is a separate async worker, not a per-row synchronous step at insert time; this is
consistent pre-existing behavior, not an S004A-specific gap.)

## 6. Test evidence

- `services/auth-service`: **154/154 tests pass** (118 pre-existing + 16 new
  `role-template-service.test.ts` + 20 new `role-template-routes.test.ts`), zero regressions.
- `role-template-service.test.ts` exercises `RoleTemplateService` against the **real `RoleService`**
  (not a mock), backed by an in-memory Prisma fake, so "applying a template never creates a parallel
  permission map" is actually proven at the unit level, not merely asserted: list/clone
  (independent-of-source-edits)/reject-immutable-edit/unknown-permission/duplicate-name/apply
  (real Role+projection+assignment+audit+event)/re-apply-reprojection (idempotency)/reject-inactive-
  apply/block-deactivate-while-applied/revoke-cascades-to-real-assignment/self-apply-SoD/privilege-
  escalation-proof/cross-tenant-listing-isolation/cross-tenant-getById-denial/field-mask
  resolver/`applyFieldMasks()` utility.
- `role-template-routes.test.ts` exercises the full HTTP contract (401/403/404/409/422/400/200/201/204)
  with a fake `RoleTemplateService` + fake `AuthzService`, matching the S206 `role-routes.test.ts`
  convention (real JWT verification via `authMiddleware`, no spoofable `x-user-id` header).
- `tsc --noEmit` clean on `services/auth-service` after all schema/service/route changes.

## 7. Known, explicitly-documented gaps (not fabricated as resolved)

- **BR4A-2 field-mask enforcement scope boundary:** no vehicle/inventory service exists anywhere in
  this repository, so end-to-end "vehicle.cost omitted from an actual domain payload" enforcement
  cannot be built against a real endpoint yet. `resolveFieldMasks()` / `applyFieldMasks()` are the real,
  tested mechanism a future consuming service would call; they are not wired into any live
  payload-serialization path today.
- **Pre-existing S206 architectural quirk (not introduced or fixed by S004A):** `role_permission.role`
  has no tenant scoping (a global text key). If two tenants both apply/create a custom role with the
  same key but different permission edits, the second write's projection would overwrite the first's on
  that shared global row (the `Role` rows themselves remain correctly tenant-scoped and isolated; only
  the S207 read-model row is shared). This is inherited from S206 and out of scope for S004A to fix.
- **Figma/UX validation** is still open per PO condition 9 — S004A is `FIGMA_REQUIRED` and no UI has
  been built without an approved artifact. This is the only remaining gap to full `DONE`.

## 8. Verdict

`S004A` moves from `NOT_STARTED` to **`DONE_PENDING_INTEGRATION`**: all technical, security, and
integration evidence (real S206/S207/S007 integration, no stub adapters, fresh-migration
reproducibility, cross-tenant RLS on all 4 verbs, full scenario matrix, zero test regressions) is
complete and live-gateway certified. It cannot reach full `DONE` until Figma/UX/business validation
completes, per PO condition 9.
