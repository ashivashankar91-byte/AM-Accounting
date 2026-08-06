# S036B — Vendor Compliance Adapters: Certification Report

**Status: `S036B_TECHNICALLY_CERTIFIED_PENDING_INTEGRATION`**

Not integrated into r1-integration. Not a claim of S039 completion or full
Accounts Payable completion. Not a claim of external certification — only an
adapter boundary exists (see "What was NOT built" below).

## 1. Starting point

- Branch: `r1-s036b-vendor-compliance`
- Starting HEAD: `eb8c3f2282e29e5c533fba3298e99510a233988f` — "integrate(r1): move S036A apar-service migration step to run first"
- Working tree was clean, no git operation in progress, S036A vendor master (schema, migration, service, routes, permission catalogue) confirmed present before any S036B work began.

## 2. Authoritative contract (CORRECTED)

**Correction to the prior version of this report:** the earlier statement
"no standalone S036B story exists" conflated two different claims and was
too strong on one of them. Corrected:

- **S036B's story identity IS real and externally corroborated** — not
  invented by this session. It is *not* documented as a standalone ticket
  file anywhere in this repository (still true — see below), but it is
  independently referenced as a recognized, already-named entry in this
  program's working backlog by a **parallel session that ran before this
  one**: `/Users/shivashankarangadi/Public/Projects/AM-Accounting-r1-s038`
  implements a sibling story, **S038 — Vendor Insurance Certificate
  Management**, whose commits (`ff9a7ef` etc., 2026-07-30 01:01:18, authored
  by a different agent) are timestamped over 7 hours before this branch's own
  S036B commit (`fb852dd`, 2026-07-30 08:10:13) and explicitly reference
  "S036B" as a known, distinct future story:
  - `services/apar-service/src/application/insurance-certificate-service.ts:12-17`:
    *"S036B BOUNDARY: this service has no concept of 'verified'/'compliance
    status' — that belongs to S036B's external compliance-verification
    adapters ... Do not add verification fields or external-check calls
    here."*
  - `S038_VENDOR_INSURANCE_CERTIFICATION.md:26`: *"a future S036B
    compliance-verification adapter."*
  - `MODULE_STATE.md:10` (S038 worktree): *"Explicitly does not implement
    S036B's external compliance-verification concerns."*
- **Detailed acceptance criteria for S036B were not found anywhere** — this
  part of the original claim stands. Exhaustive search (this session plus an
  independent re-verification pass) covered `automate2-accounting-user-stories.json`,
  the BRD/PRD, `MODULE_STATE.md`, every `docs/accounting-modernization/build-packs/*`
  AP build pack, every `DECISION_REGISTER.md`, every `STORY_CERTIFICATION_MATRIX.csv`,
  across all ~21 sibling `AM-Accounting-r1-*` worktrees, plus `git log --all
  -S"S036B"` (pickaxe search across full history) — no file anywhere contains
  field-level or status-level acceptance criteria for S036B. Every session
  that has touched this program (S036A, S038, and this one) independently
  disclosed the same gap and treated its own task prompt + repo conventions
  as the operative contract in its absence.
- **What S038 does confirm, at the coarse-role level:** S036B = the external
  compliance-*verification* adapter boundary for vendors, distinct from
  S036A (vendor master identity/CRUD) and S038 (insurance-certificate
  *lifecycle*: create/renew/revoke, provider/dates, no verification status).
  This matches what was built here: a `ManualComplianceAdapter` that never
  fabricates a "verified" outcome, with `VERIFIED`/`REJECTED`/`EXPIRED`
  reachable only through an explicit human review action — not through any
  adapter.

