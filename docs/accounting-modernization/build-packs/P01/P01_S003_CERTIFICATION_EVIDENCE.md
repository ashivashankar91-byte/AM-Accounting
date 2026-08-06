# P01-S003 — Elimination Entity Configuration: Certification Evidence Index

Status: TECHNICALLY_CERTIFIED_PENDING_INTEGRATION
Branch: `r1-s003-elimination-configuration`
Commits: `2f10f14` (full vertical slice), `b55ff49` (Product-directed reason-rule correction), plus the P1 corrective-pass commit recorded in Section 9 below
Do not merge. Do not promote past this status without recorded Product Owner + Accounting SME acceptance (see `P01_S003_DEMO_SCRIPT.md`).

**P1 corrective pass (this round):** an independent read-only review found two verified P1 defects — (F1) `configureElimination()`'s optimistic-concurrency check was read-then-update, not atomic, so two truly concurrent requests on the same version could both succeed; (F2) the reverse ownership guard did not cover every store/franchise ownership path, so a store or franchise could end up beneath an elimination entity via an inactive-store or re-parent (indirect) path. Both are now closed — see Section 9.

This document links every certification artifact to its exact source location so a reviewer does not need to re-derive evidence from commit messages.

## 1. Schema / migration evidence

| Item | Path |
|---|---|
| tenant-service schema change | `services/tenant-service/prisma/schema.prisma` (LegalEntity: `isEliminationEntity`, `eliminationReason`, `eliminationChangedAt`, `eliminationChangedBy`, `version`) |
| tenant-service migration | `services/tenant-service/prisma/migrations/20260728110000_add_legal_entity_elimination/migration.sql` |
| auth-service permission catalog migration | `services/auth-service/prisma/migrations/20260728120000_extend_authz_catalog_s003_elimination_entity/migration.sql` (adds `acct.entity.elimination_configure`, grants to ADMIN + CONTROLLER only) |

**Fresh-database proof (this certification round):** both migrations applied cleanly to a brand-new, disposable Postgres 15 cluster created via local `initdb`/`pg_ctl` (never the shared `amacc` dev database — same isolation pattern documented in `tests/integration/rls-live-db/setup.sh` and `docs/accounting-modernization/stabilization/LIVE_DATABASE_TEST_REPORT.md`):
- tenant-service: 10/10 migrations applied from empty, including the S003 migration.
- auth-service: 18/18 migrations applied from empty, including the S003 permission-catalog migration.

## 2. Service-layer / business-logic evidence

| Item | Path |
|---|---|
| Core logic | `services/tenant-service/src/application/legal-entity-service.ts` — `configureElimination()`. Guard order: version-conflict (409, now enforced via an atomic `updateMany` — see Section 9.1) → no-op (422 `NO_CHANGE`) → reason-required (422 `REASON_REQUIRED`, unconditional as of `b55ff49`) → OWNS_STORES (409) → transaction commit + audit write + outbox event |
| Reverse-direction guard | `services/tenant-service/src/application/store-service.ts` (direct), `services/tenant-service/src/application/franchise-service.ts` (direct + indirect, added in the P1 corrective pass), `services/tenant-service/src/application/org-service.ts` (re-parent paths, direct + indirect, added in the P1 corrective pass) — see Section 9.2 for full detail |
| Route | `services/tenant-service/src/http/legal-entity-routes.ts` — `PATCH /legal-entities/:id/elimination` |
| Org-tree annotation | `services/tenant-service/src/application/org-service.ts` — elimination badge flag surfaced on the hierarchy tree response |

## 3. Service test evidence (Vitest)

| Suite | Path | Result |
|---|---|---|
| Elimination service tests | `services/tenant-service/tests/legal-entity-elimination.test.ts` | 11/11 passing, incl. the corrected test proving reason is required unconditionally (even with `hasPostedJournals: false`), plus 2 new P1-F1 mocked concurrency tests (2-way race, stale-version rejection) |
| Authorization tests | `services/tenant-service/tests/legal-entity-authz.test.ts` | includes `acct.entity.elimination_configure` role-matrix cases |
| Store isolation tests | `services/tenant-service/tests/store.test.ts` | includes the reverse OWNS_STORES-style guard |
| Franchise tests | `services/tenant-service/tests/franchise.test.ts` | 18/18 passing, incl. 4 new P1-F2 reverse-guard tests (direct block, inactive-store-then-flagged block, indirect re-parent-override block, unrelated-entity positive control) |
| Franchise isolation tests | `services/tenant-service/tests/franchise-isolation.test.ts` | 8/8 passing, incl. 1 new test proving the elimination guard itself is tenant-scoped (ISO204-8) |
| Full suite | — | **198/198 passing** (14/14 files), tenant-service, re-run after the P1 corrective pass |
| Typecheck | — | `tsc --noEmit` clean for both tenant-service and auth-service |

