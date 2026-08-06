# S011 Certification Evidence — Analysis Codes / Dimensions

**Status:** `S011_INTEGRATED_TECHNICALLY_PENDING_COMBINED_DEMO_CERTIFICATION`
**Prior status (own-branch certification):** `TECHNICALLY_CERTIFIED_PENDING_INTEGRATION`
**Branch:** `r1-s011-analysis-codes` (base `r1-p01-neutral-base` @ `296ed34`) — **not merged, frozen**
**Integrated into:** `r1-integration` (R1 Controlled Integration, 2026-07-29) — selective cherry-pick of the S011-owned functional commits only; see `MODULE_STATE.json`'s S011 `stabilizationReconciliation`/`statusHistory` for the full integration record.
**Implementation commit:** `81f1ec1e349d693f3900ee6368962f077a73828d`
**P1 corrective-pass commit:** `e5c7ad6`
**Governed package:** `docs/accounting-modernization/build-packs/P01/`
**Date of technical certification:** 2026-07-28
**Date of P1 corrective pass:** 2026-07-29
**Date of scope-disposition update:** 2026-07-29
**Date of R1 controlled integration:** 2026-07-29

Per Product decision (2026-07-29), R1 S011 scope has been formally revised:
the user-facing GL Inquiry analysis-code filter (P1-F2) is **deferred out of
S011 scope** as a separate cross-service architecture decision — recorded as
`DEFERRED_BY_ACCEPTED_CROSS_SERVICE_ARCHITECTURE_DECISION`, not a residual
defect of this story and not an integration defect. See Section 17 for the
full disposition and `ARCH_FOLLOWUP_GL_INQUIRY_ANALYSIS_FILTER.md` for the
follow-up. This deferral was preserved as-is by the R1 controlled
integration: no GL Inquiry filter, duplicate GL Inquiry screen, or
cross-service lookup was added onto `r1-integration` either.

This document is the S011 evidence record referenced from
`docs/accounting-modernization/MODULE_STATE.json` (`r1P01Packages.P01.stories.S011`)
and `docs/accounting-modernization/stabilization/STORY_CERTIFICATION_MATRIX.csv`.
It exists to let a Product Owner and an Accounting SME independently verify —
and then explicitly accept or reject — the confirmed S011 slice, without
re-deriving the evidence themselves.

---

## 1. Accepted Scope

- Analysis-code **type** and **value** registry (tenant-wide dimensions,
  e.g. "Project", "Campaign"), deactivate-only lifecycle (no delete).
- Journal-line analysis tagging (0..N tags per line, one value per type,
  capped at `MAX_TAGS_PER_LINE = 3` — a **proposed default per BLK-13**,
  pending Product Owner ratification).
- Tag-reference validation at draft-post time (BR011-3): an unknown or
  inactive analysis-code value on any line rejects the post with
  `422 ANALYSIS_TAG_REJECTED / UNKNOWN_VALUE`, and **no partial journal is
  written**.
- `analysisValueId` filtering, additive (AND) with existing criteria, on
  both GL Search (`/inquiry/search`) and GL Inquiry
  (`/inquiry/accounts/:id/activity`).
- Dedicated `analysis.code.view` / `analysis.code.manage` permissions.
- Tenant isolation via PostgreSQL Row-Level Security (RLS).
- Audit-outbox evidence for type/value lifecycle events.
- A complete backend + frontend vertical slice (not a backend-only or
  API-only proof).

## 2. Explicitly Excluded Scope (not implemented)

- All **AMD-005**-dependent behavior (BLK-12 — accumulator-adjacent
  semantics gated behind SES-3; isolated so it does not block the rest of
  this slice).
- Automatic allocations.
- Undefined financial-statement grouping semantics.
- Invented posting behavior of any kind.
- Unrelated S008, S009, or S003 functionality.

## 3. Design Status

**Screen:** Analysis Code Registry (`P01-SCR-04`), route
`/accounting/admin/analysis-codes`.

