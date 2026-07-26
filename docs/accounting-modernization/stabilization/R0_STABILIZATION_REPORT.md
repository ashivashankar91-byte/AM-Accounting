# R0 Stabilization and Trust Closure — Final Report

Covers Phases 0-9 of the R0 Stabilization and Trust Closure Package, scoped strictly to the 22 already-implemented R0 stories (per the package's explicit exclusion of the 9 remaining R0 stories S004A, S007-as-final-user-facing-story, S014, S202, S220, S221, S222, S224, S227 — S007 provider integration itself was in scope and built; S224 Audit History UI was not).

## Phase verdicts

**R0_PHASE_1_2_CHECKPOINT_PASSED** — Baseline preserved (`8453d0f`), state reconciled against verified reality (`7089785`): S200/S201/S205/S207 statuses corrected in MODULE_STATE.json to match actual evidence, a deterministic `CURRENT_RELEASE.md` generator/checker added, 13 TypeScript errors fixed (coa-service + tenant-service missing `fastify.d.ts` types), a genuine idempotency bug in `role-service.ts` found and fixed (NULL-safe compound upsert).

**R0_AUTHORIZATION_CLOSURE_PASSED** — All 13 route files across tenant-service and coa-service centralized onto the real S207 `AuthzService` via a new `HttpAuthzClient`/`createAuthzGuard`, replacing local hardcoded `ROLE_PERMISSIONS` stub maps that ignored tenant scope entirely (a real security gap, closed). 20 new permission keys + role grants added, reconciling one genuine catalog gap (ACCOUNTANT + `je.post`). 70 new authz-guard-integration tests plus 4 updated cross-tenant test files.

**R0_AUDIT_BACKBONE_PASSED** — Real S007 audit-service connected via a poller (`AuditOutboxDrainer`) reading each service's local outbox table and forwarding over HTTP, since `RabbitMQEventPublisher.subscribe()` was found to be in-process-only (a pre-existing gap, not fixed here — see Phase 7). Idempotent delivery via a new unique `sourceEventId` column. tenant-service gained an audit mechanism where none existed before. audit-service gained its first test infrastructure.

**R0_TENANT_ISOLATION_PASSED** — PostgreSQL RLS implemented for real across 29 tenant-owned tables (originally 33; see Phase 9 correction below) in all 4 services, per ADR-001's design, proven against a real ephemeral Postgres instance (9 isolation tests + 5 live-DB tests). A constrained, auditable `amacc_rls_bypass` role for admin/migration use, proven unable to be invoked by the plain application role.

**R0_LIVE_DATABASE_INTEGRATION_PASSED** — Business-rule guarantees (atomic posting, idempotency, the deferred DR=CR constraint trigger, reversal linkage, 20-way concurrent numbering) proven against a real, disposable Postgres instance — not mocks. One genuine Prisma-layer finding disclosed: `$transaction(callback)` does not surface a COMMIT-time deferred-trigger error; worked around with raw `BEGIN`/`COMMIT` for that specific test, not silently patched over.

**R0_BROKER_INTEGRATION_PASSED** — Found and fixed a real gap: `RabbitMQEventPublisher.subscribe()` across all 4 in-scope services only ever registered in-process callbacks — no queue was ever declared or bound, so published messages to the real exchange were silently dropped. Fixed with real queue declaration, DLX/DLQ, and delivery-attempt-tracked retry. Proven with 10 tests using two independent AMQP connections against a real, isolated RabbitMQ instance.

**R0_FOUNDATION_E2E_PASSED (API layer) / BLOCKED (browser layer)** — See below; this is the phase where the first four phases' work had to run together, live, for the first time, and three additional severe bugs surfaced as a result.

## The real value of Phase 8: four bugs invisible to every prior phase's own tests

Every phase before 8 passed its own test suite. None of them ever booted all 4 services together and pushed one real transaction through the real gateway. Doing exactly that surfaced:

1. **RLS middleware infinite recursion (OOM crash)** — the middleware's own `set_config` raw query re-entered the same `$use` hook it was registered on. `tenant-service`, `auth-service`, `coa-service` all crashed with `FATAL ERROR: Reached heap limit` ~18-20s after boot — exactly when the Phase 4 drainer's first poll made the first real Prisma query. **Fixed** (`b399799`).
2. **`HttpAuthzClient` called the wrong URL path** (`/authz/check` vs. the real `/api/v1/authz/check`) — every real check 404'd, fail-closed. **Fixed** (`fb5535a`).
3. **`HttpAuthzClient` never sent `x-tenant-id`** — once RLS was live, auth-service's own role-assignment lookup saw zero rows and denied everything. **Fixed** (`fb5535a`).
4. **Audit-outbox drainer silently stopped delivering under RLS** — a background timer has no per-request tenant context, so its query always saw zero rows once RLS was live; audit records were written but never delivered. **Fixed** by excluding the 4 outbox tables from RLS enforcement (`3fcdab4`) — a genuine architecture decision, confirmed with the Product Owner before applying, not made unilaterally.

None of these were visible in 601 passing tests across Phases 3-7. That gap between "every piece individually proven" and "the whole thing actually works" is exactly what Phase 8 exists to close, and closing it is this package's single highest-value outcome.

## Golden path proven, real stack, real gateway

Legal entity → fiscal calendar → generate periods → open period → seed COA → bootstrap journal sources → post a journal (rejected on a real business rule, then succeeded) → view it → idempotent re-post proven → reverse it → cross-tenant view correctly denied → all 9 resulting audit-outbox rows confirmed delivered to audit-service with zero duplicates. Full detail: `E2E_FOUNDATION_REPORT.md`.

## Browser-level E2E: blocked, not fabricated

`tests/e2e/*.spec.ts` test routes (`/setup/legal-entities`) that exist only in `apps/web`'s substantial uncommitted, in-progress working-tree changes (23 modified files, 6 new untracked pages) — not at HEAD. An isolated git worktree at HEAD (the recommended strategy) confirmed the routes and pages genuinely don't exist at the last committed state. This is real frontend entanglement, not an infrastructure failure, and per instruction the API-level proof above stands in as the completed E2E foundation for this phase rather than a fabricated browser result.

## Commit history (branch `r0-stabilization-baseline`)

| SHA | Phase | Summary |
|---|---|---|
| `8453d0f` | 0 | Checkpoint: preserve 22-story implementation before stabilization |
| `7089785` | 1-2 | Reconcile state, restore build health |
| `d791a1a` | 3 | Centralize authorization through real S207 |
| `3275212` | 4 | Connect real S007 audit backbone |
| `209f00f` | 5-6 | Enforce and verify tenant isolation (RLS) |
| `391d01a` | 7 | Prove broker integration |
| `b399799` | 8 | Fix RLS middleware infinite recursion |
| `fb5535a` | 8 | Fix HttpAuthzClient URL path + tenant header |
| `3fcdab4` | 8 | Exclude outbox tables from RLS; E2E foundation report |
| *(pending)* | 9 | Certify 9 stories to DONE; STORY_CERTIFICATION_MATRIX.csv; this report |

## Test counts by layer (final, all green)

| Layer | Count |
|---|---|
| Unit tests (mocked Prisma), all 4 services + shared-kernel | 526 |
| Live-database tests (real, disposable Postgres) | 5 |
| RLS isolation tests (real Postgres, real roles) | 9 |
| Broker integration tests (real, isolated RabbitMQ, 2 connections) | 10 |
| `tsc --noEmit` errors across tenant/auth/coa/audit-service + shared-kernel | 0 |
| API-level golden-path steps (real gateway, Phase 8) | 13 |
| **Total automated assertions** | **550** (+ 13 manual golden-path steps) |

## Stories certified DONE (9 of 22)

S200, S207, S208, S209, S010, S212, S013, S217, S218 — each individually exercised via a real HTTP call through the live api-gateway → service → auth-service → RLS-enforced Postgres → audit-service chain. Full per-story evidence: `STORY_CERTIFICATION_MATRIX.csv`.

## Stories still DONE_PENDING_INTEGRATION (12 of 22)

S201, S203, S204, S206, S223, S210, S211, S213, S214, S215, S216, S219 — authorization is genuinely centralized through the real S207 engine for all of these (Phase 3), and the shared client/middleware bugs found and fixed in Phase 8 apply uniformly to every route using that shared code. But each story's own specific write path was not individually re-run against the live stack in this pass — conservatively not claimed as DONE without direct per-story evidence. Full per-story remaining-gap detail: `STORY_CERTIFICATION_MATRIX.csv`.

## Story still PARTIAL (1 of 22)

S205 (User Account Lifecycle) — unchanged; still missing a real login/session-issuance endpoint, a functional gap rather than only an integration gap. Explicitly out of scope for this package (part of the excluded 9-story FINAL-R0 set).

## Remaining stubs

None of the 22 stories' own business logic uses a stub authorization or audit path anymore — every route is wired through the real S207/S007 services (confirmed by `usesStubs: false` now set on all 9 promoted stories, and the shared client class being identical across every route regardless of promotion status). The 12 DONE_PENDING_INTEGRATION stories are not "stubbed" — they use the same real, fixed clients; they simply weren't each individually walked through the live stack in this pass.

Explicitly out-of-scope, unfixed stubs remain in ~17 other services (agent-apar, agent-eom, gl-service, eom-service, payroll-service, etc.) using the same `RabbitMQEventPublisher` class with the pre-Phase-7 in-process-only `subscribe()` behavior — not part of the 22 R0 stories, not touched.

## Remaining uncommitted files

- `apps/web/*` — 23 modified files + 6 new untracked pages, pre-existing, in-progress frontend work unrelated to backend stabilization. Not touched, per the standing Phase 0 entanglement exclusion (confirmed as the actual blocker for browser E2E in Phase 8).
- A pre-existing set of uncommitted files in `services/{apar,gl,eom,fs,payroll,recon,schedule}-service`, `services/api-gateway/nginx.conf`, `CLAUDE.md`, `MODULE_STATE.md` — present before this session started, outside the 22-story scope, not touched.
- Numerous untracked PDF/DOCX reference documents at the repo root — pre-existing, not created by this session, not touched.

## Exact blockers

1. **Frontend entanglement** blocks real browser-level E2E — resolved by whoever owns the in-progress `apps/web` work committing it, then a fresh browser E2E pass can run against the now-verified-correct backend.
2. **12 stories' specific write paths** were not individually re-run against the live stack — the remaining work is mechanical (repeat the Phase 8 golden-path pattern for store/department/franchise/role/config/account-hierarchy/draft/validate/direct-post/void), not a new bug class, since the shared client bugs are already fixed.
3. **S205's login/session gap** is a genuine functional gap (no real JWT-issuing endpoint anywhere in the system today — auth-service's `authMiddleware` auto-populates a dev-mode `ADMIN` identity when `NODE_ENV=development`), explicitly excluded from this package's scope.