## 4. Live gateway evidence (real JWT, real HTTP, ephemeral cert stack)

Executed against api-gateway → tenant-service → fresh Postgres, ports 14100/14002/14001 (chosen to avoid an unrelated live stack on the shared host occupying 13100/13002/13001):

| Scenario | Result |
|---|---|
| Authorized PATCH (ADMIN) | `200` |
| Unauthorized role (CLERK) | `403 NO_MATCHING_ROLE` |
| Cross-tenant entity id | `404` |
| Stale `version` (optimistic concurrency) | `409 VERSION_CONFLICT` |
| No-op (re-flag same value) | `422 NO_CHANGE` |
| Reason omitted, zero posted journals (corrected rule) | `422 REASON_REQUIRED` |
| Reverse OWNS_STORES (create store under eliminated entity) | `409` |

## 5. Audit evidence

`audit_outbox` table queried directly against the ephemeral cluster after the live gateway run. Confirmed persisted rows:
- `LegalEntity` / `CREATE`
- `LegalEntity` / `ELIMINATION_CHANGED` — before/after JSON payload includes `isEliminationEntity`, `eliminationReason` (verbatim reason text), `eliminationChangedBy` (actor from verified JWT), `eliminationChangedAt`.

## 6. Playwright evidence (real browser, not typecheck-only)

| Item | Path |
|---|---|
| Spec | `tests/e2e/elimination-entity.spec.ts` |
| Result | **5/5 passing**, executed with a real Chromium browser against the live cert stack (apps/web via `vite` on a dedicated port, `API_TARGET` pointed at the live gateway) |
| Scenarios covered | entity list/hierarchy load; happy-path flag with mandatory reason + resulting badge; OWNS_STORES guard; reverse-direction OWNS_STORES guard via direct API; unauthorized (CLERK) 403 |

Note: the spec's `API` constant is intentionally hardcoded to `http://localhost:13100` per the existing Golden Path e2e convention (see `golden-path.spec.ts`). During this certification round only, a local, uncommitted, temporary parameterization (`API_URL` env override) was used to point at the ephemeral cert gateway's alternate port; it was reverted before commit. The committed file is unchanged from the pre-certification version.

## 7. Frontend evidence

| Item | Path |
|---|---|
| Screen | `apps/web/src/pages/goldenpath/EntityElimination.tsx` — loading, empty, validation, error, and unauthorized states; reason field always rendered (post-correction) |
| Route registration | `apps/web/src/App.tsx` — `/golden-path/entity-elimination` |
| Org hierarchy badge | `apps/web/src/pages/goldenpath/OrgHierarchy.tsx` |
| API client | `apps/web/src/api/client.ts` |
| Production build | `vite build` succeeded (pre-existing chunk-size warning only, unrelated to S003) |

## 8. Screenshot / visual evidence

A screenshot of a configured elimination entity (badge visible) and its audit-history result was captured during the live certification round described above. That capture was written to a local, ephemeral filesystem path as part of the disposable certification environment and was not copied into the repository or into persistent session storage before the environment was torn down, so it is not currently attached to this evidence set.

**Reproduction:** the exact capture is reproducible on demand by re-running the certification procedure in Section 4 above and taking a screenshot of `/golden-path/entity-elimination` after a successful PATCH, plus the audit-history view. Because the live Product/SME demonstration (see `P01_S003_DEMO_SCRIPT.md`) will re-run this same live flow in front of reviewers, the recommendation is to capture the accepted screenshot **during that session** and attach it to the sign-off record at that time, rather than re-running the ephemeral stack solely to regenerate a documentation artifact.

## 9. P1 corrective pass evidence (this round)

### 9.1 P1-F1 — atomic optimistic concurrency

**Fix:** `services/tenant-service/src/application/legal-entity-service.ts` — `configureElimination()` no longer does a read-then-update. It performs a single conditional `tx.legalEntity.updateMany({ where: { id, tenantId, version: dto.version }, data: { ..., version: { increment: 1 } } })` inside the existing transaction; `count !== 1` throws `LegalEntityConflictError('VERSION_CONFLICT')` (409). Expected version and reason remain mandatory; version increments atomically as part of the same conditional write; tenant isolation (`tenantId` in the `where`) is preserved.

**Mocked proof:** `services/tenant-service/tests/legal-entity-elimination.test.ts` — 2-way mocked race (`Promise.allSettled`, exactly 1 fulfilled + 1 rejected `VERSION_CONFLICT`) and stale-version rejection, both passing.