The contract actually implemented was assembled from:
- The S036/S038 role-split above (externally corroborated, not this
  session's invention).
- S036A's own migration comments, which explicitly left tax-ID verification
  unresolved pending "an approved encrypted-field platform mechanism."
- The BRD's architecture stance (`automate2-accounting-brd.md:753-764`):
  AMACC's role is an immutable audit trail; a compliance **rules engine** is
  explicitly out of scope, delegated to an external platform. This supports
  building an **adapter boundary**, not a rules engine.
- The CH04 task prompt itself, which enumerated candidate capabilities and
  the truthful-status vocabulary (`NOT_CONFIGURED` / `PENDING_REVIEW` /
  `VERIFICATION_UNAVAILABLE`).

**No external certification is claimed.** Everything below is either
independently verified in this session (tests, live Postgres, migration
replay, TypeScript, build, and — as of this closure pass — a live browser
run) or explicitly marked as a provisional assumption pending product
confirmation.

**Discovered but not integrated:** a pre-existing, generic `compliance-service`
(from the repo's initial commit) with `ComplianceRule`/`ComplianceAlert`
models and a computed `COMPLIANCE`/`WARNING`/`NON_COMPLIANT` status rule. It
is entity-agnostic (keyed by `entityType`/`entityId`), unrelated to vendor
identity, and its status computation is exactly the kind of invented policy
this slice deliberately avoided. Wiring vendor-compliance events into it
would be a reasonable follow-up but was not attempted — it isn't part of any
accepted contract and would require deciding what its severity/threshold
rules mean, which is a product decision, not an engineering one.

**Integration-time collision, disclosed not fixed:** this branch and the
independent S038 branch were both authored on 2026-07-30 without visibility
into each other, and both:
1. Used the identical apar-service migration timestamp prefix
   `20260730000000` (`..._s036b_vendor_compliance_checks_apar_svc` here vs.
   `..._s038_vendor_insurance_certificates` there) — different folder
   suffixes so no filesystem collision, but the same class of ordering
   ambiguity S036A itself was renumbered for around S011/S032 (see commit
   `51fa30f`).
2. Both independently claimed **auth-service `catalog_version = '1.18.0'`**
   as "the next free slot after S036A's 1.17.0" — a real collision if both
   branches integrate as-is.

Per this task's explicit instructions (do not modify r1-integration, do not
touch another active stack), this is disclosed here for the integrator to
resolve — the same renumbering job already done once for S036A — and was not
"fixed" unilaterally on this branch, since a real fix requires coordinating
both branches' final integration order, not a change either branch can make
alone.

## 2a. Reconciliation table

| # | Requirement / capability | Implemented behavior | Evidence | Classification | Product confirmation needed |
|---|---|---|---|---|---|
| 1 | Compliance check type | `checkType` label enum: `TAX_ID_VERIFICATION` / `INSURANCE_CERTIFICATE` / `W9_VERIFICATION` / `GENERAL_COMPLIANCE_DOCUMENT` / `OTHER` — no logic keyed off the label | `schema.prisma`, migration CHECK constraint | CONSERVATIVE_PROVISIONAL | Whether `INSURANCE_CERTIFICATE` here should instead defer to S038's dedicated `vendor_insurance_certificates` table once a real adapter exists (see #9) |
| 2 | Compliance status vocabulary | `NOT_CONFIGURED` / `PENDING_REVIEW` / `VERIFICATION_UNAVAILABLE` / `VERIFIED` / `REJECTED` / `EXPIRED` | Migration CHECK constraint, service layer | ACCEPTED_MATCH | First three statuses are the CH04 prompt's own literal vocabulary; the review-only statuses are structural, not regulatory — none require confirmation |
| 3 | Manual review workflow | `review()` sets VERIFIED/REJECTED/EXPIRED; REJECTED requires a reason; only reachable by a human, never an adapter | `vendor-compliance-service.ts`, tests | ACCEPTED_MATCH | Matches CH04's "manual review and exception handling" bullet directly |
| 4 | External adapter boundary | `ComplianceVerificationAdapter` interface, DI-registered, swappable | `compliance-adapter.ts`, `index.ts` | ACCEPTED_MATCH | Directly corroborated by S038's own comment reserving this exact boundary for S036B |
| 5 | NOT_CONFIGURED truthful behavior | `ManualComplianceAdapter` always returns `NOT_CONFIGURED`, never fabricates success | `compliance-adapter.test.ts` | ACCEPTED_MATCH | CH04 prompt's literal instruction; no ambiguity |
| 6 | Evidence/reference fields | `externalReference`, `notes` | `schema.prisma` | CONSERVATIVE_PROVISIONAL | Field names/shape are an engineering default, not sourced from any spec |
| 7 | Effective/expiration dates | `expirationDate` only (no separate "effective date") | `schema.prisma` | PARTIAL | Whether an "effective date" distinct from expiration is required is unconfirmed — not implemented |
| 8 | Vendor-level compliance history | Individual check statuses only; no aggregate/rollup | `vendor-compliance-service.ts` (no aggregate method) | CONSERVATIVE_PROVISIONAL — deliberate, see §4 | Whether an aggregate "vendor compliance status" is wanted; deliberately not invented absent a defined rule |
| 9 | Insurance-certificate overlap with S038 | S036B's generic `INSURANCE_CERTIFICATE` checkType coexists with S038's dedicated `vendor_insurance_certificates` lifecycle table — no code sharing, no FK, no conflict, but conceptual overlap | Both branches' schemas | PARTIAL | Should a future real adapter read S038's table as its insurance data source instead of S036B's own generic record? Not decided; not a defect — both currently function independently |
| 10 | Permissions | `ap.vendor_compliance.{view,create,edit,run_verification,review}`, review restricted to ADMIN/CONTROLLER | auth-service migration, route tests | ACCEPTED_MATCH (pattern) — CONSERVATIVE_PROVISIONAL (exact keys) | Naming/grants follow the established `ap.vendor.*` precedent from S036A; not independently confirmed by any S036B-specific source |
| 11 | Audit | Compliance events reuse S036A's `docType: 'Vendor'` / `docId: vendorId` audit trail | `vendor-compliance-service.ts`, unit tests | ACCEPTED_MATCH (borrowed convention) | Architecture borrowed from S036A, not itself S036B business-accepted — flagged per this task's instruction not to over-classify borrowed architecture as accepted business behavior |
| 12 | Tenant isolation | RLS policies on `vendor_compliance_checks`, scoped identically to S036A's tables | Migration, live-Postgres RLS tests | ACCEPTED_MATCH (borrowed convention, non-negotiable platform rule) | Tenant isolation is a CLAUDE.md non-negotiable rule (#2), not a vendor-compliance-specific business decision — no confirmation needed |
| 13 | UI workflow | Compliance tab on existing Vendor Maintenance screen; add/run/review; loading/empty/error/unauthorized states | `VendorMaintenance.tsx`, this closure's live Playwright run (see §16) | ACCEPTED_MATCH | Verified live in the browser as of this closure pass |
| 14 | Real external provider | Not implemented — only the manual adapter | `compliance-adapter.ts` | OUTSIDE_SCOPE (explicit CH04 instruction) | None — explicitly prohibited by this task |
| 15 | Aggregate compliance rules | Not implemented | — | OUTSIDE_SCOPE (explicit CH04 instruction) | None — explicitly prohibited by this task |
| 16 | Delete endpoint for a compliance check | Not implemented | — | MISSING | Whether a correction/removal flow is required |

## 3. Capabilities implemented

- `VendorComplianceCheck` record per vendor: `checkType` (label only:
  `TAX_ID_VERIFICATION` / `INSURANCE_CERTIFICATE` / `W9_VERIFICATION` /
  `GENERAL_COMPLIANCE_DOCUMENT` / `OTHER`), `status`, `jurisdiction`,
  `country`, `externalReference`, `expirationDate`, `notes`.
- `ComplianceVerificationAdapter` interface + `ManualComplianceAdapter` —
  the only adapter shipped; always truthfully returns `NOT_CONFIGURED`,
  never a fabricated `VERIFIED`.
- Manual review workflow (`VERIFIED` / `REJECTED` / `EXPIRED`, with a
  required reason on `REJECTED`) — the only path that can set those statuses.
- Full audit: compliance events (`COMPLIANCE_CHECK_CREATED` /
  `_UPDATED` / `_VERIFICATION_RUN` / `_REVIEWED`) are written under the
  **same** `docType: 'Vendor'` / `docId: vendorId` as S036A's own vendor
  audit trail, so they appear in the existing Audit History tab — no second
  audit surface introduced.
- Tenant isolation + RLS on the new `vendor_compliance_checks` table.
- New `ap.vendor_compliance.{view,create,edit,run_verification,review}`
  permission keys, seeded and role-granted.
- Vendor-screen "Compliance" tab: add check, run verification, review,
  loading/empty/error/unauthorized states, truthful status badges.

## 4. Explicitly unresolved / out of scope (not invented)

- No real external verification provider — no adapter beyond
  `ManualComplianceAdapter` exists; a future story registers a different
  `ComplianceVerificationAdapter` implementation with no other code change.
- No aggregate "vendor is compliant" boolean/rule — only individual check
  statuses are exposed. Defining what "compliant" means was judged to be an
  invented policy, not an engineering default.
- `jurisdiction`/`country` are captured as data only — never evaluated
  against any rule.
- No delete endpoint for compliance checks this slice (create/update/review
  only) — remaining work if a correction/removal flow is later required.
- No change to S036A/legacy 1099, W-9, or tax-ID fields/behavior.
- **Update (this closure pass):** `tests/e2e/vendor-compliance.spec.ts` has
  now been executed live against a fully isolated, disposable Docker stack
  built from this branch's own code — see §16. This closes the one
  remaining-work item from the prior version of this report.

## 5. Production files

- `services/apar-service/prisma/schema.prisma` — `VendorComplianceCheck` model (additive)
- `services/apar-service/src/application/compliance-adapter.ts` — adapter interface + `ManualComplianceAdapter`
- `services/apar-service/src/application/vendor-compliance-service.ts` — domain/service layer
- `services/apar-service/src/http/routes.ts` — 6 new routes under `/vendors/:vendorId/compliance-checks`
- `services/apar-service/src/index.ts` — DI wiring (`ComplianceVerificationAdapter`, `VendorComplianceService`)
- `apps/web/src/api/client.ts` — `aparApi` compliance methods
- `apps/web/src/pages/accounting/VendorMaintenance.tsx` — Compliance tab, forms, review modal

## 6. Migrations

- `services/apar-service/prisma/migrations/20260730000000_s036b_vendor_compliance_checks_apar_svc/` — additive table + indexes + CHECK constraints
- `services/apar-service/prisma/migrations/20260730000001_add_rls_policies_vendor_compliance_apar_svc/` — RLS policies, scoped to the one new table
- `services/auth-service/prisma/migrations/20260730040000_extend_authz_catalog_s036b_vendor_compliance/` — catalog_version 1.18.0, 5 permission keys, role grants

## 7. Permissions

| Key | ADMIN | CONTROLLER | ACCOUNTANT |
|---|---|---|---|
| `ap.vendor_compliance.view` | ✅ | ✅ | ✅ |
| `ap.vendor_compliance.create` | ✅ | ✅ | ✅ |
| `ap.vendor_compliance.edit` | ✅ | ✅ | ✅ |
| `ap.vendor_compliance.run_verification` | ✅ | ✅ | ✅ |
| `ap.vendor_compliance.review` | ✅ | ✅ | ❌ |

`review` is ADMIN/CONTROLLER-only, mirroring `ap.vendor.inactivate`/`reactivate`.

## 8. Adapter design

`ComplianceVerificationAdapter` is a one-method interface
(`verify(request): Promise<{status, providerName, message}>`) registered in
the DI container as `ComplianceVerificationAdapter`. `ManualComplianceAdapter`
is the only implementation shipped, always returns `NOT_CONFIGURED`. It can
never return `VERIFIED` — that outcome is reachable only through
`VendorComplianceService.review()`, an explicit human action. A future real
provider adapter that cannot reach its backend must return
`VERIFICATION_UNAVAILABLE`, not silently fall back to a fake pass — this is
tested directly in `vendor-compliance-service.test.ts`.

## 8a. Isolated live-browser runtime topology (this closure pass)

Built and run entirely from this branch's own code, isolated from every
other active local stack (`amacc-s038-cert`, `am-accounting`, `s026s027cert2`,
`s046cert` were all confirmed running concurrently and untouched throughout):

- Docker Compose project: `amacc-s036b-cert` (unique project name, own
  network, own disposable named volumes — never referenced any other
  project's containers/volumes).
- Compose file: a standalone file outside the repo (this session's
  scratchpad, not committed — contains no secrets, only `${VAR:?required}`
  references), building images from `context:
  /Users/shivashankarangadi/Public/Projects/AM-Accounting-r1-s036b` — i.e.
  every image is built from this exact branch's current working tree, not a
  pulled/cached image from another worktree.
- Services: `postgres:15`, `rabbitmq:3-management-alpine`, and
  **current-branch** `auth-service`, `tenant-service`, `apar-service`,
  `audit-service`, `api-gateway`, `web` (all six built via each service's own
  `Dockerfile`, `context: .` = this branch). `audit-service` and
  `tenant-service` were included beyond the CH04 minimum ("current-branch
  apar-service, current-branch auth-service, current-branch frontend")
  because the journey's own requirements need them: audit-service backs the
  Audit History tab this journey verifies (§Gate 2 item 8), and tenant-service
  backs the login → `/select-entity` redirect the shared login helper waits
  on. `redis` and all other ~19 docker-compose.yml services (gl-service,
  eom-service, agents, etc.) were intentionally excluded — nothing in this
  journey touches them, and `@fastify/http-proxy` routes lazily (an absent
  upstream 502s only its own path, it does not block gateway startup or
  other routes).
- Host ports: `58001` (auth), `58002` (tenant), `58013` (apar), `58031`
  (audit), `58100` (gateway), `58174` (web), `58432` (postgres), `58672`/
  `58673` (rabbitmq) — an unused block, confirmed via `lsof`/`docker ps`
  against every other stack's allocated ports before starting.
- Secrets: `AMACC_JWT_SECRET`/`JWT_SECRET`/`ADMIN_API_KEY` generated with
  `openssl rand -hex`, exported as shell env vars for the compose invocation
  only, written to a file under this session's scratchpad (outside the git
  worktree) — never committed, never reused from any other stack's secrets.
- Seed data (minimum, created fresh, not reused): one tenant via
  tenant-service's `x-admin-api-key`-gated `POST /api/v1/tenants` (called
  with a short-lived internal JWT signed the same way
  `createServiceToken()` does in production code — not a bypass); one ADMIN
  user (`services/auth-service/scripts/bootstrap-admin.ts`, which grants
  every cataloged permission dynamically, so it picked up the new
  `ap.vendor_compliance.*` keys with no script change) and one no-grant user
  (`bootstrap-nogrant.ts`) via those existing, unmodified auth-service
  scripts. No vendor was pre-seeded — the journey itself creates one through
  the real UI, exactly like the S036A spec.
- Torn down completely after the run: `docker compose ... down -v` (removed
  containers, network, and named volumes) plus explicit image removal
  (`docker rmi`) — confirmed via `docker ps -a` and `docker volume ls`
  showing zero `amacc-s036b-cert*` resources afterward, and every other
  stack's containers still running unaffected.

## 9. S036A regression result

`services/apar-service`: 77/77 tests pass (`vendor-service.test.ts` 24,
`vendor-routes.test.ts` 18 — unchanged behavior, one fixture update to
register the new `VendorComplianceService` DI token). `apps/web`:
`VendorMaintenance.test.tsx` 22/22 pass unchanged. `services/auth-service`:
154/154 pass unchanged. Live-browser: `tests/e2e/vendor-master.spec.ts` run
against the same isolated stack — 2/2 passing (one transient failure on
first attempt, see §16's note on the pre-existing connection-pool RLS race;
passed on retry, and passed again on a second consecutive run).

## 10. S036B focused test totals

- `compliance-adapter.test.ts`: 3/3
- `vendor-compliance-service.test.ts`: 17/17
- `vendor-compliance-routes.test.ts`: 15/15
- Total new: 35/35 passing

## 11. Live PostgreSQL results

Two independent live-Postgres proofs this closure pass:

1. Ephemeral Postgres 16 cluster (`tests/integration/rls-live-db/setup.sh`),
   re-run fresh: apar-service's full migration history — including both
   S036B migrations — applied via `prisma migrate deploy` from empty.
   - `test-rls-isolation-apar-vendor.ts` (S036A regression): **9/9 passed**
   - `test-rls-isolation-apar-vendor-compliance.ts` (S036B, new): **9/9 passed**
2. The isolated E2E stack's own real Postgres 15 (§8a) — RLS-scoped
   `amacc_app` role enforced the same policies live under the browser
   journey itself (e.g. the `vendor_compliance_checks` INSERT/UPDATE the
   journey performs only ever affected the one seeded tenant).

## 12. Authorization and tenant-isolation results

Covered in `vendor-compliance-routes.test.ts` (15 tests: 401/403/404/409/422
envelopes, review restricted to ADMIN/CONTROLLER, tenant-mismatch 403) and
live-Postgres RLS tests above (insert/update/delete/select isolation,
deny-by-default with no tenant context, explicit bypass role verified).

## 13. Audit results

Verified via unit tests that `COMPLIANCE_CHECK_CREATED` and
`COMPLIANCE_CHECK_REVIEWED` are written to `audit_outbox` under
`docType: 'Vendor'` / `docId: vendorId`, confirming compliance events surface
in the existing S036A vendor audit-history endpoint without a second audit
surface. **Confirmed live this closure pass:** the browser journey's Audit
History tab, after a full page reload, displayed
`COMPLIANCE_CHECK_CREATED`, `COMPLIANCE_CHECK_VERIFICATION_RUN`, and
`COMPLIANCE_CHECK_REVIEWED` for the real check it created — i.e. the actual
AuditOutboxDrainer → audit-service delivery path, not a mock.

## 14. Migration replay result

- apar-service: applied cleanly from empty three separate times this
  program — the original RLS-harness bootstrap, a fresh re-run of that same
  harness this closure pass, and the isolated E2E stack's own fresh
  database (§8a) — all three via real `prisma migrate deploy`, all
  including both S036B migrations alongside the full S036A history.
- auth-service: applied cleanly from empty via a standalone `prisma migrate
  deploy` against a scratch database (`amacc_authsvc_replay`), AND again
  against the isolated E2E stack's fresh database — all 25 migrations
  including S036B's, `ap.vendor_compliance.*` permission rows and role
  grants confirmed present afterward (the E2E stack's bootstrap-admin script
  independently proved this by dynamically picking up all 5 new permission
  keys with zero script changes — 83 total permissions granted).
- tenant-service and audit-service: applied cleanly from empty as part of
  standing up the isolated E2E stack (§8a) — not previously exercised by
  this branch's own migrations (no schema changes in either), but proven
  compatible with S036B's additions alongside them in the same database.

## 15. TypeScript / build results

- `services/apar-service`: `tsc --noEmit` — 0 errors
- `services/auth-service`: no model changes; `tsc`-equivalent not applicable to a data-only migration; its own vitest suite (154/154) re-run clean after the testid change
- `apps/web`: `tsc --noEmit` — 0 errors; `npm run build` (production) — succeeded; `vitest run` — 41/41 (re-run after the testid + spec changes)

## 16. Playwright result — EXECUTED live this closure pass

`tests/e2e/vendor-compliance.spec.ts` run against the isolated stack in §8a:
**2/2 passing** (confirmed stable across two consecutive full runs).

Both required journeys proven live, through the real API, real Postgres, real JWT auth:
1. Full journey — open Vendor Maintenance → create a vendor → open Compliance
   tab (empty state) → add an Insurance Certificate check (Pending Review) →
   Run Verification (shows **Not Configured**, with the exact truthful
   "No external compliance verification provider is configured..." message
   — never a fabricated pass) → Review → Verified with a note → status badge
   updates, Run Verification/Review actions disappear (reviewed = final) →
   reload → Audit History shows all three real compliance events → zero
   unexpected console errors.
2. Unauthorized state — a user holding no `ap.vendor_compliance.*` grant
   sees the permission-denied UI state, not compliance data.

**Failures hit and how they were classified/resolved** (per this task's
required protocol):
- **Test issue** (fixed in the test): `page.getByRole('combobox')` in the
  Add Compliance Check modal matched 3 selects on the page (other vendor
  form fields remain mounted behind the modal overlay) — strict-mode
  violation. Fixed by adding `data-testid="compliance-check-type-select"`
  to that one `<select>` (a purely additive, non-behavioral production
  change, following the exact convention already used for
  `vendor-zip-input`/`vendor-dba-input`) and scoping the spec's locator to
  it.
- **Test issue** (fixed in the test): the shared `login()` helper (verbatim
  from S036A's own spec) waits for the URL to reach `/select-entity`, which
  briefly mounts `SelectEntity.tsx` and fires its own
  `listLegalEntities()` request; navigating away immediately after
  non-deterministically aborts that in-flight request. Reproduced a clean
  run with a standalone diagnostic spec proving it's timing-dependent, not
  consistent, and unrelated to any S036B code path. Filtered from the
  failed-requests assertion with an inline comment explaining why (same
  precedent as the pre-existing React Router warning filter already in the
  spec).
- **Environment issue, NOT a S036B defect** (not fixed, disclosed instead):
  `VendorService._nextVendorNumber()`'s `apVendorNumberCounter.upsert()`
  intermittently threw `new row violates row-level security policy for
  table "ap_vendor_number_counters"` on vendor creation. This is
  `services/apar-service/src/application/vendor-service.ts` — S036A's own
  code, untouched by this branch. Root cause: the same disclosed
  connection-pool/RLS-session-variable race already documented in
  `packages/shared-kernel/src/tenancy/rls-middleware.ts`'s own header
  comment and in `vendor-master.spec.ts`'s own docstring (a `SET
  app.current_tenant_id` on a pooled connection is not guaranteed atomic
  with the query that follows it on that same connection). **Proven
  pre-existing and independent of S036B**: re-running the unmodified,
  untouched `tests/e2e/vendor-master.spec.ts` (S036A's own spec) against
  the exact same isolated stack hit the identical failure on its first
  vendor-creation call, then passed cleanly on retry — conclusive evidence
  this is an inherited platform-level race, not something introduced here.
  Per this task's explicit instruction not to rewrite working production
  code without a proven defect (and this is a pre-existing, already-
  disclosed architectural gap, not one this branch caused), it was not
  "fixed" — the test was simply retried, per the task's own "rerun until
  passing" guidance for exactly this class of issue. Both specs then passed
  twice more in a row.

## 17. Final commit

See `git log -1` on this branch after this commit (evidence-only commit —
`docs(s036b): close scope and browser certification` — plus the
`data-testid` addition and the spec fix, both of which are test-support
changes bundled with the evidence commit, not a separate corrective commit,
since neither touches business logic).

## 18. Final git status

Clean working tree after commit (verify via `git status`).

## 19. Final verdict

**`S036B_TECHNICALLY_CERTIFIED_PENDING_INTEGRATION`.** All quality-gate
layers are independently verified live in this session: unit (35 new + 77
apar-service + 154 auth-service + 41 frontend), route/authz, live-Postgres
RLS (18, across two separate live databases), migration replay (both
services, three separate fresh-database runs), TypeScript, production
build, AND — closing the one gap from the prior version of this report —
live browser Playwright (2/2) against a fully isolated, disposable stack
built from this branch's own code. No material scope conflict was found
with S036B's externally-corroborated identity (§2); the still-open items
are genuine product-confirmation questions (§2a: effective dates, aggregate
compliance rollup, the S038 insurance-overlap question, exact permission
naming) — not implementation gaps — which is why this verdict is
`_PENDING_INTEGRATION`, not `_PENDING_PRODUCT_SCOPE_CONFIRMATION`: nothing
found contradicts what was built, only open refinements a product owner may
choose to layer on later.
