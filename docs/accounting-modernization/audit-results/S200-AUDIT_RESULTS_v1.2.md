# S200-AUDIT v1.2 — EXECUTED — Results Package
**Implementation Gap Audit: Create & Maintain Legal Entity**
Executed: 2026-07-23 | Executor: Claude Code (audit operator) | Scope: audit execution only, per RELEASE_RECORD_S200-AUDIT.md and S200-AUDIT_v1.2.md
Candidate audited: `services/tenant-service` (Legal Entity feature) + `apps/web/src/pages/admin/LegalEntities*.tsx`, at the working tree state of the AM-Accounting repo on 2026-07-23 (branch `main`, no uncommitted changes to the audited files at audit start).

## Read-only compliance statement
- No source files were modified. No migrations were applied to any shared or persistent database. No S201 work was performed. No backlog was modified. No findings were remediated.
- All writes occurred in an ephemeral sandbox: a throwaway local PostgreSQL 16 instance (`initdb` into a scratch directory, port 55432, never the shared `amacc` dev DB), running two standalone `tenant-service` processes (ports 13002 prod-auth-mode, 13003 dev-auth-mode) and two standalone Vite frontend instances (ports 15174, 5173) pointed at that sandbox. RabbitMQ was unavailable and the service degraded gracefully to its documented in-memory fallback (no code change required).
- The sandbox was fully torn down at the end of the audit: all processes killed, the Postgres data directory and its socket directory deleted. Teardown log: see appendix.
- One interpretation exercised per the release record: item 6 (currency lock) and the mark-posted flow were evidenced by calling the `POST /:id/mark-posted` endpoint directly (the same endpoint GL service calls) rather than running gl-service itself, since gl-service requires its own schema/bootstrap not exercised here. This is a partial, not full, substitute for "seed one posted JE via gl-service" — noted against MIG/EVT rows below, not silently upgraded to PASS.

---

## 1. Completed S200 Requirement Matrix

