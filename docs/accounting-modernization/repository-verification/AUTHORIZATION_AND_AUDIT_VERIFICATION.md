# Authorization (S207) and Audit (S007) Verification

## S207 — Permission Catalog & Check API

**Classification: PARTIALLY_WIRED**

Evidence (read directly from `services/auth-service/src/application/authz-service.ts`):

- **Real permission provider**: yes. `AuthzService.check()` is a genuine DB-backed implementation (Prisma `PrismaClient` injected via `tsyringe`), not a hardcoded map, for calls made *within auth-service*.
- **Deny-by-default**: confirmed by reading the code path, not by trusting MODULE_STATE's description.
  - Unknown permission key → `UnknownPermissionError` (400).
  - Invalid/escalated scope → deny + emit deny event.
  - Zero applicable roles → `DENY_REASON.NO_MATCHING_ROLE`, deny + emit.
  - Roles present but none grant the permission → deny + emit.
  - Allow is the *only* path requiring an explicit grant match. This is genuinely deny-by-default.
- **Route enforcement — real only inside auth-service.** `role-routes.ts` and `user-routes.ts` (S206/S205) call the real `AuthzService.check()` in-process (co-located, same DB transaction, confirmed by MODULE_STATE's own specDeviations and corroborated by reading `role-service.ts`/`user-service.ts` imports).
- **Route enforcement — NOT real everywhere else.** Every other consumer route file greps to its own **local static role→permission `Set` map**, not a call to the real engine:
  - `services/tenant-service/src/http/{legal-entity,store,department,franchise}-routes.ts` — each defines its own `ROLE_PERMISSIONS` constant with `ADMIN`/`CONTROLLER`/`ACCOUNTANT`/`SERVICE` keys.
  - `services/coa-service/src/http/{config,account,draft,fiscal,journal,period,seed,sequence,source}-routes.ts` — each defines its own local `ADMIN: new Set([...])` map.
  - None of these 13 route files import or call `AuthzService`/`/authz/check`. They implement the *shape* of deny-by-default (unlisted role → empty set → 403) but are **13 independently-maintained, duplicated stub implementations**, not the single gatekeeper S207 was built to be.
- **Service-level enforcement**: same finding — enforcement exists uniformly as per-route middleware, but it is the real engine in only 2 of 22 stories' route files (S205, S206).
- **Tenant and entity scope validation**: `Scope { tenantId, entityId?, storeId? }` is real in the engine; `_validateScope` denies a `storeId` without `entityId`, or any scope without `tenantId` (BR207-4). This part of S207 is genuinely implemented.
- **Field masking**: `maskedFieldsFor` is referenced only as a stub inside `journal-view-service.ts` (S217); grep found no dedicated masking rule table or catalog-driven mask logic anywhere. This is a named placeholder, not an implementation.
- **Development-auth bypasses**: no `NODE_ENV`-gated ADMIN-injection code was found in application logic (good — this specific claim in MODULE_STATE, "dev HTTP currently injects ADMIN," could not be located as literal code; it most likely refers to the dev harness that calls these APIs during manual runtime-transcript testing, not a code-level bypass committed to the repo). This is one claim we could **not** independently confirm either way — see `EVIDENCE_NOT_AVAILABLE` note below.
- **Unresolved AuthzPort stubs**: 13 local `ROLE_PERMISSIONS`/`ADMIN` stub maps, confirmed above, are exactly the "AuthzPort stub" MODULE_STATE describes needing to be swapped for real `/authz/check` calls.

**Bottom line**: S207 the *component* is real and well-built. S207 the *cross-cutting authority* MODULE_STATE claims ("one gatekeeper... the same way, everywhere") is **not actually wired to 20 of the 22 done stories**. Classifying the whole platform's authorization posture as "DONE" (as MODULE_STATE does for the S207 story itself) is not supported by the repository — PARTIALLY_WIRED is the accurate classification.

## S007 — Audit

**Classification: OUTBOX_ONLY** (for the 22 done stories) / **the pre-existing `audit-service` itself is a separate, more mature artifact not wired to any of them**

Evidence:

- There is **no `S007` entry in MODULE_STATE.json's `stories` object** — S007 has not been started as its own R0 deliverable in the current sprint of work. It appears only as a dependency name in `carryForwardIntegrations`/`stubGate` strings across 20 other stories.
- **`services/audit-service`** is a *pre-existing, git-tracked* service (10 tracked files, part of the original `7468ba5` initial commit — not part of the untracked S200-S219 batch). It has a real, working implementation:
  - `AuditService.log()` writes directly to a Postgres `auditLog` table (not an outbox).
  - `AuditService.getByEntity()` provides real read-back (an audit-history API), ordered, paginated to 200.
  - It is registered in `api-gateway` at `/api/v1/audit` → `audit-service:3031`, and in `docker-compose.yml`.
  - No hash-chain/integrity control was found (`grep -i "hash\|chain\|checksum"` near this code returned nothing) — any "hash-chain" language in Wave 1.2 documents is **aspirational, not implemented**.
- **None of the 22 new stories call this service.** Instead:
  - `auth-service` and `coa-service` each have their own local Prisma model `AuditOutboxEvent` (`@@map("audit_outbox")`) — confirmed present in both schemas, with an explicit schema comment: *"AuditPort stub outbox (S007 dependency). Every state change writes a record with before/after images; the real audit service consumes this table when S007 merges."* This is a direct, self-documented admission that these are write-only stub tables.
  - **`tenant-service` has no such table at all** — grep of its full `schema.prisma` found no `AuditOutboxEvent`/`audit_outbox` model. S200/S201/S203/S204 (all in tenant-service) therefore have **zero persisted audit trail of any kind**, contradicting MODULE_STATE's own carry-forward note that describes "swap[ping] the AuditPort stub (audit_outbox... tables)" for these exact stories — there is no stub to swap; there's nothing.
  - The one audit-adjacent endpoint in tenant-service, `GET /:id/audit` in `legal-entity-routes.ts`, makes a live HTTP call to `http://audit-service:3031/api/v1/audit/entity/LegalEntity/:id` and **silently returns `[]` on any error, including connection refused** — meaning in the current uncommitted/unwired state, this endpoint always returns an empty audit history with no visible failure.
  - No process anywhere in the repository (checked via repo-wide grep for consumer/subscriber/poller patterns) reads `audit_outbox` / `authz_outbox_events` / `coa_outbox_events` / `tenant_outbox_events` and forwards them into `audit-service`'s `auditLog` table. These tables are pure write sinks today.
- **Immutability**: no `UPDATE`/`DELETE` code path was found against `AuditOutboxEvent` or `auditLog` — rows are append-only in the code that exists, which is a genuine positive, but immutability of an unread table has limited practical value.
- **Write-path coverage**: partial — auth-service and coa-service application services do call their local audit-write helper on mutating operations (confirmed by the earlier grep hit list covering `role-service.ts`, `user-service.ts`, and all 9 coa-service application files); tenant-service application services have **no audit write calls at all** (grep for `audit`/`Audit` across `legal-entity-service.ts`, `department-service.ts`, `franchise-service.ts`, `store-service.ts` returned nothing).

**Bottom line**: S007 as an R0 backlog story has **not been started**. A separate, older, unrelated `audit-service` with real write+read logic exists but is disconnected from every one of the 22 "done" stories. The audit story that MODULE_STATE describes closing (an outbox-stub swap) doesn't even exist uniformly — tenant-service's four stories have no audit mechanism whatsoever, real or stub.
