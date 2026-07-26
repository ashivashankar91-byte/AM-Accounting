# Test Execution Report

All commands below were actually executed in this environment (not claimed from documents). Working directory: `/Users/shivashankarangadi/Public/Projects/AM-Accounting`. No destructive database commands were run (no `migrate deploy`, `db push`, or `migrate reset`).

## Unit tests

| Service | Command | Result | Duration |
|---|---|---|---|
| tenant-service | `npx vitest run` (in `services/tenant-service`) | **150/150 passed**, 11 test files | 466ms |
| auth-service | `npx vitest run` (in `services/auth-service`) | **87/87 passed**, 7 test files | 342ms |
| coa-service | `npx vitest run` (in `services/coa-service`) | **205/205 passed**, 16 test files | 550ms |

All three counts **match MODULE_STATE.json's own most-recent completionEvidence claims exactly** (150 for tenant-service as of S204, 87 for auth-service as of S205, 205 for coa-service as of S219) — this is a genuine positive: the unit-test claims are accurate and reproducible, not fabricated.

**Caveat, confirmed by the run durations themselves**: 442 total tests across 34 files completing in under 1.5 seconds combined is only possible against a mocked/in-memory Prisma client, not a live PostgreSQL connection performing real I/O. No `DATABASE_URL` environment variable is configured in this shell, and no service `.env` file was found in any of the three service directories. These are genuine, well-written unit tests — but they are not integration tests, regardless of how MODULE_STATE.json's `completionEvidence.runtime` narrative strings describe "real PG" behavior (e.g., S213's "20 concurrent HTTP allocations -> 20 distinct (BR213-1 real PG)" claim is not corroborated by anything reproducible in this environment).

## Integration tests

**Not run — environmental blocker.** No `DATABASE_URL` is configured; a local Postgres process was found listening on a Unix socket (`pg_isready` reported `/tmp:5432 - accepting connections`), but its identity/ownership is unknown, and per project memory (`project_db_schema_management.md` — never run destructive per-service commands against a shared DB) this verification did not attempt to point any service at it. No test file in any of the three services requires a live DB connection (all use mocked Prisma clients per the unit-test finding above), so there is no separate "integration test suite" to run even if a DB were safely available.

## Browser E2E

**Not run — environmental blocker.** `playwright.config.ts` exists at repo root and Playwright is installed (`node_modules/.bin/playwright` present). However:
- The frontend dev server was not running (`curl http://localhost:5173` → connection refused / no response).
- Per `playwright.config.ts`'s own comment, "The frontend dev server must be running separately (npm run dev in apps/web)" before `npx playwright test` can do anything meaningful.
- Standing up the full stack (frontend + all backing services + a real DB) was out of scope for a non-destructive, read-only verification pass.
- Independent of runnability: only 5 of the needed specs exist at all (see `CARRY_FORWARD_WORK_VERIFICATION.md` §6) — 18 of 22 "done" stories have no E2E spec to run in the first place.

## TypeScript type checking

| Service | Command | Result |
|---|---|---|
| tenant-service | `npx tsc --noEmit` | **FAILED — exit code 2**, 2 errors: `department-service.ts:314` and `franchise-service.ts:249`, both `TS2322` (`Record<string, unknown>` not assignable to Prisma's `JsonNull \| InputJsonValue`) |
| auth-service | `npx tsc --noEmit` | **FAILED — exit code 2**, 2 errors: `role-service.ts:258` and `role-service.ts:330`, both `TS2345`/`TS2322` (`string \| null` not assignable to `string`) |
| coa-service | `npx tsc --noEmit` | **FAILED — exit code 2**, 9 errors, all `TS2339` (`Property 'user' does not exist on type 'FastifyRequest<...>'`), across `config-routes.ts`, `draft-routes.ts`, `fiscal-routes.ts` (×2), `journal-routes.ts` (×4), `period-routes.ts` |

**All three services central to the 22 "done" stories fail TypeScript compilation.** This directly contradicts the "production-ready" bar CLAUDE.md sets ("Zero Tolerance: Every deliverable must be 100% correct and production-ready"). The coa-service errors are notable because they are all in the exact route files implementing the local authz-stub `requirePermission`-style middleware documented in `AUTHORIZATION_AND_AUDIT_VERIFICATION.md` — the stub authorization layer does not even type-check against Fastify's request type, meaning `request.user` is being accessed without the type augmentation that would normally declare it.

## Build

Not separately run beyond `tsc --noEmit` above — each service's `"build": "tsc"` script is the same compiler invocation and would fail identically (same exit code 2s) since it uses the same `tsconfig.json`.

## Lint

**Could not run.** Root `package.json` defines `"lint": "eslint . --ext .ts,.tsx"`, but no `eslint.config.js`/`.mjs`/`.cjs` exists anywhere in the repo, and the installed ESLint is v10.8.0, which **requires** the new flat-config format and refuses to fall back to a legacy `.eslintrc`. Running `npx eslint services/coa-service/src --ext .ts` immediately failed with: *"ESLint couldn't find an eslint.config.(js|mjs|cjs) file."* The lint script defined in `package.json` is currently non-functional for anyone who runs it.

## Migration validation

**Not run — environmental blocker, by design.** No `DATABASE_URL` is configured for any service. Consistent with the non-destructive constraint and existing project guidance against ad hoc schema operations against a possibly-shared database, this verification did not configure one or invoke `prisma migrate status`/`migrate diff`. All 22 stories' claimed migrations were instead verified by direct file-presence inspection (see `STORY_EVIDENCE_MATRIX.csv` — every claimed migration directory name exists under the relevant service's `prisma/migrations/`).

## Summary

| Check | Status |
|---|---|
| Unit tests (3 services, 442 tests) | ✅ PASS (but mocked, not integration-grade) |
| Integration tests | ⛔ Not run — no test exists that requires one; no DB configured |
| Browser E2E | ⛔ Not run — no dev server; also only 5/22 stories have specs at all |
| TypeScript typecheck (3 services) | ❌ FAIL — 13 real compile errors across all three services |
| Build | ❌ FAIL (same errors as typecheck) |
| Lint | ⛔ Cannot run — no ESLint config exists for the installed ESLint version |
| Migration validation | ⛔ Not run — no DB configured; verified by file presence instead |

Do not read the green unit-test row as "the code works in production." Every service that reports 100% unit-test pass also fails to compile.