| ReqID | Requirement | Evidence Required | SOURCE | TEST | RUNTIME | DATABASE | UI | **Overall** | GapID |
|---|---|---|---|---|---|---|---|---|---|
| BR200-1 | Entity code unique per tenant, immutable after creation | S,T,R,D | PASS | PASS | PASS | PASS | — | **PASS** | — |
| BR200-2 | Duplicate statutory ID → warning + confirm | S,T,R,D,U | PARTIAL | PARTIAL | PARTIAL | N/A (advisory, no unique constraint — correct) | PARTIAL | **PARTIAL** | GAP-S200-WARNCONFIRM |
| BR200-3 | Functional currency immutable after first posted journal | S,T,R,D | PARTIAL | FAIL | FAIL | PASS (flag column works) | — | **PARTIAL** | GAP-S200-CURRENCYLOCK |
| BR200-4 | Posted-journal entity: no delete, deactivate-only; blocks new documents | S,T,R,D,U | PARTIAL | FAIL | N/A (no consumer exists) | PASS (no delete route) | FAIL (UI over-claims) | **FAIL** | GAP-S200-DOCBLOCK |
| AC200-1 | Create → Active, unique code, appears in org tree | R,U | PASS (list) | — | PASS | — | PARTIAL (flat list, not a tree) | **PARTIAL** | GAP-S200-ORGTREE |
| AC200-2 | Edit → effective-dated, audit-logged with before/after | R,U | FAIL (no audit call) | — | PASS (effective date) | — | FAIL ("No audit events recorded yet") | **FAIL** | GAP-S200-AUDIT (=AUD200-1) |
| AC200-3 | Posted journals + delete attempt → 409 citing BR200-4 | R,U | FAIL (no delete route exists) | — | N/A | — | N/A | **FAIL** | GAP-S200-NODELETE |
| AC200-4 | Deactivated entity + any document targets it → rejected | R,U | FAIL (no integration) | — | N/A (nothing to call) | — | N/A | **FAIL** | GAP-S200-DOCBLOCK (dup) |
| NEG200-1 | Dup code 409; currency-after-post 422; lock conflict surfaced | R,T | — | PARTIAL | PARTIAL (2/3: dup-code ✅, lock ✅, currency-422 ❌) | — | — | **PARTIAL** | GAP-S200-CURRENCYLOCK (dup) |
| FLD200-1 | Field inventory conformance (shape/format/whitelist) | S,D,U | PARTIAL (no ISO4217/3166/EIN-format whitelist) | — | — | PARTIAL | PASS (shape) | **PARTIAL** | GAP-S200-FIELDVALIDATION |
| TRN200-1 | ACTIVE→INACTIVE (blocked in-flight); INACTIVE→ACTIVE | S,R | PASS/FAIL | — | PASS(deactivate) / FAIL(reactivate: 404) | — | — | **FAIL** | GAP-S200-REACTIVATE |
| PRM200-1 | acct.entity.manage/view, deny-by-default | S,R,T | FAIL (no permission model) | FAIL (no test) | FAIL (no-permission JWT created an entity) | — | — | **FAIL** | GAP-S200-AUTHZ |
| API200-1 | Request/response contract conformance | R,T | PARTIAL | PARTIAL | PARTIAL (PUT not PATCH+If-Match; 409 not 412) | — | — | **PARTIAL** | GAP-S200-APICONTRACT |
| EVT200-1 | Event emission + payload contract | S,R | FAIL (wrong type strings, missing fields) | — | FAIL (confirmed via outbox query) | — | — | **FAIL** | GAP-S200-EVENTCONTRACT |
| SEM200-1 | Tenant=group boundary only; LegalEntity distinct (expected gap) | S,D | PARTIAL (expected) + new finding (see below) | — | — | PARTIAL | — | **PARTIAL (expected)** | GAP-S200-SEMANTIC |
| ISO200-1 | Tenant isolation mechanism + cross-tenant rejection (UQ-01) | S,D,R,T | PARTIAL (app-code only, no RLS) | FAIL (no isolation test exists) | PASS (verified live) | PARTIAL | — | **PARTIAL** | GAP-S200-ISOLATION (feeds UQ-01) |
| CON200-1 | Optimistic concurrency: conflict surfaced, no lost update | R,T | — | PASS | PASS (real concurrent race, verified) | — | — | **PASS** | — (minor: 409 not 412, tracked under API200-1) |
| AUD200-1 | Audit persistence with before/after, transactional coupling | S,D,R | FAIL | — | FAIL (empty timeline after real actions) | FAIL (no write path) | — | **FAIL** | GAP-S200-AUDIT |
| EFF200-1 | Effective-dated edits (valid-time model) | S,D,R | FAIL (no history table) | — | PARTIAL (single mutable date field works) | FAIL (no valid-time columns) | — | **PARTIAL** | GAP-S200-EFFDATE |
| MIG200-1 | Migrations additive + apply cleanly (ephemeral sandbox) | S,D | PASS | — | — | PASS (clean apply, empty DB) | — | **PASS** | (see note: `tenants` table itself has no migration history — pre-existing risk, not new) |
| E2E200-1 | Existing tests: count / pass-rate / assertion quality | T | — | PARTIAL | PARTIAL | — | — | **PARTIAL** | GAP-S200-E2EBASEPATH |
| RDY200-1 | Readiness census | S,U | PARTIAL | — | — | — | PARTIAL | **PARTIAL** | GAP-S200-READINESS |

**Status tally:** 3 PASS · 12 PARTIAL · 7 FAIL (some rows double-count against the same root-cause gap, e.g. AC200-4/BR200-4 and AUD200-1/AC200-2).

---

## 2. Runtime Evidence Appendix (condensed — full curl transcripts and logs held in the audit operator's scratch directory, not committed to the repo)