**Classification: `BASELINE_PRODUCT_QUALITY`.** No exact Claude Design mock
for this screen was located in the P01 design source. Per governance
instruction, this is **not** claimed as Claude Design parity. The screen
reuses the certified Accounting UI Foundation V1 primitives (table, badge,
drawer, `PageLoader`/`PageError`/`EmptyState`) already established by the
S008 Period Control registry screen — the same visual language, not a
bespoke S011 mock.

**Screen:** JE Line Tag Control (`P01-SCR-05`), embedded within the existing
`/golden-path/journal` screen (no new route). Display-only extension of an
already-certified screen; no new visual pattern introduced.

Product visual acceptance is still required for: layout/navigation,
registry terminology, create/deactivate workflow, loading/empty/error/
unauthorized states, tag-picker usability, and Search/Inquiry filter
usability (see §8).

## 4. Schema & Migrations

| Migration | Service | Content |
|---|---|---|
| `20260728050000_add_analysis_codes` | coa-service | `AnalysisCodeType`, `AnalysisCodeValue`, `JournalLineAnalysisTag` tables |
| `20260728050001_add_rls_analysis_codes` | coa-service | `FORCE ROW LEVEL SECURITY` + 4 tenant-isolation policies + `amacc_rls_bypass` grant on all 3 new tables — follows the exact pattern of every other tenant-scoped table in this schema |
| `20260728050000_extend_authz_catalog_analysis_codes` | auth-service | Registers `analysis.code.view` / `analysis.code.manage` permissions (authz catalog v1.10.0) |

**Verified:** `prisma migrate deploy` applied cleanly for both services
against a freshly created, isolated PostgreSQL 15 instance (21 coa-service
migrations, 17 auth-service migrations, no errors).

`journal_line_analysis_tag` columns (confirmed via live `\d`): `id,
tenant_id, journal_line_id, type_id, value_id, created_at` — an additive
side table with FKs to `journal_line`, `analysis_code_type`,
`analysis_code_value`. **The certified `journal_line` schema/shape itself is
unchanged** (BLK-15 resolved: this is additive, not a breaking extension).

## 5. APIs

| Method | Path | Permission | Notes |
|---|---|---|---|
| `POST` | `/api/v1/coa/analysis/types` | `analysis.code.manage` | Create a type |
| `GET` | `/api/v1/coa/analysis/types` | `analysis.code.view` | List types + values |
| `POST` | `/api/v1/coa/analysis/types/:id/values` | `analysis.code.manage` | Create a value under a type |
| `GET` | `/api/v1/coa/inquiry/search` | `inquiry.search` (existing) | `analysisValueId` is an additive filter |
| `GET` | `/api/v1/coa/inquiry/accounts/:id/activity` | `inquiry.account.view` (existing) | `analysisValueId` is an additive filter |
| tags on draft lines | `POST /api/v1/coa/manual-journals/drafts`, `...:post` | `je.create`/`je.post` (existing) | `lines[].analysisTags[]`, validated at `:post` |

## 6. Permissions / RLS

- New permissions `analysis.code.view` and `analysis.code.manage`,
  registered via the auth-service authz catalog migration above.
- RLS **proven live** (not just reviewed) via raw `psql` sessions against
  `analysis_code_type` as the non-superuser `amacc_app` role with
  `app.current_tenant_id` set:
  - A cross-tenant `INSERT` (wrong tenant_id in the row vs. the session
    setting) was **rejected**.
  - A tenant-A session could **not** `SELECT` a tenant-B row, and vice
    versa.
  - The same policy pattern (4 policies: select/insert/update/delete,
    `FORCE ROW LEVEL SECURITY`) applies identically to
    `analysis_code_value` and `journal_line_analysis_tag`.

## 7. Audit Events

A real `audit_outbox` row was confirmed via direct query:
`ANALYSIS_CODE_TYPE / CREATED / dev-user / tenant-kunes`, published.

## 8. Frontend Routes & Screenshots

| Route | Screen |
|---|---|
| `/accounting/admin/analysis-codes` | Analysis Code Registry (P01-SCR-04) |
| `/golden-path/journal` | Journal line tag picker (P01-SCR-05, embedded) |

