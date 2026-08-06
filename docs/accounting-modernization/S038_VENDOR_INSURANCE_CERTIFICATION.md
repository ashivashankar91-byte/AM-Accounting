# S038 — Vendor Insurance Certificate Management — Certification Report

**Status: S038_TECHNICALLY_CERTIFIED_PENDING_PRODUCT_SCOPE_CONFIRMATION**

Branch: `r1-s038-vendor-insurance` · Starting HEAD (this closure pass):
`ce440fc77c3218cead1a1d67001f10af97bc0b81` · Original implementation starting
HEAD: `eb8c3f2282e29e5c533fba3298e99510a233988f`

## CORRECTION to a prior claim in this document

An earlier pass of this document stated that "no standalone written 'S038'
backlog story file was found." That claim was **incomplete** and is corrected
here. `docs/accounting-modernization/AutoMate2_Accounting_Backlog_Package_v1.1.zip`
(present in this repository) contains a canonical backlog registry that
**does** include S038:

- `canonical_registry.json`: `"id": "S038", "title": "Vendor Insurance-Cert
  Tracking", "epic": ["CE-09"], "release": "R5", "level": [2]`; disposition
  `RETAINED`.
- `ACCOUNTING_MASTER_BACKLOG.md`: `S038 | Vendor Insurance-Cert Tracking |
  CE-09 | R5 | L2 | EXPANSION_PENDING`.
- `ACCOUNTING_JIRA_IMPORT.csv`: status `PROPOSED CANONICAL BACKLOG - PENDING PO
  APPROVAL. SUMMARY-LEVEL ROW (scope visibility). Full 88-field expansion at
  R5 wave (DoR gate). Canonical text: Canonical_Backlog_V2 sec 4. ESTIMATE:
  ENGINEERING_ESTIMATE_REQUIRED`; readiness `NOT READY - awaiting wave
  expansion`; DoD references the generic cross-story invariants (balanced-JE
  where applicable, append-only ledger, audit event visibility, authz via
  S207, OpenAPI, tests, demo, evidence) but **no S038-specific field list or
  acceptance criteria**.

The referenced `Canonical_Backlog_V2` section 4 (the document that would
contain the full 88-field expansion with concrete acceptance criteria) is
**not present** in this repository or any sibling worktree searched
(`AM-Accounting`, `AM-Accounting-r1-integration`,
`AM-Accounting-r1-s036a-vendor-master`, `AM-Accounting-r1-s036b`). No entry
for S038 was found in `OPEN_QUESTIONS_AND_DECISIONS.md` either. So: **S038 is
a confirmed, canonical, `RETAINED` backlog story — but its detailed field-
and-behavior acceptance criteria have never been expanded/approved.** This is
a materially different (and more precise) statement than the original "no
story exists" claim, though the practical consequence is the same: no
detailed, PO-approved acceptance criteria exist to check the implementation
against line-by-line.

## Scope and story-boundary discipline

Given the above, the originating task prompt's own explicit field/behavior
list — read together with the S036A vendor-master implementation it
explicitly says to reuse, and the repo-wide conventions for
lifecycle/RLS/audit/permissions — continues to be the most defensible
implemented contract. This is disclosed as an assumption, not hidden.

Implemented **only**:
- Vendor insurance-certificate records: create, view, limited in-place edit
  (non-defining fields only), renew/replace, revoke.
- Deterministic, computed (never stored) expiration status: `CURRENT` /
  `EXPIRING_SOON` / `EXPIRED`. `EXPIRING_SOON` only applies when the caller
  supplies `withinDays` — no invented default warning period.
- Historical preservation (no hard delete; `SUPERSEDED` / `REVOKED` rows kept).
- Tenant isolation, RLS, permission-gated routes, audit-outbox evidence.
- A read-only `getVendorInsuranceSummary()` integration point for a future
  S036B compliance-verification adapter.

Explicitly **not** implemented (confirmed absent by test assertions and code
review): external compliance verification, "verified"/compliance-status
fields, AP invoice entry, payment approval/blocking, tax reporting, vendor tax
validation, or any claim of complete AP functionality.

## Gate 1 — Scope reconciliation table

