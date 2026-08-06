# S008 Integrated-Runtime — Fixture Seed Report

## Method (Phase 4 Option A + a narrowly-scoped Option B correction)

The accepted Golden R0 fixture identifiers (`docs/accounting-modernization/GOLDEN_R0_DEMONSTRATION_SCRIPT.md`, and hardcoded identically in `tests/e2e/golden-path.spec.ts`, `golden-path-negative.spec.ts`, `fiscal-period-close.spec.ts`) are not reproducible from a single existing "run this and get exactly this tenant UUID" script — no such script exists in the repository (confirmed by search). The tenant/legal-entity/user identities were originally bootstrapped once, by hand, over the course of many certification sessions on the long-lived Final-R0 stack, and have been reused ever since.

To seed them **deterministically** in this isolated instance without inventing new, non-accepted identifiers:

1. **Tenant row** (`1cf31f14-cb0b-4261-a41d-f79953594c86`, "Kunes Auto Group"): direct SQL `INSERT` into `tenant-service`'s `tenants` table. This is the one narrowly-scoped, test-fixture-only exception — the real `POST /api/v1/tenants` HTTP API does not accept a caller-supplied `id` (Prisma `@default(uuid())`, DTO has no `id` field), so there is no way to reproduce this *exact, already-accepted* UUID through the API. No production code was touched; no negative-authorization assertion is weakened by this (the tenant row's existence is a precondition of every test, not something any test asserts about).
2. **ADMIN user + role**: the repository's own existing, accepted `services/auth-service/scripts/bootstrap-admin.ts` (real application-layer `RoleService`/`UserService` calls, not raw SQL), invoked with `AMACC_TENANT_ID=1cf31f14-...`, `AMACC_ADMIN_EMAIL=admin@kunes-final-r0.test`, `AMACC_ADMIN_PASSWORD=FinalR0-Evidence-2026!` — the exact accepted identifiers, supplied as this existing tool's own documented parameters.
3. **Everything else — real HTTP API calls only, authenticated with the real ADMIN JWT the login endpoint issued**:
   - `POST /api/v1/legal-entities` → `KUNES-01` ("Kunes Auto Group - Store 01")
   - `POST /api/v1/fiscal/entities/:id/fiscal-calendar` → FY start month 1, TWELVE structure
   - `POST /api/v1/fiscal/entities/:id/fiscal-calendar/years` → fiscal year 2026 (12 FUTURE periods generated)
   - `POST /api/v1/stores` → store `01`
   - `POST /api/v1/coa/accounts` ×2 → `10001 Operating Checking` (ASSET/DR, postable) and `40001 Sales Revenue` (REVENUE/CR, postable) — `10001 Operating Checking` specifically because `golden-path.spec.ts` references that exact account by label
   - `POST /api/v1/coa/journal-sources/bootstrap-reserved` → 8 reserved journal sources (GJ, ADJ, YE, M13, PAY, SVC, PART, WARR)
   - `POST /api/v1/iam/roles` → `CLERK` role, with **exactly** the permission set the repository's own auth-service migration (`20260726000001_extend_authz_catalog_r0_stabilization`) grants to `CLERK` (`je.draft.create`/`je.draft.edit`/`je.draft.void`/`je.view`) — deliberately excludes every `fiscal.period.*` permission, preserving the negative-authorization assertion in both Playwright specs
   - `POST /api/v1/iam/users` → `clerk@kunes-final-r0.test`, then `POST /users/:id/reset` → `POST /users/:id/set-password` (`FinalR0-Evidence-2026!`) — the real reset-token flow, not a bypass
   - `POST /api/v1/iam/role-assignments` → grants CLERK the role tenant-wide (`allStores: true`) at the `KUNES-01` entity

All of the above (steps 3) are real, permission-gated production API calls — no bypass, no direct-SQL shortcut, no weakened check.

## What was deliberately NOT reproduced

`gl-service`'s Trial Balance/Balance Sheet/Income Statement evidence data for entity `01` `asOf 2026-02` — `golden-path.spec.ts`'s own header comment discloses this is "already-certified, pre-seeded evidence data... from the S014/S222/S227 backend certification sessions," accumulated incrementally across many prior sessions, not creatable from a single deterministic seed step. Reproducing it from scratch is exactly the "non-trivial re-seeding exercise" `PHASE4_FRESH_STACK_PLAYWRIGHT_EXCEPTION.md` already declined to force under time pressure — this pass follows that same established precedent rather than inventing a shortcut. See the Golden R0 Playwright results for the concrete, observed impact of this gap.

## Determinism

Every identifier above is either literally the accepted, previously-published fixture value, or (for the 4 net-new supporting records this isolated instance specifically needed — the store, the 2 accounts, the CLERK role) a fixed, hardcoded value chosen by this seed pass and recorded here — nothing was randomly generated.