**Genuine concurrent live-database proof (not mocked):** new suite `services/tenant-service/tests/live-db/elimination-guards-live.test.ts`, run against a real PostgreSQL 15 instance (fresh, isolated `amacc_live_test` database, all 10 tenant-service migrations applied clean):
- 2-way genuinely concurrent request (`Promise.allSettled` firing two real service calls against the same live connection pool, same expected version) → exactly 1 fulfilled, 1 rejected with real `VERSION_CONFLICT`; row's `version` column confirmed to have moved exactly `1 -> 2` (no lost update, no double-apply).
- 10-way genuinely concurrent race, same expected version → exactly 1 winner, 9 real 409 `VERSION_CONFLICT` rejections, row moves version `N -> N+1` exactly once.
- Stale caller (version already superseded by a real committed write) → real 409, write never applied.
- Mandatory version/reason enforcement re-verified against the real DB.
- **Result: 11/11 passing** (7 F1 + F2 live tests are combined in one file; see Section 9.2 for the F2 breakdown). Full log: `EXIT_LIVE:0`, `Test Files 1 passed (1)`, `Tests 11 passed (11)`.

### 9.2 P1-F2 — franchise reverse ownership guard

**Fix, three files:**
- `services/tenant-service/src/application/org-service.ts` — `reparent()`: STORE re-parent now rejects when the new parent `LegalEntity.isElimination` is true (direct); FRANCHISE re-parent now resolves the new parent store's *currently resolved* owning entity (via `_resolveCurrentParent`, which follows S202 re-parent overrides) and rejects if that entity `isElimination` is true (indirect).
- `services/tenant-service/src/application/franchise-service.ts` — `create()`: new private helper `_resolveStoreOwnerEntityId()` resolves the store's current owning entity (base FK, or the latest applicable `OrgReparentEvent` override) and rejects with `FranchiseConflictError('ELIMINATION_ENTITY_CANNOT_OWN_STORES')` (409) if that entity is an elimination entity — closing the gap where an INACTIVE store (which bypasses the entity's `OWNS_STORES` active-store count) could still receive a franchise after its entity was later flagged for elimination.
- `services/tenant-service/src/application/store-service.ts` — unchanged; its existing direct-path guard was already correct and is the precedent the other two now mirror.

**Mocked proof:** `services/tenant-service/tests/franchise.test.ts` (4 new tests: direct block, inactive-store-then-flagged block, indirect re-parent-override block, unrelated-entity positive control) and `tests/franchise-isolation.test.ts` (1 new test proving the guard is tenant-scoped). All passing.

**Genuine live-database proof:** `services/tenant-service/tests/live-db/elimination-guards-live.test.ts`, run against real Postgres:
- Direct: active store creation directly under an elimination entity → rejected.
- Direct: active store re-parent onto an elimination entity → rejected, no override row persisted.
- Indirect (the exact reported defect): store deactivated, its entity *later* flagged elimination, franchise creation on that store → rejected, no franchise row persisted.
- Indirect: franchise re-parent onto a store owned (indirectly) by a now-elimination entity → rejected.
- Indirect via S202 override chain: store legally re-parented once, then a second re-parent attempt onto an elimination entity → still rejected (guard consults the resolved current parent, not a stale base FK).
- Unrelated entities unaffected: normal entity → store → franchise creation → franchise re-parent, full path succeeds end to end.
- Tenant isolation intact: cross-tenant ids on franchise-create and store-reparent are rejected as not-found, not leaked across tenants.
- **Result: all 11 live-db tests passing** (combined with Section 9.1's F1 cases in the same run — see log above).

### 9.3 Frontend

No frontend changes were required. `EntityElimination.tsx` already surfaces `VERSION_CONFLICT` with a correct, user-facing message ("This entity changed since the page loaded — refresh and try again.") — the P1-F1 fix changes only the backend's concurrency guarantee, not the error code or response shape the frontend consumes. No screen in `apps/web` creates or re-parents stores/franchises (confirmed by search — `OrgHierarchy.tsx` is read-only), so P1-F2 has no frontend surface to update. Per the corrective-pass scope, the screen was not redesigned.

### 9.4 Regression check

Full tenant-service suite re-run after all P1 changes: **198/198 passing (14/14 files)**. `tsc --noEmit`: clean, exit 0. No pre-existing test was weakened to make it pass — the two tests whose fixed-value `entityFindFirst` overrides conflicted with the new atomic-write path were converted to use the shared mock's row state instead, preserving the same assertions.

## Exclusions (explicitly not implemented, not certified, not in scope for S003 v1)

- Automated elimination journal generation
- Entity-pairing workflow
- Consolidation calculations
- Intercompany balancing
- Posting-restriction configuration / enforcement
- Any period-close or reporting integration
