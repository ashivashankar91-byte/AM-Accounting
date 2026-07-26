# Build and TypeScript Report — Phase 2

Scope: the three core services behind the 22 R0 stories — `tenant-service`, `auth-service`, `coa-service`. No business behavior was removed to satisfy compilation; two of the thirteen fixes corrected a genuinely incorrect type signature/interaction pattern (documented below) rather than merely suppressing an error.

## Required gates

| Gate | Result |
|---|---|
| `tsc --noEmit` — tenant-service | ✅ PASS (was: 2 errors) |
| `tsc --noEmit` — auth-service | ✅ PASS (was: 2 errors) |
| `tsc --noEmit` — coa-service | ✅ PASS (was: 9 errors) |
| `npm run build:services` — tenant-service/auth-service/coa-service | ✅ PASS |
| Existing 442 unit tests continue to pass | ✅ 443/443 (442 pre-existing + 1 new regression test added for the role-service fix, see below) |
| No business behavior removed to satisfy compilation | ✅ confirmed per-error below |
| API contracts backward-compatible | ✅ no route, request, or response shape changed |

`npm run build:services` overall: **29 built, 1 failed (`fs-service`)**. `fs-service` is not one of the 22 R0 stories and is explicitly out of scope for this package (Phase 2 targets only the three core services) — its failure is pre-existing, unrelated, and left untouched, consistent with the Phase 0 scoping decision to leave non-R0 services alone.

## Per-error record

### coa-service (9 errors — single root cause)

| Field | Value |
|---|---|
| **Files** | `src/http/config-routes.ts:123`, `draft-routes.ts:166`, `fiscal-routes.ts:110,147`, `journal-routes.ts:132,149,150,175`, `period-routes.ts:122` |
| **Original error** | `TS2339: Property 'user' does not exist on type 'FastifyRequest<...>'` |
| **Root cause** | `authMiddleware` (packages/shared-kernel — intentionally framework-agnostic, typed as `request: any`) assigns `request.user = <JWTPayload>` at runtime, but no `.d.ts` anywhere declared this augmentation on Fastify's own `FastifyRequest` type. One existing file (`account-routes.ts`) worked around this by typing its permission-check helper's `request` parameter as `any`, which silently defeats type-checking rather than fixing it; the 9 failing files access `request.user` directly on a properly Fastify-typed request, which correctly triggered the compiler. |
| **Correction** | Added `services/coa-service/src/types/fastify.d.ts`: a single `declare module 'fastify' { interface FastifyRequest { user?: JWTPayload } }`, importing `JWTPayload` from `@amacc/shared-kernel` (the canonical definition already used by `authMiddleware`). The augmentation lives in `coa-service` (a Fastify-specific service), not in `shared-kernel`, preserving that package's deliberate framework-agnostic design. No runtime code changed. |
| **Test proving no regression** | Full `coa-service` suite (205 tests, 16 files) re-run after the change: unchanged, 205/205 pass. `tsc --noEmit` now 0 errors. |

### auth-service (2 errors — one root cause, one real logic bug found and fixed)