Screenshots captured live against a real running stack (coa-service +
auth-service + api-gateway + vite dev server), persisted at
`docs/accounting-modernization/screenshots/s011/`:

| File | State |
|---|---|
| `s011-registry-loaded.png` | Loaded state — real `PROJECT`/`PRJ-100` data from a live POST |
| `s011-registry-expanded.png` | Expanded type row showing its values |
| `s011-registry-drawer-empty.png` | "New analysis code type" drawer, empty-form state |
| `s011-registry-unauthorized.png` | Dedicated Unauthorized state — a real 403 from the real authz-service, naming the missing `analysis.code.view` permission |
| `s011-registry-no-auth.png` | Unauthenticated redirect (no token at all) |

**Honest gap:** a genuine empty-tenant (zero analysis-code types) screenshot
was captured once during this session but was overwritten before it could
be persisted to the repository (a later Playwright run cleared the
`test-results/` output directory first). It is **not** included here. This
must be recaptured live during the Product/SME demonstration rather than
fabricated — the empty state itself was directly observed and behaves
correctly (a centered `EmptyState` panel: "No analysis code types yet" with
a "New type…" call to action), but no screenshot survives from this
session.

## 9. Test Totals

- coa-service unit/mocked suite: **348/348 passing**, 22 test files, 0
  failures, 0 unexpected skips (the pre-existing `tests/live-db/*` suite
  self-skips gracefully without `LIVE_DATABASE_URL`, by design).
- Live-DB suite (`tests/live-db/posting-live.test.ts`) against a real,
  freshly migrated, isolated PostgreSQL 15 instance: **5/5 passing**.
- `apps/web`: `tsc --noEmit` clean; `vite build` clean (pre-existing
  chunk-size warning only, unrelated to S011).

## 10. Playwright Results

New spec: `tests/e2e/s011-analysis-codes.spec.ts` — **3/3 passing**,
executed against a genuinely running stack (isolated Postgres/RabbitMQ,
coa-service, auth-service, api-gateway, vite dev server — all uniquely
named/ported to avoid colliding with other concurrent sessions on this
shared machine):

1. Authorized ADMIN sees the registry with real data, expands a type, and
   opens the New Type drawer.
2. A user with no matching role receives a real `403` from the real
   authz-service, surfaced as a dedicated Unauthorized state naming
   `analysis.code.view`.
3. No auth token at all redirects away from the protected route.

## 11. Live, Non-Mocked Verification Performed This Session

Beyond the automated suites above, the following was driven directly
against a real Postgres + real coa-service + real auth-service + (for some
steps) a real api-gateway, via authenticated HTTP calls with a genuinely
minted, correctly-signed JWT — not simulated or assumed:

- Full draft → post → journal flow with a real analysis tag: created a
  draft with a line-level `analysisTags` entry, posted it, and confirmed a
  real journal (`GJ-2026-07-000001`) was created. The persisted
  `journal_line_analysis_tag` row was independently confirmed via a `psql`
  join query (`journal_line_analysis_tag ⋈ journal_line ⋈ journal_entry`).
- **Negative proof (BR011-3):** a draft referencing a non-existent analysis
  value was rejected at post-time with `422 ANALYSIS_TAG_REJECTED /
  UNKNOWN_VALUE`.
- **GL Search filtering:** `GET /inquiry/search?startDate=...&endDate=...&analysisValueId=<real-value-id>`
  returned exactly the one real tagged line; the same query with a
  non-existent `analysisValueId` returned zero results.
- **GL Inquiry filtering:** `GET /inquiry/accounts/:id/activity?periodCode=2026-07&analysisValueId=<real-value-id>`
  returned the correctly filtered line with its `analysisTags` populated.
- **RLS**, as described in §6.
- **Audit**, as described in §7.

All temporary Docker containers (uniquely named `s011-verify-pg`,
`s011-verify-mq`) and service processes started for this verification were
torn down by exact PID/name after evidence capture; none were left running.

## 12. Fixture / Role Details (for reproducing this evidence)

- Tenant: `tenant-kunes`.
- `dev-user` — seeded (via existing auth-service migrations, not created ad
  hoc) with an `ADMIN` role assignment (`asgn-kunes-dev` →
  `role-kunes-admin`) for `tenant-kunes`. This is the identity used for all
  "authorized" evidence above.