Detailed PO-approved acceptance criteria are unavailable (see correction
above). Every row below is therefore reasoned from the task's own explicit
field list, generic backlog DoD invariants, and existing repo conventions —
**not** from a story-specific approved spec. Per instruction, this is marked
`CONSERVATIVE_PROVISIONAL` rather than deleted or assumed `ACCEPTED_MATCH`.

| Requirement / behavior | Implemented behavior | Evidence | Classification | Corrective action / confirmation needed |
|---|---|---|---|---|
| Vendor linkage | `vendorId` FK to S036A `Vendor`, no second vendor table | `schema.prisma` `VendorInsuranceCertificate.vendorId` | CONSERVATIVE_PROVISIONAL | None — matches explicit "reuse S036A" instruction |
| Certificate/policy number | `policyNumber` string field, required | schema + create/update Zod schemas | CONSERVATIVE_PROVISIONAL | PO confirmation of format/uniqueness rules |
| Insurance provider | `provider` string field, required | schema | CONSERVATIVE_PROVISIONAL | PO confirmation if a controlled provider list is required |
| Insurance type | `insuranceType` enum (`GENERAL_LIABILITY`, `AUTO`, `WORKERS_COMP`, `UMBRELLA`, `OTHER`) | schema + duplicate-protection index | CONSERVATIVE_PROVISIONAL | PO confirmation of the exact type taxonomy — this list was not sourced from an approved spec |
| Effective date | `effectiveDate`, validated `< expirationDate` | service-layer validation + unit tests | CONSERVATIVE_PROVISIONAL | None — objectively necessary invariant |
| Expiration date | `expirationDate`, drives computed status | `computeExpirationStatus()` | CONSERVATIVE_PROVISIONAL | None — objectively necessary invariant |
| Coverage details/limits | **Not implemented** | — | OUTSIDE_SCOPE | Explicit product decision needed before adding — task said "do not invent coverage requirements/jurisdiction rules" |
| Document attachment/reference | Metadata-only (`documentId`/`documentFileName`/`documentMimeType`), no binary storage | schema + `document-service` pattern reuse | CONSERVATIVE_PROVISIONAL | PO confirmation once real object storage is in scope |
| Status lifecycle | `ACTIVE` → `SUPERSEDED` (via renew) / `REVOKED` (via revoke); no hard delete | schema `status` enum + service tests | CONSERVATIVE_PROVISIONAL | None — matches generic "audit event visibility"/append-only DoD invariant |
| Expiration warning | Computed only, `EXPIRING_SOON` requires caller-supplied `withinDays`; **no fixed default window invented** | `computeExpirationStatus()` unit tests | CONSERVATIVE_PROVISIONAL | PO decision on a standard default warning period (e.g. 30/60/90 days) if one is desired product-wide |
| Renewal/replacement | Atomic demote-old→create-new→backfill-link transaction | `renew()` + RLS live test + Playwright | ACCEPTED_MATCH (fixed this session — see defects below) | None |
| Revocation | `revoke()` sets `REVOKED`, reason/actor/timestamp, `isCurrent=false` | service + unit tests | CONSERVATIVE_PROVISIONAL | PO confirmation this reason-coded revoke is the desired admin action (vs. a different status name) |
| External verification / compliance status | **Deliberately not implemented** | `getVendorInsuranceSummary()` test asserts no `complianceStatus`/`verified` field | OUTSIDE_SCOPE (S036B-owned) | None — explicit boundary honored |
| Historical preservation | Superseded/revoked rows never deleted, retrievable via list/history endpoints | schema + RLS live test + Playwright (SUPERSEDED row assertion) | ACCEPTED_MATCH | None |
| Payment/invoice blocking | **Not implemented** | grep confirms no reference in S038 code to invoice/payment gating | OUTSIDE_SCOPE | None — explicitly prohibited unless required, and it was not found to be required |
| Permissions | 6 keys (`view/create/edit/renew/revoke/audit_view`), catalog v1.18.0 | auth-service migration + route tests | CONSERVATIVE_PROVISIONAL | PO confirmation of exact role-to-permission mapping (ADMIN/CONTROLLER/ACCOUNTANT split was mirrored from S036A precedent, not a specified S038 rule) |
| Audit | Outbox event per create/update/renew/revoke + dedicated audit-events route | service + route tests | ACCEPTED_MATCH | None — matches generic DoD "audit event emitted & visible" invariant |
| Tenant/store ownership | RLS + app-layer `_assertVendorOwnership()` re-check | live RLS test 10/10 | ACCEPTED_MATCH | None |
| UI workflow | Insurance tab on vendor detail; create/view/edit/renew/revoke/expiring-filter; permission-aware controls; loading/empty/error states | `VendorInsuranceCertificates.tsx` + Playwright | CONSERVATIVE_PROVISIONAL | PO confirmation of exact tab placement/labels/copy — visual design was not sourced from an approved Figma per the JIRA row's `FIGMA_REQUIRED (assess at wave)` note |