**Environment:** ephemeral Postgres 16 (port 55432) → `prisma migrate deploy` for tenant-service → tenant-service on :13002 (NODE_ENV=production, real JWT auth) and :13003 (NODE_ENV=development, matches the actual docker-compose default) → Vite frontend on :15174/:5173 pointed at the sandbox.

1. **Auth enforcement (prod mode):** no `Authorization` header → `401 Missing or invalid Authorization header`. Bogus token → `401 Invalid JWT format`. ✅ authentication works when NODE_ENV=production.
2. **Authorization (permission) probe:** valid JWT, tenant matches, role = `VIEWER_ONLY_ROLE_XYZ_NO_PERMISSIONS` (a made-up, non-existent role/permission) → `201 Created`, entity created successfully. **No permission check exists in the route or service layer.**
3. **Duplicate entity code:** second POST with the same `entityCode` in the same tenant → `409 DUPLICATE_ENTITY_CODE`. ✅
4. **Duplicate statutory ID:** second POST, different code, same `statutoryId` → `201 Created` with `warnDuplicateStatutoryId: true` in the body. No distinct status code, no confirm step.
5. **Immutability attempt:** `PUT` with `entityCode:"HACKED"` and `functionalCurrency:"EUR"` in the body → `200 OK`, both fields silently ignored (Zod strips unknown keys); response still shows original code/currency.
6. **Stale version:** `PUT` with `version:1` against a row already at version 2 → `409 VERSION_CONFLICT`.
7. **Concurrent-edit race:** two simultaneous `PUT` requests both carrying `version:2` → one succeeds (`200`, version bumps to 3), the other correctly rejected (`409 VERSION_CONFLICT: expected 2, current is 3`). No lost update.
8. **Deactivate → edit block:** deactivate succeeds (`200`, status INACTIVE); subsequent edit attempt → `422 ENTITY_INACTIVE`.
9. **Reactivation search:** `POST /:id/reactivate` and `POST /:id/activate` → both `404 Not Found`. No such route exists anywhere in `legal-entity-routes.ts`.
10. **Cross-tenant isolation:** tenant-B JWT + header fetching tenant-A's entity id → `404 Not Found` (correct — scoped by `tenantId` in the WHERE clause, not leaked). Tenant-B list → `{items:[],total:0}` (correct, no leakage).
11. **JWT/header tenant mismatch:** JWT says tenant-A, `x-tenant-id` header says tenant-B → `403 Tenant ID mismatch` (defense-in-depth check in `authMiddleware`, works correctly).
12. **`mark-posted` + currency-lock attempt:** called `POST /:id/mark-posted` (the GL-service callback route) directly against the sandbox → `204`, `hasPostedJournals` flips to `true`. Subsequent `PUT` with `functionalCurrency:"EUR"` on that now-posted entity → **`200 OK`**, currency silently unchanged (field stripped unconditionally, not conditionally on `hasPostedJournals`, and not the `422` the NEG200-1 spec calls for).
13. **Validation:** oversized `entityCode` + malformed `effectiveDate` → `400 VALIDATION_ERROR` with both Zod issues listed. ✅ format validation works.
14. **Whitelist validation:** `functionalCurrency:"ZZZ"`, `country:"ZZ"` (neither a real ISO code) → `201 Created`, accepted as-is. **No ISO 4217 / ISO 3166 code-list validation exists** — only length/case checks.
15. **Outbox contents** (`tenant_outbox_events` table, queried directly): event types are `LEGAL_ENTITY_CREATED` / `_UPDATED` / `_DEACTIVATED` (not the `org.entity.*` naming in EVT200-1), payloads carry only `entityCode`/`legalName`/`changes:[fieldNames]`/`reason`/`deactivatedBy` — **no `eventId`, `currencyCode`, `actor`, `ts`, `schemaV`, and update `changes` never carries before/after values**, only field-name lists.
16. **UI — duplicate statutory ID:** created two entities via the real browser UI with the same statutory ID. The second create *did* show an amber banner ("Another entity with the same Statutory ID exists. Saved anyway — please verify this is correct.") — but it renders **after** the record is already saved, below the fold, with no interstitial/confirm step the user must act on before the save proceeds. This is a warn-after-the-fact, not "warning + confirm."
17. **UI — Audit Timeline:** after live create/edit/deactivate actions performed through the browser in this same session, the Audit Timeline tab reads **"No audit events recorded yet."** Confirms the source-level finding that nothing writes to audit-service for LegalEntity events.
18. **UI — Deactivate modal claims vs. reality:** the "Deactivate Legal Entity" modal lists as an "Impact": *"New documents cannot be created for this entity"* (unimplemented anywhere in the codebase — see BR200-4/AC200-4) and *"Entity can be reactivated by editing its status"* (**demonstrably false** — confirmed live: opening Edit on a deactivated entity and clicking Save Changes returns the raw `ENTITY_INACTIVE` error text on-screen; there is no status field to toggle in the Edit form, and no reactivate endpoint exists).
19. **Unit tests:** `services/tenant-service/tests/legal-entity.test.ts` → **16/16 passed**, ~181ms. Good coverage of uniqueness, warn-not-block, version conflict, inactive-block, deactivate metadata, outbox write. Zero tests for tenant isolation, zero tests for the currency-lock-after-posting scenario, zero tests for reactivation (because it doesn't exist).
20. **E2E suite:** `tests/e2e/legal-entity.spec.ts` run live against the working sandbox frontend → **4 failed / 4 skipped (0/8 effective pass)**. Root cause confirmed independently (not assumed): the spec hardcodes `BASE = 'http://localhost:5173'`, but `vite.config.ts` sets `base: '/amacc/'` — navigating to `http://localhost:5173/setup/legal-entities` returns Vite's own "did you mean `/amacc/setup/legal-entities`?" page, so every locator times out. This is a **test-configuration defect**, not a proof the feature is broken — separately, the same flows (create, duplicate-statutory-id, edit, deactivate, audit-tab-empty-state) were verified to work correctly via direct browser automation at the correct `/amacc/` base path (see items 16–18 above).

---

## 3. Gap Register

| GapID | Severity | Affected BR/AC | Description | Disposition |
|---|---|---|---|---|
| GAP-S200-AUTHZ | **Critical** | PRM200-1 | No permission-based authorization anywhere in the Legal Entity route/service layer — only JWT authentication. A JWT with an arbitrary, meaningless role can create/edit/deactivate. Deployed default (`NODE_ENV=development` in docker-compose) bypasses authentication entirely. | REFACTOR |
| GAP-S200-DOCBLOCK | **Critical** | BR200-4, AC200-4 | "Deactivation blocks new documents targeting this entity" has zero implementation — no other service (gl-service, apar-service) references `legalEntityId` at all. The deactivate-confirmation UI actively claims this protection exists. | REFACTOR (implement) or REMOVE the false UI claim immediately regardless |
| GAP-S200-REACTIVATE | High | TRN200-1 | No INACTIVE→ACTIVE transition exists (no route, no UI control), yet the deactivate modal explicitly tells the user reactivation is possible "by editing its status." Confirmed false via live UI + runtime test (edit is hard-blocked while inactive). | REFACTOR (implement) or fix the misleading copy immediately regardless |
| GAP-S200-AUDIT | High | AC200-2, AUD200-1 | No audit record is ever written for any LegalEntity action. `audit-service` has a working `AuditLog` model with before/after support, but `LegalEntityService` never calls it — it only writes to its own outbox (no before/after values). The Audit Timeline UI is wired to read from audit-service and correctly shows empty, which is honest, but the underlying guarantee ("audit-logged with before/after") does not exist. | REFACTOR |
| GAP-S200-EVENTCONTRACT | Medium | EVT200-1 | Outbox event types/payloads don't match the specified `org.entity.*` contract (wrong names, missing `eventId`/`currencyCode`/`actor`/`ts`/`schemaV`, no before/after values in `changes`). Internally consistent but not spec-conformant; likely blocks any external/other-service consumer written against the spec. | REFACTOR |
| GAP-S200-CURRENCYLOCK | Medium | BR200-3, NEG200-1 | Currency is unconditionally excluded from the update payload (immutable always, not "immutable after first posted journal"). Attempting to change it after `hasPostedJournals=true` returns `200 OK` with the field silently ignored, not the specified `422`. Data integrity is accidentally preserved; the contract is not met and gives no feedback to a caller. | REFACTOR |
| GAP-S200-ISOLATION | Medium–High (architectural) | ISO200-1, SEM200-1 | Tenant isolation is enforced solely by application-code convention (`tenantId` in every WHERE clause) with no database-level backstop (no RLS, no schema-per-tenant, no automated isolation test). `Tenant.schemaName` is a vestigial field implying a schema-per-tenant design that is never actually used anywhere. Feeds UQ-01 directly (see §5). | ARCHITECTURAL DECISION REQUIRED before further build-out (RLS, or a query-middleware guard, or an explicit accepted-risk decision) |
| GAP-S200-WARNCONFIRM | Medium | BR200-2 | "Warning + confirm" is implemented as "warn after the record is already saved" — there is no pre-save interstitial the user must act on. Matches spec intent loosely but not literally. | REFACTOR (minor) |
| GAP-S200-FIELDVALIDATION | Medium | FLD200-1 | No ISO 4217 currency whitelist, no ISO 3166 country whitelist, no country-conditional statutory-ID format check — confirmed `"ZZZ"`/`"ZZ"` accepted at create time. | REFACTOR (add whitelist validation) |
| GAP-S200-APICONTRACT | Low–Medium | API200-1 | Uses `PUT` + version-in-body instead of the specified `PATCH` + `If-Match` header; returns `409` instead of the specified `412` for stale-version conflicts. Two dead ternaries in `legal-entity-routes.ts` (`? 201 : 201`, `? 409 : 409`) suggest an intended distinction was never wired up. | REFACTOR (low complexity) |
| GAP-S200-ORGTREE | Low | AC200-1 | UI is a flat searchable/filterable list, not a hierarchical "org tree" as the AC literally describes. Functionally equivalent for a flat entity set; matters only if a future hierarchy (parent/child entities) is intended. | KEEP (as scoped) unless hierarchy is a real near-term requirement |
| GAP-S200-EFFDATE | Low–Medium | EFF200-1 | `effectiveDate` is a single mutable column overwritten on every edit — no valid-time/history model, so a past-as-of state can never be reconstructed. | REFACTOR if temporal queries are a real requirement; otherwise KEEP with the limitation documented |
| GAP-S200-E2EBASEPATH | Low (mechanical) | E2E200-1 | The e2e spec's hardcoded `BASE` omits the app's `/amacc/` Vite base path, causing 4/8 tests to fail immediately and the remaining 4/8 to skip. One-line fix. Currently the suite provides **zero** real regression protection despite existing and looking reasonable on read. | REFACTOR (trivial) |
| GAP-S200-READINESS | Low | RDY200-1 | No metrics/instrumentation on tenant-service; raw backend error codes (e.g. `ENTITY_INACTIVE`) surfaced verbatim in the UI instead of a friendly message; `x-tenant-id` hardcoded to `'tenant-kunes'` in the frontend API client (relevant to the product's explicit white-label, not-Kunes-specific mandate); two dead-code ternaries (see GAP-S200-APICONTRACT). | REFACTOR (low complexity, non-blocking) |
| GAP-S200-SEMANTIC | Informational (expected per kit) | SEM200-1 | LegalEntity is structurally distinct from Tenant at the schema level (separate table, own identity) — the expected v1.1 semantic gap is confirmed present as anticipated, compounded by the vestigial `schemaName` finding above. | Track under UQ-01 |

---

## 4. Remediation Work Items (unestimated — `ENGINEERING_ESTIMATE_REQUIRED`; unreleased until the PO releases each individually, per release record §6)

1. **WI-S200-01** — Implement permission-based authorization (`acct.entity.manage` / `acct.entity.view`) on all Legal Entity routes, deny-by-default; close the `NODE_ENV=development` auth-bypass gap for any real deployment path. *(closes GAP-S200-AUTHZ)*
2. **WI-S200-02** — Either implement cross-service document-blocking for deactivated legal entities (gl-service/apar-service check entity status before allowing new documents) or remove the "New documents cannot be created" claim from the deactivate UI until it's true. *(closes GAP-S200-DOCBLOCK)*
3. **WI-S200-03** — Implement an INACTIVE→ACTIVE reactivation path (route + service + UI control), or remove the "Entity can be reactivated by editing its status" claim from the deactivate UI until it's true. *(closes GAP-S200-REACTIVATE)*
4. **WI-S200-04** — Wire LegalEntity create/update/deactivate through `audit-service`'s existing `AuditLog.log()` (previousState/newState), so the Audit Timeline UI has real data to show. *(closes GAP-S200-AUDIT)*
5. **WI-S200-05** — Align outbox event type names and payload shape with the EVT200-1 contract (`org.entity.created|updated|deactivated`, `eventId`, `currencyCode`, `actor`, `ts`, `schemaV`, before/after values in `changes`). *(closes GAP-S200-EVENTCONTRACT)*
6. **WI-S200-06** — Make functional-currency immutability conditional and explicit: return `422` with a clear business-rule error when a currency change is attempted on an entity with `hasPostedJournals=true`; consider allowing currency edits before the first posted journal if that's the intended legacy behavior. *(closes GAP-S200-CURRENCYLOCK)*
7. **WI-S200-07** — Decide and implement the tenant isolation architecture for UQ-01 (see §5): at minimum add Postgres RLS or an equivalent DB-level backstop, plus an automated cross-tenant-isolation test; resolve or remove the vestigial `Tenant.schemaName` field. *(closes GAP-S200-ISOLATION; architectural — feeds directly into whether S201 can safely proceed)*
8. **WI-S200-08** — Turn the duplicate-statutory-ID "warn" into a genuine pre-save confirm step (or explicitly document/accept the current "warn-after-save" behavior as sufficient). *(closes GAP-S200-WARNCONFIRM)*
9. **WI-S200-09** — Add ISO 4217 currency and ISO 3166 country whitelist validation; add country-conditional statutory-ID format validation. *(closes GAP-S200-FIELDVALIDATION)*
10. **WI-S200-10** — Align the update/deactivate HTTP contract with API200-1 (`PATCH` + `If-Match`, `412` on stale version) or formally amend the spec to match the `PUT`+body-version+`409` design already shipped; remove the two dead ternaries. *(closes GAP-S200-APICONTRACT)*
11. **WI-S200-11** — Fix the e2e spec's hardcoded `BASE` to include the `/amacc/` Vite base path. *(closes GAP-S200-E2EBASEPATH — trivial, do this regardless of anything else)*
12. **WI-S200-12** — Readiness pass: add basic metrics/instrumentation, map backend error codes to friendly UI messages, replace the hardcoded `'tenant-kunes'` fallback per the white-label mandate. *(closes GAP-S200-READINESS)*

---

## 5. UQ-01 Tenancy Impact

**What the candidate's isolation model actually is:** every Legal Entity query is scoped by an application-code `tenantId` WHERE clause (create/read/update/deactivate all confirmed, live, to correctly reject or empty-out cross-tenant access). There is a second, independent defense layer at the auth middleware (JWT `tenantId` must match the `x-tenant-id` header, or the request is `403`'d). Both layers were verified working in the sandbox.

**What's unresolved:** this is 100% a code-discipline convention, not a database-enforced guarantee. No Postgres RLS policy, no per-tenant schema, no per-tenant database exists anywhere in the stack for LegalEntity (or, by inspection, for the sibling `Tenant`/`TenantOutboxEvent` tables). The `Tenant` model carries a `schemaName` column that is generated at tenant-creation time and displayed in the admin UI, but **is never used to route any query anywhere** — it is vestigial and actively misleading about the system's real tenancy model. CLAUDE.md itself already codifies "every Prisma query MUST include tenantId in WHERE clause — no exceptions" as a standing, project-wide critical rule — which is itself an admission that the current model depends on every engineer, on every future query, remembering to do this correctly, with nothing at the database layer to catch a mistake, and (confirmed here) zero automated test coverage exercising cross-tenant rejection.

**Why this matters for S201:** whatever S201 builds will either extend this same row-level convention (compounding the single-point-of-failure as more tables/services adopt it) or need to retrofit a different model later at much higher cost once more services depend on the current implicit contract. The `schemaName` field's existence suggests the *original* intent may have been schema-per-tenant, which was either abandoned or never finished — that ambiguity itself is a decision that needs to be made explicitly, not left to decay further by default.

---

## 6. Final Recommendation

**(a) Can the existing S200 implementation be retained?**
**RETAIN-WITH-REMEDIATION.** The core mechanics — uniqueness enforcement, code/currency immutability-by-field-omission, optimistic concurrency (verified under a genuine concurrent-write race, no lost updates), request validation, tenant-scoped queries — are sound and don't need to be rebuilt. But several requirement-defining behaviors are either missing, contradicted by their own UI copy, or silently non-conformant to their specified contract: no permission-based authorization at all, no working audit trail despite a UI tab for it, no reactivation path despite a UI claim that one exists, no cross-service document-blocking despite a UI claim that one exists, and a currency-lock that "works" only by accident (unconditional field omission, not an enforced business rule with the specified error contract).

**(b) Is remediation or partial remodel required?**
Remediation, itemized against the gap register in §3–4 above. Nothing here rises to REBUILD-PART — every gap is additive work on top of the existing service/route/schema structure, not a redesign. Two items (WI-S200-02, WI-S200-03) should be treated as urgent regardless of prioritization, because the current UI actively tells users something false about what the system guarantees ("new documents cannot be created," "entity can be reactivated") — that's a trust/correctness issue independent of feature completeness.

**(c) Must UQ-01 be decided before S201?**
**YES.** The isolation evidence (§5) shows the mechanism works today but rests entirely on per-query application discipline with no database-level backstop and no automated regression test — and the vestigial `schemaName` field signals an unresolved architectural question, not a settled one. Deciding the tenancy model now (row-level + RLS, schema-per-tenant, or an explicitly accepted risk with compensating controls) is materially cheaper than doing it after S201 adds more tables and services onto the current ad hoc convention.

**(d) May S201 begin?**
**YES-AFTER-[named gates]:**
- **Gate 1:** UQ-01 tenancy decision made, with at minimum a database-level backstop (RLS or equivalent) or a committed automated cross-tenant-isolation test suite for LegalEntity as the reference implementation for whatever comes next.
- **Gate 2:** GAP-S200-AUTHZ closed — real permission enforcement in place — since S201 will presumably add more mutating endpoints riding the same `authMiddleware` with the same currently-absent permission layer.
- **Gate 3:** GAP-S200-DOCBLOCK and GAP-S200-REACTIVATE resolved, or their corresponding false claims removed from the deactivate-confirmation UI, whichever comes first.

**S201 remains NOT RELEASED regardless of this recommendation until the PO acts on it, per RELEASE_RECORD_S200-AUDIT.md §7.**

---

## Appendix: Sandbox teardown confirmation
All sandbox processes (2× tenant-service, 2× Vite) terminated; ephemeral Postgres instance stopped via `pg_ctl stop -m fast`; ephemeral data directory and Unix socket directory deleted. No shared or persistent database, and no repository file, was modified during this audit.