- A synthetic `no-such-user` / role-less identity was used for the
  negative/unauthorized proofs — a real, deny-by-default `403
  NO_MATCHING_ROLE` from `auth-service`'s `/authz/check`, not a client-side
  simulation.
- Minimal manually-inserted SQL fixtures were required to exercise the
  draft/post flow on a fresh database: a fiscal calendar/period (`2026-07`,
  `OPEN`), a `GJ` journal source, and two `gl_account` rows (Cash/DR,
  Revenue/CR). **Note:** the repository's root `scripts/seed.ts` targets a
  stale/legacy schema (`gl_accounts`, plural) that does not match
  coa-service's actual table (`gl_account`, singular) and is **not**
  usable for this purpose as-is.
- Local dev startup requires `AMACC_JWT_SECRET` / `JWT_SECRET` /
  `ADMIN_API_KEY` in a local `.env` (gitignored, dev-only placeholders —
  never committed).

### Reproducing the demo locally (standard docker-compose stack)

```
docker compose up -d postgres rabbitmq auth-service coa-service api-gateway web
# web:        http://localhost:5174/amacc/accounting/admin/analysis-codes
# api-gateway: http://localhost:3100
# auth-service: http://localhost:3001
# coa-service:  http://localhost:3016
```

Log in via `/golden-path/login` with a seeded Golden Path identity for
`tenant-kunes`, then navigate to **Admin → Analysis Codes** in the left
nav, or directly to `/accounting/admin/analysis-codes`.

## 13. Product / Accounting SME Acceptance Questions

These are the open questions this technical certification cannot answer on
its own — Product/SME judgment is required:

1. **Terminology:** Is "Analysis Code" / "Type" / "Value" the correct,
   final terminology for dealership controllers, or should this be
   relabeled (e.g. "Dimension" / "Tag Category" / "Tag")?
2. **Deactivate-only lifecycle:** Is it acceptable that types/values can
   never be deleted, only deactivated — matching the existing
   Department/Store registry convention? Is a reactivate path needed?
3. **Tag cap (BLK-13):** Is `3` tags per journal line the right limit, or
   should this be configurable per tenant/source?
4. **Required-per-source tagging (BLK-14):** Tags are currently
   **optional on every line, for every journal source**, with no
   mechanism to make them mandatory. Is this the intended final behavior,
   or should certain sources (e.g. Warranty Remittances, Service ROs) be
   able to require a tag before posting?
5. **Search/Inquiry filtering:** Does filtering GL Search/Inquiry by a
   single `analysisValueId` meet Accounting's actual reporting needs, or
   is multi-value/AND-vs-OR filtering expected in a later iteration?
6. **AMD-005 boundary (BLK-12):** Does the Accounting SME agree that
   accumulator-adjacent behavior (SES-3) is genuinely separable from this
   confirmed slice, with no hidden dependency?
7. **Registry screen quality:** Given the `BASELINE_PRODUCT_QUALITY`
   classification (no bespoke design mock), is the reused Foundation V1
   presentation acceptable for this screen, or does it need a dedicated
   design pass before promotion?

## 14. References

- Migrations: `services/coa-service/prisma/migrations/20260728050000_add_analysis_codes/`,
  `.../20260728050001_add_rls_analysis_codes/`,
  `services/auth-service/prisma/migrations/20260728050000_extend_authz_catalog_analysis_codes/`.
- Tests: `services/coa-service/tests/analysis-code.test.ts`,
  `analysis-code-service.test.ts`, `draft.test.ts`, `gl-search.test.ts`,
  `gl-inquiry.test.ts`, `post.test.ts`, `validate.test.ts`,
  `tests/live-db/posting-live.test.ts`.
- Playwright: `tests/e2e/s011-analysis-codes.spec.ts`,
  `tests/e2e/s011-p1-validate-post-consistency.spec.ts` (P1-F1).