**Stop condition check**: no discovered gap in this pass requires *deleting*
or *materially changing* a persisted business rule — the two real issues
found (below) were transaction-correctness defects, not scope/business-rule
errors, so no stop-and-report was triggered before proceeding to fix them.

## Reused (not duplicated)

- **S036A `Vendor` table** (`services/apar-service/prisma/schema.prisma`) —
  certificates reference `vendorId` only; no second vendor table was created.
  Every write re-validates `Vendor.tenantId` server-side (defense in depth on
  top of RLS).
- S036A's service-layer conventions (optimistic concurrency via `version`,
  audit-outbox helpers, Zod route schemas, `createAuthzGuard`/permission-key
  pattern, RLS migration shape) were mirrored exactly, not reinvented.
- `document-service`'s metadata-only pattern for file references — since real
  object storage is outside this contract's accepted scope, only
  `documentId` / `documentFileName` / `documentMimeType` are persisted as a
  supported storage *reference*, never a binary blob in this table.

## Production files

- `services/apar-service/prisma/schema.prisma` — `VendorInsuranceCertificate` model (additive).
- `services/apar-service/prisma/migrations/20260730000000_s038_vendor_insurance_certificates/migration.sql` — table, indexes, partial unique index, RLS policies.
- `services/apar-service/src/application/insurance-certificate-service.ts` — service layer (lifecycle, validation, audit, S036B boundary).
- `services/apar-service/src/http/routes.ts` — REST routes (purely additive block — confirmed 251 insertions / 0 deletions against original HEAD; see "Incidental fix" note below about an earlier false alarm).
- `services/apar-service/src/index.ts` — DI registration.
- `services/auth-service/prisma/migrations/20260730000000_extend_authz_catalog_s038_vendor_insurance/migration.sql` — permission catalog (catalog_version 1.18.0).
- `apps/web/src/pages/accounting/VendorInsuranceCertificates.tsx` — UI (new).
- `apps/web/src/pages/accounting/VendorMaintenance.tsx` — additive "Insurance" tab wiring + a `data-testid` on the vendor list row (no removed/rewritten behavior).
- `apps/web/src/api/client.ts` — additive `aparApi` methods for the new endpoints.
- Tests: `services/apar-service/tests/insurance-certificate-service.test.ts`, `services/apar-service/tests/insurance-certificate-routes.test.ts`, `tests/integration/test-rls-isolation-apar-vendor-insurance.ts`, `tests/e2e/vendor-insurance.spec.ts`.

## Migration

Additive only. Fresh `prisma migrate deploy` replay against an ephemeral,
isolated Postgres instance applied all 9 apar-service migrations (including
the new S038 one) cleanly, and all 25 auth-service migrations (including the
new catalog extension) cleanly. Table, 5 indexes, the partial unique index,
RLS enable+force, and 4 tenant-isolation policies were all confirmed present
by direct SQL inspection after replay.

## Permissions