## Ephemeral infrastructure

The ephemeral Postgres (`amacc_rls_test`, port 55439) and RabbitMQ (port 55672) instances used throughout Phases 5-9 remain running as of this report, since Phase 9's certification work was still actively using them. They are fully isolated (custom data/log directories under the session scratch path, non-default ports) and never touched the shared dev `amacc` database or the default RabbitMQ instance. Recommended: tear down after this report is reviewed, per the practice established in the original S200-audit precedent.

## Is the nine-story FINAL-R0 package safe to begin?

**Yes, with one explicit caveat.** The backend foundation (authorization, audit, tenant isolation, broker integration) is now genuinely real and proven end-to-end, not merely unit-tested in isolation — this is a materially stronger foundation than what existed before this package, and the four bugs found in Phase 8 would otherwise have surfaced as production incidents during or after the FINAL-R0 work rather than now. The caveat: S007's provider integration was built and proven in this package, but S007 as a fully complete user-facing story (and S224's Audit History UI specifically) remain excluded — the FINAL-R0 package should confirm its own scope boundary against that before starting. S205's login/session gap should also be sequenced early in FINAL-R0 if any of the 9 remaining stories depend on real user identity, since today only a `NODE_ENV=development` bypass exists.

**Overall verdict: R0_STABILIZATION_AND_TRUST_CLOSURE_PASSED.**