- RLS: `services/coa-service/prisma/migrations/20260728050001_add_rls_analysis_codes/migration.sql`.
- Audit: `audit_outbox` table (see `packages/shared-kernel` audit-outbox
  drainer for delivery mechanics, unchanged by this story).
- Tracking: `docs/accounting-modernization/MODULE_STATE.json`
  (`r1P01Packages.P01.stories.S011`),
  `docs/accounting-modernization/stabilization/STORY_CERTIFICATION_MATRIX.csv`,
  `docs/accounting-modernization/build-packs/P01/P01_STORY_READINESS_MATRIX.csv`,
  `P01_TRACEABILITY.csv`, `P01_STORY_BLOCKING_REGISTER.csv`,
  `P01_SCREEN_INVENTORY.csv`.
- Architecture follow-up (GL Inquiry analysis-code filter, deferred out of
  S011): `docs/accounting-modernization/build-packs/P01/ARCH_FOLLOWUP_GL_INQUIRY_ANALYSIS_FILTER.md`.

## 15. Process-Safety Incident (disclosed)

During live verification this session, a `pkill -f 'tsx src/index.ts'`
command — intended only to restart this session's own auth-service/
coa-service processes — pattern-matched and terminated an **unrelated
sibling session's (`r1-s003`) backend process** as collateral damage. This
violated the rule against name-pattern-based process termination on a
shared machine. It does not invalidate any technical evidence in this
document (all evidence was independently re-verified after the incident
using exact-PID process management only). No further pattern-based kills
were used for the remainder of this session; all process management used
`kill <exact PID>`, verified working directory, and verified command line
before termination. This is recorded here as a standing reminder for future
sessions on this shared repository.

## 16. P1 Corrective Pass (2026-07-29)

An independent read-only review of the technically-certified S011 slice found
two verified P1 defects. This section records the corrective pass honestly,
including one item that was **fixed** and one that was **correctly identified
and escalated, not fixed**, per the task's own explicit stop-condition.

### 16.1 P1-F1 — Validate/Post consistency (FIXED)

**Defect:** `DraftService.validate()` never evaluated `analysisTags` — only
`PostingService.post()` called `validateLineTags()`. A draft with an unknown,
inactive, or over-cap tag could pass Validate and only fail later, at Post.

**Fix:** `services/coa-service/src/application/draft-service.ts` — `validate()`
now:
1. takes a new `AnalysisCodeService` constructor dependency (5th positional
   arg: `(prisma, events, posting, config, analysisCodes)`),
2. maps `analysisTags` into the `PostingLineInput[]` used for validation
   (previously omitted),
3. loads the tenant's active analysis-code type/value context via
   `analysisCodes.loadValidationContext(tenantId)`,
4. calls the **same** `validateLineTags()` (from
   `services/coa-service/src/domain/analysis-code.ts`) that `PostingService.post()`
   already used, and
5. merges any tag violations into `ValidationResult.errors`, so
   `pass = evaluator.pass && tagViolations.length === 0`.

Tags are still never read by the balancing evaluator itself (BR011-3 is
unchanged: analysis tags do not affect debit/credit balancing). Optional-by-
default tagging and the `MAX_TAGS_PER_LINE = 3` default are both unchanged —
this is a consistency fix only, not a rule change.

**Regression coverage added** (`services/coa-service/tests/validate.test.ts`,
new `describe('P1-F1 — Validate/Post analysis-tag consistency')` block, 7
tests):
1. valid tags pass both Validate and Post,
2. an inactive tag fails Validate (`INACTIVE_VALUE`),
3. an unknown tag fails Validate (`UNKNOWN_VALUE`),
4. more than 3 tags on one line fails Validate (`TAG_CAP_EXCEEDED`),
5. a draft that passes Validate with unchanged tag data also passes the
   tag portion of Post (no later, surprise Post-only rejection),
6. (bonus) an unknown analysis-code type fails Validate,
7. (bonus) duplicate-type-on-line fails Validate.

DI-only updates (no behavior change) were required in
`services/coa-service/tests/draft.test.ts` and
`services/coa-service/tests/void.test.ts` to register the new
`AnalysisCodeService` fake for the now-5-argument `DraftService` constructor.