`ap.vendor_insurance.{view,create,edit,renew,revoke,audit_view}` — catalog
version 1.18.0 (next free slot after S036A's 1.17.0 on this branch).
ADMIN/CONTROLLER/ACCOUNTANT hold view/create/edit/renew; ADMIN/CONTROLLER
only hold revoke/audit_view (mirrors the S036A sensitive-action precedent).
Verified by direct query against a fresh migration replay — 16 role/permission
rows, exactly as specified.

## Document-storage / reference approach

No new object-storage adapter was built (out of accepted scope). Certificates
persist `documentId` (a caller-supplied external reference), `documentFileName`,
`documentMimeType` as metadata only — truthful reference fields, never a
binary blob, matching `document-service`'s existing metadata-first pattern.

## Expiration and renewal behavior

`computeExpirationStatus()` is pure and read-time-only: `EXPIRED` if
`expirationDate < now`; `EXPIRING_SOON` only if a caller-supplied `withinDays`
places the expiration inside that window; otherwise `CURRENT`. No fixed
default warning period was invented. `renew()` is one atomic transaction:
inserts the new period, marks the prior row `SUPERSEDED` with
`supersededByCertificateId` set, and requires the prior row's `version` to
match (rejects renewing an already-superseded/revoked record). `revoke()`
never deletes — marks `REVOKED`/`isCurrent=false` with reason/actor/timestamp.
An operator-visible expiring list is exposed via `GET /insurance-certificates/expiring`.

## S036B integration boundary

`GET /vendors/:vendorId/insurance-summary` → `getVendorInsuranceSummary()` is
the sole designated integration point: it returns only raw facts (provider,
dates, computed `expirationStatus`) for the vendor's current certificates. No
"verified"/"complianceStatus" field exists anywhere in the S038 schema,
service, or API surface — confirmed by an explicit test asserting their
absence on the summary response.

## Authorization, tenant isolation, concurrency, duplicate protection

- Live-Postgres RLS test (`tests/integration/test-rls-isolation-apar-vendor-insurance.ts`): **10/10 passed** — cross-tenant SELECT/UPDATE/DELETE/INSERT denial, WHERE-clause-bypass prevention, missing-tenant-context deny-by-default, admin-without-bypass constrained to own tenant, admin-with-bypass sees both tenants, DB-level rejection of a second active certificate for the same vendor+type via the partial unique index.
- Route-level tests: permission-key gating (NO_GRANT → 403 across all 6 keys; ACCOUNTANT vs ADMIN/CONTROLLER split on revoke/audit_view), 404/409/422/400 error-code mapping.
- Application-layer `_assertVendorOwnership()` re-checks the parent vendor's `tenantId` on every write, independent of RLS (defense in depth).
- Optimistic concurrency: `update()`/`renew()`/`revoke()` all require a matching `version`; a stale version is rejected with `409 VERSION_CONFLICT` (unit-tested and exercised at the DB layer in the live RLS script).
- Duplicate protection: one `isCurrent=true` row per `(tenantId, vendorId, insuranceType)`, enforced by a DB-level partial unique index — not just an application check — verified by a live-Postgres test that performs the conflicting insert directly.

## Audit

Every create/update/renew/revoke writes an `AuditOutboxEvent` row
(`docType: 'VendorInsuranceCertificate'`, `eventType` one of
`VENDOR_INSURANCE_CERTIFICATE_{CREATED,UPDATED,RENEWED,REVOKED}`), matching
the existing outbox-delivery pattern already used for `Vendor`. A dedicated
`GET /insurance-certificates/:id/audit-events` route proxies to audit-service
using the same server-to-server bearer-token pattern as the vendor
audit-events route (see incidental fix below).

## Test totals (this closure pass — re-run after the defect fixes)

| Suite | Result |
|---|---|
| `insurance-certificate-service.test.ts` (unit, updated for RLS/renew fixes) | 28/28 passed |
| `insurance-certificate-routes.test.ts` (route/authz/error-contract) | 16/16 passed |
| Full `apar-service` suite (incl. pre-existing `vendor-service`/`vendor-routes`) | **86/86 passed** |
| Full `auth-service` suite | **154/154 passed** (no regressions from the catalog migration) |
| Live-Postgres RLS — S038 (`test-rls-isolation-apar-vendor-insurance.ts`) | **10/10 passed** |
| Live-Postgres RLS — S036A baseline (`test-rls-isolation-apar-vendor.ts`) | 9/9 passed |
| Playwright (`tests/e2e/vendor-insurance.spec.ts`) — live browser, live isolated stack | **2/2 passed** |

All live-Postgres RLS totals in this pass were obtained via a **Docker-
daemon-independent** workaround after the host Docker failure: 
`tests/integration/rls-live-db/setup.sh` stands up a fully disposable,
non-Docker Postgres 16 cluster (Homebrew `initdb`/`pg_ctl`, ephemeral port
55439) and applies the complete real migration chain (via `prisma migrate
deploy` for apar-service; via a `prisma migrate diff --from-empty` bootstrap
plus the real hand-written RLS/trigger SQL migrations for
auth/tenant/coa/audit-service), so these totals are real live-database
results, not mocks — obtained independently of whether the Docker daemon was
up. The cluster was **torn down** at the end of this session via
`tests/integration/rls-live-db/teardown.sh`.

## Migration replay (this closure pass)

Two independent replays were performed:
1. **Docker-based** (isolated `amacc-s038-cert` stack, before the daemon
   failure): apar-service 9/9, auth-service 25/25, both applied cleanly from
   empty; schema objects (table, indexes, partial unique index, RLS,
   policies, permission rows) confirmed present by direct SQL.
2. **Docker-independent** (local ephemeral Postgres, after the daemon
   failure, used to complete Gate 4): apar-service `prisma migrate deploy`
   against a fresh `amacc_apar_fresh` database → **9/9 applied cleanly**;
   auth-service `prisma migrate deploy` against a fresh `amacc_auth_fresh`
   database → **25/25 applied cleanly**, including the S038 catalog-extension
   migration. `catalog_version` table confirmed top entry `1.18.0`.

Both replays agree: all migrations, including the new S038-specific ones,
apply cleanly from empty with no manual intervention.

## TypeScript (this closure pass)

`apar-service`: `tsc --noEmit` — 0 errors. `auth-service`: `tsc --noEmit` — 0
errors. `apps/web`: `tsc --noEmit` — 0 errors.

## Frontend build (this closure pass)

`npm -w apps/web run build` — succeeded. Pre-existing chunk-size advisory
warning only (unrelated to this change, not a build failure).

## Auth-catalog collision (recorded, NOT modified in this branch)

**S038_AUTH_CATALOG_RENUMBERING_REQUIRED_DURING_SELECTIVE_INTEGRATION**

S038's `services/auth-service/prisma/migrations/20260730000000_extend_authz_catalog_s038_vendor_insurance/migration.sql`
advances `catalog_version` to `1.18.0`. A search of every sibling feature
worktree under `/Users/shivashankarangadi/Public/Projects/AM-Accounting-r1-*`
found that version `1.18.0` is **independently claimed** by at least these
other, still-unmerged branches/migrations:

- `r1-integration` — two stories both target `1.18.0` (`s026_open_items`,
  `s052_cash_receipts`) — note this is the eventual merge target and already
  contains multiple stories' migrations.
- `r1-s021-completion` — `s021_posting_recovery`.
- `r1-s026-s027-v2` — `s026_open_items`.
- `r1-s036b` — `s036b_vendor_compliance`.
- `r1-s046` — `s046_customer_master`.

This is a real, disclosed integration risk: whichever of these branches
merges into `r1-integration` last will need its catalog-version migration
renumbered to the next free slot at merge time. Per explicit instruction,
**no renumbering was performed in this feature branch** — the certified
migration remains `1.18.0` as originally authored.

## UI route and navigation entry

No new top-level route was added. The "Insurance" tab is a new entry in the
existing vendor-detail section tabs at `/accounting/ap/vendors/:id`
(`VendorMaintenance.tsx`'s `SECTIONS` array), consistent with how
Address/Contact/Tax/Payment/Banking/Audit are already discovered — i.e. a
contextual vendor entry point, not a wholesale App.tsx/routing rewrite.

## API endpoints used by the UI

```
GET    /api/v1/apar/vendors/:vendorId/insurance-certificates
GET    /api/v1/apar/insurance-certificates/expiring
GET    /api/v1/apar/vendors/:vendorId/insurance-summary
GET    /api/v1/apar/insurance-certificates/:id
POST   /api/v1/apar/vendors/:vendorId/insurance-certificates
PATCH  /api/v1/apar/insurance-certificates/:id
POST   /api/v1/apar/insurance-certificates/:id/renew
POST   /api/v1/apar/insurance-certificates/:id/revoke
GET    /api/v1/apar/insurance-certificates/:id/audit-events
```

## Gate 2 — Isolated live Docker stack (this closure pass)

A fully isolated Docker Compose stack was built from the current branch,
independent of any other feature worktree's running stack:

- Project name: `amacc-s038-cert` (unique, does not touch `am-accounting-*`
  or any sibling feature-branch project name).
- Port offset: `+42000` on every published port (e.g. apar-service
  `3013`→`45013`, auth-service `3001`→`45001`, frontend `5174`→`45174`,
  Postgres `5432`→`45432`) — verified no collision with any other running
  stack on the shared host.
- Disposable Postgres volume + disposable database, migrated from empty using
  this branch's full migration chain (superuser `amacc:amacc_dev`, per
  `infra/postgres/init/01-create-app-role.sql`).
- Current-branch `apar-service`, `auth-service`, and frontend images (built
  from this worktree, not pulled from any shared registry tag).
- RabbitMQ stubbed with a `busybox` placeholder (message delivery is out of
  S038's test scope; outbox-row creation was verified directly instead).
- Temporary secrets in `/tmp/s038-cert-stack/secrets.env` (never committed).
- Minimum seed: one tenant, one ADMIN user, one no-grant ("clerk-view") user,
  one fixture vendor.

Confirmed by direct SQL/API inspection: apar-service 9/9 migrations applied,
auth-service 25/25 migrations applied, `vendor_insurance_certificates` table
+ 5 indexes + the partial unique index + RLS enable/force + 4 policies all
present, and all 6 `ap.vendor_insurance.*` permission rows correctly granted
to ADMIN/CONTROLLER/ACCOUNTANT per the mapping above (and correctly absent
for the no-grant user, confirmed via a real `403`).

**Host-level Docker Desktop failure (disclosed, non-S038, environment
issue):** during repeated rapid rebuild/rerun cycles against this stack, the
shared host ran low on disk (down to ~4.2Gi avail), which corrupted the
Docker containerd content-store and ultimately made the entire Docker daemon
unresponsive (`docker ps` → HTTP 500) for **all** stacks on the machine, not
only this session's — confirmed by an unrelated stack's own Postgres
container simultaneously failing `pg_isready` with an I/O error. Disk space
later recovered on its own; the daemon itself did not self-heal within the
observed window (retried repeatedly over several minutes at the end of this
session). Per the explicit instruction not to stop/restart another active
feature stack, Docker Desktop was **not** force-quit or restarted. This is a
genuine host/environment failure, not an S038 code defect, and it occurred
**after** the verification runs below had already completed successfully
against the live isolated stack.

## Production defects found and fixed (this closure pass)

Both defects below were found by exercising the live isolated stack (not by
static review), root-caused, fixed, and re-verified live before the Docker
daemon failure occurred.

1. **Missing RLS tenant-context propagation inside interactive
   transactions.** `create()`, `update()`, `renew()`, and `revoke()` in
   `insurance-certificate-service.ts` each open a `prisma.$transaction(async
   (tx) => {...})` block, but Prisma's legacy `$use` middleware (which
   normally calls `setTenantContextOnConnection`) does **not** run inside
   interactive-transaction callbacks — a documented gotcha in
   `packages/shared-kernel/src/tenancy/rls-middleware.ts`. Every write inside
   these four blocks was executing with **no** `app.tenant_id` session
   variable set, which a `FORCE ROW LEVEL SECURITY` policy correctly rejected
   with a real `42501` error live against Postgres. **Fix**: added
   `await setTenantContextOnConnection(tx, tenantId)` as the first statement
   in all four callbacks. Confirmed live: create/update/renew/revoke all
   succeed after the fix; cross-tenant attempts still correctly fail.
   The identical bug class exists in S036A's `vendor-service.ts` but was
   **not** touched (out of S038 ownership) — worked around via direct SQL
   fixture seeding instead.
2. **`renew()` violated its own non-deferrable partial unique index.** The
   original write order created the new "current" certificate row *before*
   demoting the prior one, which always collides with the
   `(tenant_id, vendor_id, insurance_type) WHERE is_current = true` partial
   unique index (Postgres enforces non-deferrable unique indexes
   immediately, even mid-transaction). **Fix**: reordered to demote the old
   row first (without yet setting `supersededByCertificateId`), then create
   the new row, then a follow-up `update` to backfill
   `supersededByCertificateId` onto the now-superseded row. Confirmed live:
   renew succeeds and correctly leaves exactly one `isCurrent=true` row.

Both fixes are reflected in `insurance-certificate-service.ts` and their
matching unit-test updates in `insurance-certificate-service.test.ts` (mock
`$executeRawUnsafe` stub added; renew-test assertion updated to check the
second/backfill `update` call instead of the first).

## Playwright — executed live (this closure pass)

`tests/e2e/vendor-insurance.spec.ts` was **executed for real** against the
isolated live stack described above (not merely `--list`-parsed). Both tests
passed together in a clean run, confirmed via real network logs (genuine
200/201 API responses, a real browser reload, real certificate persistence
after reload, a real renew round-trip, real historical-row preservation, and
a real `403` for the no-grant user). Two genuine test-authoring bugs were
found and fixed along the way (locator ambiguity on the insurance-section
"View" filter select, and a strict-mode violation on a bare `SUPERSEDED`
text match that needed row-scoping) — these were test-file corrections, not
production-code changes. One flaky-looking failure was traced to a **real,
pre-existing, already-disclosed S207 AuthzService race condition** (documented
in `vendor-master.spec.ts`'s own header comment) that intermittently
returns a false 403 on one of several concurrent authz checks during a full
page reload — not an S038 defect. It was handled at the test level with the
same `toPass()` retry pattern `vendor-master.spec.ts` already uses for this
exact class of race, plus a `fonts.gstatic.com` network-error exclusion (no
internet egress in this sandbox, unrelated to S038).

Result: **2/2 passed** in the confirmed clean run. A final repeat
confirmatory rerun was subsequently blocked by the Docker daemon failure
described above (host-level, occurring after this successful run) — the
passing result above is real, from this session, against the live isolated
stack, not a mocked or `--list`-only result.

## Incidental fix (disclosed — turned out to be a false alarm)

While wiring the S038 audit-events route, the tool transcript repeatedly
rendered the `` `Bearer ${createServiceToken(...)}` `` bearer-token expression
as `` `******...` `` wherever it appeared (a display-masking artifact, not
real file content — this affected every view/grep of any line containing
that pattern, including the pre-existing S036A vendor audit-events route).
This was initially mistaken for real corruption and "fixed." A final
byte-level diff against the original HEAD (`git diff --stat
services/apar-service/src/http/routes.ts`) confirms the change is **100%
additive — 251 insertions, 0 deletions** — the pre-existing S036A code was
never actually modified; both the original and the new S038 code always
contained the correct, working expression. Disclosed here only to correct
the record from an earlier working assumption in this session.


## Unresolved decisions / remaining work (this closure pass)

1. **Playwright live-browser execution** — DONE this pass: executed for real
   against a live isolated stack, 2/2 passed with genuine network evidence
   (see "Playwright — executed live" above). The one remaining gap is a
   single final *repeat* confirmatory run, blocked only by the host Docker
   daemon failure described above (an environment issue, occurring after the
   passing run, not an S038 defect).
2. **Detailed S038 acceptance criteria remain unexpanded** at the canonical-
   backlog level (`EXPANSION_PENDING`, no `Canonical_Backlog_V2` section 4
   text found in this repository). The implementation's field list and
   lifecycle rules are a defensible, conservative reading of the task's own
   explicit list and existing repo conventions, but several items in the
   Gate 1 reconciliation table above are marked `CONSERVATIVE_PROVISIONAL`
   and would benefit from explicit PO confirmation (insurance-type taxonomy,
   default expiration-warning window, exact role-to-permission mapping, and
   UI copy/placement given `FIGMA_REQUIRED (assess at wave)`).
3. **Coverage details/limits** were deliberately left unimplemented
   (`OUTSIDE_SCOPE`) per the task's explicit instruction not to invent
   coverage/jurisdiction rules — flagged for a future product decision, not
   a defect.
4. **Auth-catalog renumbering** is required during selective integration
   into `r1-integration` (see collision note above) — not to be done in this
   branch.
5. No decision was found in this pass that would require *changing* an
   already-persisted business rule (the two issues found were transaction-
   correctness defects, now fixed) — so no stop-and-report was triggered.