| Field | Value |
|---|---|
| **File** | `src/application/role-service.ts:258` (call site) and `:330` (inside `_projectAssignment`) |
| **Original error** | `TS2345`/`TS2322: Type 'string \| null' is not assignable to type 'string'` |
| **Root cause** | `_projectAssignment`'s signature declared `entityId: string` (non-nullable), but callers legitimately pass `entityId: string \| null` — `null` means "tenant-wide grant" per the `RoleAssignment.entityId` schema comment. Beyond the type mismatch, the method's *implementation* used `authzRoleAssignment.upsert()` keyed on a Prisma compound-unique constraint (`authz_assignment_unique`); Prisma's generated `CompoundUniqueInput` type requires **non-null** values for every key column, because PostgreSQL never treats `NULL = NULL` as a match inside a unique index. That means even if the type error had been silenced with a cast, the `upsert` would never have matched an existing null-`entityId`/null-`storeId` row at runtime — every re-projection of a tenant-wide or all-stores grant would have inserted a fresh duplicate row instead of upserting. This is a genuine latent idempotency bug, not just a type-checking nuisance (its sibling method, `_unprojectAssignment`, already correctly used a plain nullable-safe `where` filter instead of the compound-unique shortcut, which is why it never had this error). |
| **Correction** | Widened `_projectAssignment`'s signature to `entityId: string \| null` and replaced the compound-unique `upsert` with a `findFirst` (plain, nullable-safe filter matching `_unprojectAssignment`'s existing pattern) followed by a conditional `create`. This is behavior-**restoring**, not behavior-removing: the intended idempotent-projection guarantee now actually holds for tenant-wide/all-store grants, which it previously did not. |
| **Test proving no regression** | Existing 87 auth-service tests re-run and pass (mock's `authzRoleAssignment` Prisma stub extended with `findFirst`/`create` to match the new call shape — `upsert` mock left in place, now simply unused). **New regression test added** (`tests/role-service.test.ts`, "projects a tenant-wide (null entityId) assignment idempotently"): calls the now-nullable-safe `_projectAssignment` twice with `entityId: null` and asserts exactly one row results, directly proving the fixed bug stays fixed. Full suite: 88/88 pass (was 87; +1 new test). `tsc --noEmit` now 0 errors. |

### tenant-service (2 errors — identical root cause, two files)

| Field | Value |
|---|---|
| **Files** | `src/application/department-service.ts:314`, `src/application/franchise-service.ts:249` |
| **Original error** | `TS2322: Type 'Record<string, unknown>' is not assignable to type 'JsonNull \| InputJsonValue'` |
| **Root cause** | Both services' private `_writeOutbox` helper declared its `payload` parameter as the generic TypeScript utility type `Record<string, unknown>`, but Prisma's JSON-column insert type is the more specific `Prisma.InputJsonValue` (a recursive union of JSON-safe primitives/objects/arrays). `Record<string, unknown>` permits values (e.g. `undefined`, class instances, functions) that are not guaranteed JSON-serializable, so Prisma correctly refuses the overly-loose type — even though every actual call site already passes a plain, JSON-safe event-payload object. |
| **Correction** | Changed `payload`'s declared type to `Prisma.InputJsonValue` (imported from the same generated `.prisma/tenant-client` module already used for `PrismaClient`) in both files. This makes the parameter's type accurately describe what the column actually accepts; no call site needed any change because every existing caller already passes JSON-safe literal objects. |
| **Test proving no regression** | Full `tenant-service` suite (150 tests, 11 files, including `department.test.ts`/`department-routes.test.ts`/`department-isolation.test.ts` and the franchise equivalents, all of which exercise `_writeOutbox` indirectly via create/update/deactivate flows) re-run and pass unchanged: 150/150. `tsc --noEmit` now 0 errors. |

## Summary

| Service | Errors before | Errors after | Tests before | Tests after |
|---|---|---|---|---|
| tenant-service | 2 | 0 | 150/150 | 150/150 |
| auth-service | 2 | 0 | 87/87 | 88/88 (+1 regression test) |
| coa-service | 9 | 0 | 205/205 | 205/205 |
| **Total** | **13** | **0** | **442/442** | **443/443** |

Lint: not configured for this package's scope per instruction ("configure lint only when a supported configuration is already part of the repository standards; do not introduce a large unrelated tooling migration"). The repository has no `eslint.config.js` for the installed ESLint v10 (flat-config-only) — introducing one is a repository-wide tooling decision outside the 22-story scope and was not attempted here. This remains an open item, tracked in `R0_STABILIZATION_REPORT.md`, not silently resolved.

**Verdict: R0_BUILD_HEALTH_PASSED** for the three core services.