**Live-database proof** (`services/coa-service/tests/live-db/posting-live.test.ts`,
new `describe('Live database - P1-F1 Validate/Post analysis-tag consistency')`
block, 3 tests, run against a real, isolated PostgreSQL 15 instance with all
coa-service + auth-service migrations applied): a real active tag passes
Validate+Post; a real DB-backed inactive tag (`is_active=false`) fails
Validate; a real unknown tag fails Validate.

**Real end-to-end gateway proof** (auth-service + coa-service + api-gateway,
isolated ports, real JWT, real Postgres — not mocked): a draft line tagged
with an analysis value that was ACTIVE at tag time, then deactivated via the
real `POST /analysis/types/:typeId/values/:id/deactivate` endpoint before
Validate ran, was rejected by **Validate** (`INACTIVE_VALUE`) and, on the
same unchanged data, also rejected by **Post** (`422 POST_VALIDATION_FAILED`).
A control draft with a valid, still-active tag passed Validate and Post
(`201`, journal `GJ-2026-07-000001`), and the tag row was confirmed persisted
in `journal_line_analysis_tag` via a direct `psql` query.

**Real, browser-level Playwright proof**
(`tests/e2e/s011-p1-validate-post-consistency.spec.ts`, new spec, 1/1
passing): drives the real `/golden-path/journal` screen (`JournalWorkflow.tsx`)
against the same real, isolated stack — creates a fresh analysis type/value,
tags a line through the real tag-picker UI, saves the draft, deactivates the
value via a real API call (a legitimate deactivate-only lifecycle action),
clicks the real **Validate** button, and asserts the on-screen validation
error list shows the inactive-value rejection (not a client-side simulation).
Screenshot: `docs/accounting-modernization/screenshots/s011/s011-p1-validate-rejected-inactive-tag.png`.
`tenant-service` (store/entity master data, an out-of-scope bounded context)
was stubbed via Playwright route interception for the unrelated store
dropdown only — the analysis-tag validation path under test always hit the
real coa-service.

**Test totals for P1-F1:**
- coa-service mocked suite: **355/355 passing** (22 files; the live-db file
  self-skips without `LIVE_DATABASE_URL`), up from 348 pre-P1 (+7 new).
- coa-service live-db suite: **8/8 passing** (5 original + 3 new), against a
  real isolated Postgres.
- `tsc --noEmit`: clean for `services/coa-service` and `apps/web`.
- Playwright: new spec **1/1 passing**; existing
  `tests/e2e/s011-analysis-codes.spec.ts` re-run **3/3 passing** (no
  regression from the `DraftService` constructor change).

### 16.2 P1-F2 — GL Inquiry frontend filter (NOT FIXED — architecture conflict, escalated per the task's own stop-condition)

**Defect as reported:** coa-service supports `analysisValueId` filtering on
`GET /inquiry/accounts/:id/activity`, but no real user-facing "GL Inquiry"
screen has a control wired to it.

**Investigation finding — genuine cross-service ownership conflict:**
- The only two real, user-facing screens named/routed as GL Inquiry —
  `apps/web/src/pages/accounting/GLInquiry.tsx` (route
  `/accounting/inquiry/gl`) and `apps/web/src/pages/GLAccountInquiry.tsx`
  (route `/gl/accounts/:code/inquiry`) — both call
  `glApi.getAccountInquiry()`, which the gateway routes under the
  `/api/v1/gl` prefix to **gl-service** (`services/api-gateway/src/index.ts`
  `SERVICES` table), a **separate microservice with its own database**.
  `grep` across gl-service's Prisma schema and source confirms **zero**
  `AnalysisCode`/`analysisTag` concept exists there.
- `docs/accounting-modernization/build-packs/P01/P01_REPOSITORY_VERIFICATION_RECONCILIATION.md`
  independently documents that Golden R0's S220/S221/S222/S227 (GL Inquiry
  and related screens) already run on gl-service — confirming this is a
  pre-existing, intentional service boundary, not an accident of this task.
- The **only** coa-service-backed inquiry capability is
  `GET /inquiry/accounts/:id/activity` (client: `getAccountActivity` in
  `apps/web/src/api/client.ts`), which is used **exclusively as a
  drill-through modal inside `TrialBalance.tsx` (S222)** — it is not exposed
  as its own standalone, searchable "GL Inquiry" screen a user can navigate
  to and filter directly.

Wiring the requested Analysis Code filter into the real, user-facing GL
Inquiry screens would therefore require either (a) a cross-service join the
architecture does not support today (gl-service has no analysis-code data to
filter by), or (b) building a second, duplicate GL Inquiry path against
coa-service's drill-through endpoint — both of which the task explicitly
prohibits ("no fake frontend-only filtering", "no duplicate GL Inquiry
implementation", and the explicit instruction to **stop and report** rather
than build a second inquiry path when this exact conflict is found).

**Disposition:** P1-F2 is **not implemented**. It is escalated as a genuine
architecture-ownership conflict requiring a Product/Engineering decision on
which service should own analysis-code-filterable GL inquiry (e.g.,
replicating/joining analysis-tag data into gl-service, or promoting the
coa-service drill-through into its own standalone, filterable screen). No
screenshots exist for "GL Inquiry without filter / filter selected / filtered
results / empty filtered results / unauthorized state" because no such
control was built — recording this honestly rather than fabricating
evidence.

**Consequence for overall status (superseded — see Section 17):** at the
time this section was first written, S011 status remained
`TECHNICALLY_CERTIFIED_PENDING_PRODUCT_SME_ACCEPTANCE` because the GL
Inquiry filter was still tracked as an open defect *against S011*. Product
subsequently made a formal scope-disposition decision (2026-07-29,
recorded in Section 17) that removes the GL Inquiry filter from S011 scope
entirely rather than leaving it open against this story — see Section 17
for the current, superseding status.

## 17. Formal Scope Disposition — GL Inquiry Filter Deferred (2026-07-29)

Product formally revised R1 S011 scope on 2026-07-29, in response to the
P1-F2 investigation in Section 16.2:

**Included in S011 (accepted, certified):**
- Analysis Code registry (type/value, deactivate-only lifecycle)
- Journal-line tagging
- Validate/Post tag-rule consistency (P1-F1)
- Inactive, unknown and over-cap tag rejection
- Optional-by-default tagging behavior
- Default maximum of three tags
- GL Search analysis-code filtering
- The existing coa-service-side backend inquiry-filter capability
  (`GET /inquiry/accounts/:id/activity`) — the endpoint itself remains part
  of S011's certified backend; only a user-facing GL Inquiry *screen*
  control consuming it is deferred (see below)

**Deferred out of S011 scope (not a residual defect of this story):**
- The user-facing GL Inquiry analysis-code filter — i.e., wiring an
  Analysis Code filter control into the real, gl-service-owned GL Inquiry
  screens (`GLInquiry.tsx`, `GLAccountInquiry.tsx`).

**Explicitly not authorized, now or in any future follow-up without a
dedicated architecture decision:**
- A duplicate GL Inquiry screen
- A frontend-only cross-service join
- A synchronous gl-service-to-coa-service lookup
- Copied analysis metadata without a defined ownership and reconciliation
  contract

**Follow-up:** a dedicated architecture document has been created —
`docs/accounting-modernization/build-packs/P01/ARCH_FOLLOWUP_GL_INQUIRY_ANALYSIS_FILTER.md`
— covering metadata ownership, the event/projection contract, the
gl-service read model, backfill/reconciliation, tenant isolation, the
filter API, canonical route ownership, and end-to-end acceptance tests.
That document requires a joint Product/Engineering decision before any
implementation begins; it is intentionally **not** chartered as part of
S011.

**Resulting status:** with the GL Inquiry filter formally out of S011
scope (rather than an open defect within it) and P1-F1 fully fixed and
verified, S011's final status is:

**`TECHNICALLY_CERTIFIED_PENDING_INTEGRATION`**

The branch (`r1-s011-analysis-codes`) remains **frozen and not merged**.
Product/Accounting SME acceptance items recorded earlier in this document
(Section 12/13) remain outstanding and are unaffected by this scope
disposition.
