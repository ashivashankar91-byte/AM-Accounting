# S032 — Recurring Journal Templates and Generation — COMPLETION

**Status:** `S032_INTEGRATED_TECHNICALLY_PENDING_COMBINED_DEMO_CERTIFICATION`
**Prior status (own-branch certification):** `TECHNICALLY_CERTIFIED_AND_PROVISIONALLY_ACCEPTED_FOR_INTEGRATION`
**Integrated into:** `r1-integration` (R1 Controlled Integration, 2026-07-29) — selective integration of both S032-owned commits (781c331, db411c9) onto the Golden R0 + S008 + S003 + S009 + S011 branch; see `MODULE_STATE.json`'s S032 `stabilizationReconciliation`/`statusHistory` for the full integration record, including the DI fix, the authorization-matrix tests added, and the JournalWorkflow.tsx deep-link addition.
**Service:** coa-service (ADR-JL-001 — journal lifecycle lives in coa-service).
**Branch:** `r1-s032-je-templates` (not merged; frozen at the commit below).
**Base commit:** `296ed347874ff6b828b3bd846260840c73a09ab4`.
**Implementation commit:** see `git log -1 r1-s032-je-templates` on this
checkout — this document is committed together with the code it describes,
so it cannot self-report its own hash; the coordinating session's final
checkpoint message contains the exact SHA.
**Certification pass:** 2026-07-29 (independent re-verification of the
2026-07-28 implementation checkpoint — fresh-DB migration replay, live
BLK-22 edge cases, permission review, design-parity classification, full
retest).
**Independent acceptance:** 2026-07-29 — provisionally accepted; approved
**Permission Option A** (§4 below). See §7 "Authorization-only corrective
pass" for the resulting change and its proof.
**Pack:** P01 — Governed Accounting Foundation (`P01_STORY_CONTRACTS.md` §S032,
`P01_STORY_BLOCKING_REGISTER.csv` BLK-20..25).

## What was built
Accountants define fixed debit/credit journal templates (rent accruals,
depreciation splits, standard adjusting entries) and generate them into a
**manual JE draft** for any accounting period, on demand. Generation is a
**client of the certified S214 draft path** — it never writes to
`journal_entry`/`journal_line` directly, and posting the generated draft (or
its auto-reverse counterpart) remains a deliberate human action through the
existing S216 `:post` action. **No scheduler exists anywhere in this
codebase** — BLK-21 excludes it, and the only trigger is the explicit
`:generate` ceremony.

### Ratified decisions
- **BLK-20** — dedicated `RT` MANUAL journal source, never GJ/88 (proof below).
- **BLK-22** — reversal draft created at the original's post time, dated the
  following period's end date, `reversalOfJournalId` forwarded into the
  existing `PostingService.post({reversalOf})` on the reversal's own
  (separate, manual) post — reuses S218's certified mirrored-linkage
  semantics, no second reversal mechanism (full lifecycle + edge-case proof
  below).
- **BLK-23** — fixed amounts only; `domain/recurring-template.ts` has no
  formula/percent code path at all.
- **BLK-24** — generated entries (original and auto-reverse) are dated the
  target/following period's end date. SME validation of this convention
  remains an acceptance gate per instruction, not a development blocker.
- **BLK-25** (S214/S218 integration) — verified live: generation calls
  `DraftService.create()` directly (in-process, same service); the
  auto-reverse hook calls it again with `reversalOfJournalId` set, and
  `DraftService.postDraft()` forwards that field into
  `PostingService.post()`'s existing `reversalOf` parameter — no new posting
  path exists anywhere in this codebase.

### BR coverage
BR032-1 (balanced + shape-valid at save), BR032-3 (generation via the
certified S214 path, tagged `generatedFromTemplateId`/`generationBatchId`),
BR032-4 (idempotent per template+period, DB-unique-enforced), BR032-5/BLK-22
(auto-reverse), BR032-6 (absolute period-control refusal via the existing
`domain/period-status.eligibility()`), BR032-7 (version stamped at
generation, editing never touches past generations) — unchanged from the
implementation checkpoint; re-verified below.

## 1 — Migration replay (fresh, isolated database)
A brand-new empty database (`amacc_fresh_cert`, same Postgres instance,
zero prior state) received:
- All 21 coa-service migrations, in lexical/chronological order, applied via
  direct `psql` execution (never `prisma db push`, never `prisma migrate
  dev`) — **zero failures, no manual repair**.
- All 17 auth-service migrations, same method — **zero failures, no manual
  repair**.

**Drift check:** `prisma migrate diff --from-url <fresh DB> --to-schema-datamodel prisma/schema.prisma --script`
against the replayed database → the S032 tables/columns produce **zero diff
output** (`grep -n "recurring|generated_from_template|generation_batch_id|reversal_of_journal_id"` on
the full diff → no matches). The only diff lines present are pre-existing
legacy index-naming drift on unrelated tables (documented since the original
implementation pass; not touched by S032).

**RLS:**
```
relname                          | rls_enabled | rls_forced
recurring_journal_template       | t           | t
recurring_journal_template_line  | t           | t
recurring_template_generation    | t           | t
```
**Cross-tenant proof (raw SQL, non-superuser role `amacc_app` with
`rolbypassrls=false`, table owner is `amacc` not `amacc_app`):**
- Tenant A (`app.current_tenant_id='tenant-cert-a'`) inserts a template.
- Switched session to `app.current_tenant_id='tenant-cert-b'`:
  - `SELECT` → **0 rows**.
  - `UPDATE ... SET name='HACKED'` → **`UPDATE 0`**.
  - `DELETE` → **`DELETE 0`**.
  - `INSERT` of a row claiming `tenant_id='tenant-cert-a'` while the session
    is set to `tenant-cert-b` → **`ERROR: new row violates row-level
    security policy for table "recurring_journal_template"`** (rejected
    outright, not silently reassigned).

## 2 — BLK-20: journal source
| Field | Value |
|---|---|
| Code | `RT` |
| Display name | `Recurring Journal Template` |
| `numericAlias` | `50` |
| `sourceClass` | `MANUAL` (not SYSTEM — so `SourceService.assertUsableByManual()` never rejects a generated draft) |
| `reserved` | `true` |
| Definition location | `services/coa-service/src/domain/journal-source.ts`, `RESERVED_SOURCES` array (domain constant) |
| Materialization | `SourceService.bootstrapReserved()` (idempotent, merge-by-code) — **the same mechanism as every other reserved source** (GJ/ADJ/YE/M13/SVC/PART/WARR/PAY); no dedicated SQL migration inserts source rows anywhere in this service, by existing convention (sources are tenant-provisioned data, not schema) |
| Uniqueness | `@@unique([tenantId, code])` (`journal_source` table); verified against the 8 pre-existing reserved codes and numeric aliases before adding — no collision |
| Length/format validation | `CODE_RE = /^[A-Z0-9]{2,6}$/` and `@db.VarChar(6)` — `RT` (2 chars) satisfies both |
| Live DB row | `tenant_id=tenant-s032-demo, code=RT, numeric_alias=50, source_class=MANUAL, reserved=t, status=ACTIVE` (re-confirmed this pass) |

**Generated journal evidence:** `journal_entry` rows `RT-2026-01-000001`,
`RT-2026-02-000001`, `RT-2026-04-000001`, `RT-2026-12-000001` — all
`source_code='RT'`.

**Inquiry/report visibility:** `gl-search-service.ts` / `gl-inquiry-service.ts`
/ `journal-view-service.ts` query `journal_entry`/`journal_line` generically
by tenant/entity; `sourceCode` is only ever used as an *optional search
filter* (`gl-search-service.ts:76,321,405`), never an allow/deny list — RT
journals are fully visible through GL Search, GL Inquiry, and
`GET /journals/{number}` (already exercised live: full line/header detail
returned for `RT-2026-01-000001`).

**GJ/88 not reused:**
- `RecurringTemplateService`'s create-template route schema
  (`CreateSchema` in `recurring-template-routes.ts`) has **no `sourceCode`
  field at all** — a caller cannot set it to `GJ` even if they tried.
- `RecurringJournalTemplate.sourceCode` defaults to `"RT"` at the DB level
  (`@default("RT")`) and is hardcoded via `const RT_SOURCE_CODE = 'RT'` in
  `recurring-template-service.ts` — no code path assigns any other value.
- Live check: `SELECT DISTINCT source_code FROM manual_je_draft WHERE
  generated_from_template_id IS NOT NULL;` → **`RT`** (single row, no `GJ`).

## 3 — BLK-22: full reversal lifecycle + edge cases (live)
**Happy path (re-verified this pass, prior data intact):**
generate RENT-01 into 2026-01 → draft `c0abe409…` → **human posts** it
(`:validate` + `:post`) → journal `RT-2026-01-000001` minted → response's
`reversalDraft` field shows a **new** draft `7827ac8d…` created
automatically, `entryDate:"2026-02-28"` (P+1's end date), `status:"DRAFT"`
(never auto-posted), `reversalOfJournalId` = the original journal's id.
**Posting the reversal is a separate, manual `:post` call** — minted
`RT-2026-02-000001` with the real S218 linkage: `GET journals/RT-2026-02-000001`
→ `reversalOf: {id: <original>, journalNumber: "RT-2026-01-000001"}`.

**Edge case — P+1 does not exist:** created template `EDGE-01`, generated
into `2026-12` (the last period this fiscal year; no FY2027 exists), posted
it → journal `RT-2026-12-000001` minted successfully, and the response's
`reversalDraft` field is `{"error":"NO_NEXT_PERIOD","message":"No fiscal
period follows 2026-12 for this entity yet"}` — **the original post is never
blocked by the missing next period**; the failure is surfaced (audited as
`REVERSAL_DRAFT_FAILED`), not silent, and no orphan/malformed reversal
record is created.

**Edge case — retried post request:** re-posted the identical `EDGE-01`
draft a second time → `{"idempotent":true, "journalNumber":"RT-2026-12-000001"
(unchanged), "reversalDraft":{"error":"NO_NEXT_PERIOD", ...}}` (re-evaluated
consistently, not cached-wrong). DB check: exactly **one**
`journal_entry` row for `2026-12`, exactly **one**
`recurring_template_generation` row for that template+period — no
duplicates from the retry.

**Edge case — P+1 is closed:** created template `EDGE-02`, generated into
`2026-04` (opened live via the normal FUTURE→OPEN transition), then
**directly set** `fiscal_period.status='SOFT_CLOSED'` on `2026-05` (period
close/lock transitions belong to S008, not yet built on this branch — this
simulates the state S008 will produce). Posted `EDGE-02`'s draft →
original journal `RT-2026-04-000001` minted successfully, and the
auto-reverse hook **did** create a reversal draft dated `2026-05-31`
(`findNextPeriod()` picks the chronologically-next period; it does not
itself gate on period status — by the same design principle as every other
draft in this system, BR214-1: **draft creation is never gated, only
posting is**). Proof this is safe: attempting to `:validate` or `:post` that
reversal draft is rejected by the **existing, untouched** S013/BR013-2 gate:
`{"pass":false,"errors":[{"rule":"BR013-2","message":"Period 2026-05 is
SOFT_CLOSED; postings require an OPEN period."}]}` — **422**, same gate every
other draft in this codebase is subject to. No bypass exists.

**Edge case — P+1 is locked:** same draft, period `2026-05` status changed
to `LOCKED` → re-`:validate` → `{"pass":false,...,"message":"Period 2026-05
is LOCKED; postings require an OPEN period."}` — identical BR013-2 code path
(`domain/journal-posting.ts:179-180` treats every non-`OPEN` status
uniformly: FUTURE, SOFT_CLOSED, HARD_CLOSED, LOCKED all reject the same way).

**No second posting path:** confirmed by code inspection (the reversal draft
is created via the identical `DraftService.create()` used for the original,
and posted via the identical `DraftService.postDraft()` → `PostingService.post()`
→ the single S013 `evaluate()` — the only difference is one extra field,
`reversalOf`, forwarded through, exactly mirroring how `ReversalService`
(S218) already does it for manual reversals) and by the runtime evidence
above (both journals share one `journal_entry` table, one numbering
sequence, one posting code path).

## 4 — Permission review — **RESOLVED: Option A approved and applied** (§7)
**Catalog at implementation checkpoint (v1.10.0):** `je.template.manage`,
`je.template.generate`, `je.template.view`, all three granted to ADMIN,
CONTROLLER, **and** ACCOUNTANT (CLERK excluded). The analysis below is kept
verbatim as the record of *why* Option A was recommended and subsequently
approved; §7 documents the applied change and its live proof.

**Precedent in this codebase's own catalog** (queried live from
`role_permission`):

| Object | `*.manage` grantees | `*.view` grantees |
|---|---|---|
| `coa.account` | ADMIN, CONTROLLER | ADMIN, CONTROLLER, **ACCOUNTANT** |
| `coa.source` | ADMIN, CONTROLLER | ADMIN, CONTROLLER, **ACCOUNTANT** |
| `fiscal.calendar` | ADMIN, CONTROLLER | ADMIN, CONTROLLER, **ACCOUNTANT** |
| `fiscal.period.open` | ADMIN, CONTROLLER | — |
| `je.draft` (create/edit/void) | ADMIN, CONTROLLER, **ACCOUNTANT**, CLERK | — |
| `je.post` | ADMIN, CONTROLLER, **ACCOUNTANT** | — |
| `je.template` (current) | ADMIN, CONTROLLER, **ACCOUNTANT** | ADMIN, CONTROLLER, **ACCOUNTANT** |

Every existing **structural/reusable master-data object** (chart of
accounts, journal sources, the fiscal calendar) restricts `*.manage` to
ADMIN/CONTROLLER and gives ACCOUNTANT only `*.view`. Every existing
**per-instance transactional action** (create/edit/void/post one journal
entry) includes ACCOUNTANT in the acting role set. `je.template.manage`
is currently the **only** "manage a reusable master-data object" permission
in the catalog that includes ACCOUNTANT — it is an outlier against the
codebase's own established pattern.

**Option A — ADMIN/CONTROLLER manage; ADMIN/CONTROLLER/ACCOUNTANT view + generate.**
- *Security:* Matches every other structural-object precedent in this
  catalog. A recurring template is a reusable definition — once created,
  every future `:generate` call replays its fixed accounts/amounts
  unattended by a second reviewer at generation time. An `autoReverse`
  template compounds this: one bad template produces two mis-posted-shaped
  drafts (original + reversal) per period it's used, not one. Requiring
  Controller/Admin to define or edit the template adds a segregation-of-duties
  checkpoint that does not otherwise exist anywhere in this story (S031
  approval routing is explicitly out of scope for R1).
- *Operational cost:* An Accountant who identifies a needed recurring entry
  must ask a Controller/Admin to create or edit the template (a one-time,
  infrequent action per template) before they can generate/post from it.
  Generation and posting — the *recurring, day-to-day* actions — remain
  unrestricted to the Accountant.

**Option B — ADMIN/CONTROLLER/ACCOUNTANT receive all three (current state).**
- *Security:* Weaker segregation of duties — the same person can define a
  template's accounts/amounts/auto-reverse flag, trigger its generation, and
  (via the pre-existing `je.post`) post the resulting draft, entirely
  unilaterally, repeatedly, with no second party at any point.
- *Operational cost:* Lower friction — matches the story's own framing ("As
  an **Accountant**, I need recurring... templates...") literally, and the
  Accountant never needs to route a request to a Controller for routine
  template maintenance (e.g., updating an amount when rent changes).

**Recommendation: Option A.** The codebase's own precedent for every
comparable reusable/structural object (source, account, fiscal calendar)
draws this exact line, and the compounding blast-radius of a
mis-defined recurring (especially auto-reversing) template is materially
larger than a single hand-typed draft — which is exactly the risk category
this catalog's existing design already treats as Controller-level.

**Disposition: approved by independent acceptance review, 2026-07-29.**
Applied via a single additive auth-service migration revoking
`je.template.manage` from ACCOUNTANT (`je.template.generate`/`.view` stay
granted) — no application/domain code changes. See §7.

## 5 — Frontend routes, states, and design classification
| Route | Owning API | Required permission |
|---|---|---|
| `/accounting/journals/templates` (Registry) | `GET /api/v1/coa/journal-templates` | `je.template.view`* |
| `/accounting/journals/templates/new`, `/:id` (Editor) | `POST`/`PUT`/`GET /api/v1/coa/journal-templates[/:id]` | `je.template.manage` (write), `je.template.view`* (read) |
| Generation Ceremony (dialog on the Registry route) | `POST /api/v1/coa/journal-templates:generate` | `je.template.generate` |

*The reader guard (`requireTemplateReader`) accepts **any** of
`je.template.manage`/`.generate`/`.view` (deny-by-default if none held) —
see "Permission review" above for why `.manage` itself is now in question.

**States present on every route** (all three routes share the Registry
page's guard logic; the Editor and Ceremony are reached only after it
passes): Loading (`PageLoader`, service/port named), Empty (`EmptyState`,
"No recurring journal templates yet" + New Template CTA), Validation
(balanced/unbalanced live balance bar + disabled Save; server-side 422 with
`violations[]` rendered inline), Error (`PageError` with retry, or the
generation ceremony's inline error banner for `PERIOD_NOT_ELIGIBLE`/
`INACTIVE_ACCOUNT`/etc.), Unauthorized (401/403 → dedicated "Not authorized"
panel, distinct from the generic error panel).

**Design source:** `docs/accounting-modernization/build-packs/P01/design/P01_GOVERNED_FOUNDATION.html`
§`s032`, plus the shipped Accounting UI Foundation V1 component library
(`apps/web/src/components/ui/*`: `Btn`, `Badge`, `PageHeader`, `EmptyState`)
already used by every other coa-service-backed page in this app.

**Truthful classification (checked against the design source, not asserted):**

| Route | Classification | Basis |
|---|---|---|
| Template Registry | `BASELINE_PRODUCT_QUALITY` | Uses the real Foundation V1 components/styling and the mock's table shape (code/name/source/status/actions), but omits the mock's **Amount** and **Last generated** columns |
| Template Editor | `BASELINE_PRODUCT_QUALITY` | The balance-bar widget matches the mock's "Template editor — balance bar (JE pattern reused)" state precisely; the surrounding form layout was not traced against a full mock (the design source only shows the balance-bar snippet, not a complete editor screen) |
| Generation Ceremony | `BASELINE_PRODUCT_QUALITY` | Functionally equivalent outcome (period select → per-template result, idempotent/error badges) but structurally **one step** (select → generate → results) vs. the mock's **two-step** ceremony (checkbox preview list with per-row projected result → separate "Generate drafts" confirm). No pixel-level QA pass was performed |

None of the three routes are `SHELL_ONLY` or `FUNCTIONAL_UNSTYLED` — all
three are fully styled with the production component library and handle
every required state; none are `DESIGN_PARITY_COMPLETE` because of the
disclosed gaps above (missing registry columns; single-step vs. two-step
ceremony). These gaps are cosmetic/interaction-sequencing, not functional —
every business rule the two-step mock implies (preview before commit) is
still enforced server-side (idempotency, period refusal, partial-batch
errors are all real, just surfaced after one click instead of previewed
before it).

**Screenshots** (`docs/accounting-modernization/screenshots/s032/`, all
captured this certification pass against the live stack, real data, no
mocks):
- `registry-populated.png` — real templates (RENT-01 autoReverse, MISC-01,
  FRESH-01, plus this pass's EDGE-01/EDGE-02).
- `registry-empty.png` — a permissioned tenant with zero templates.
- `editor-balanced.png` — RENT-01 loaded, green $1500.00/$1500.00/$0.00 bar.
- `editor-unbalanced.png` — same template, debit changed to $999, red
  −$501.00 bar, **Save Template disabled**.
- `generation-ceremony.png` — period-select dialog, real OPEN/FUTURE periods.
- `generation-future-period-refused.png` — live `PERIOD_NOT_ELIGIBLE` (bonus).
- `generation-idempotent.png` — live "Already generated" badges (bonus).
- `successful-generation.png` — a genuinely fresh (never-before-generated)
  template's "DRAFT … created" success badge.
- `unauthorized.png` — a tenant with no `je.template.*` role assignment.
- `accountant-manage-disabled.png` / `accountant-generate-succeeds.png` —
  added in the §7 authorization-only corrective pass: real ACCOUNTANT JWT,
  New Template/Deactivate disabled, "View" not "Edit", generate still works.

## 6 — Final test results (this certification pass)
| Check | Result |
|---|---|
| coa-service `vitest run` | **332 passed, 5 skipped (pre-existing, unrelated live-db file), 0 failed** — 20 files |
| auth-service `vitest run` (catalog-affected + full suite) | **154 passed, 0 failed** — 10 files |
| `tsc --noEmit` — coa-service | **0 errors** |
| `tsc --noEmit` — auth-service | **0 errors** |
| `tsc --noEmit` — apps/web | **0 errors** |
| S032 Playwright suite | **3/3 passed** |
| Live gateway verification | `GET /api/v1/coa/journal-sources` through `api-gateway:23100` → **200** |
| RLS verification | Fresh-DB raw-SQL cross-tenant proof (§1) + live cross-tenant API proof (identical ADMIN grant on `tenant-other-demo` → `{"templates":[]}`) |
| `audit_outbox` verification | `RECURRING_JOURNAL_TEMPLATE` rows: `CREATE` ×5, `GENERATE_BATCH` ×12, `REVERSAL_DRAFT_CREATED` ×2, `REVERSAL_DRAFT_FAILED` ×2 — every sampled row carries a real `actor`, non-null `before`/`after` |

## 7 — Authorization-only corrective pass (2026-07-29)
Independent acceptance provisionally accepted S032 and approved Permission
Option A. This pass changed **only** the authorization grant and its
UI/API-authoritative surfacing — no template behavior, journal generation,
reversal logic, schema, RLS policy, or accounting rule was touched.

**Approved R1 permission model:**

| Role | `je.template.view` | `je.template.manage` | `je.template.generate` |
|---|---|---|---|
| ADMIN | ✓ | ✓ | ✓ |
| CONTROLLER | ✓ | ✓ | ✓ |
| ACCOUNTANT | ✓ | **✗ (revoked)** | ✓ |

**1. Catalog migration:** `services/auth-service/prisma/migrations/20260729010000_revoke_je_template_manage_from_accountant/migration.sql`
— adds `catalog_version` `1.11.0` and `DELETE FROM role_permission WHERE
role='ACCOUNTANT' AND permission_key='je.template.manage'`. No permission
key removed, no other role's grant touched. Applied to the live database;
verified: `role_permission` for `je.template.manage` now lists only ADMIN
and CONTROLLER; `je.template.generate`/`.view` still list all three.

**2. Role grants (live, post-migration):**
```
ACCOUNTANT | je.template.generate
ADMIN      | je.template.generate
CONTROLLER | je.template.generate
ADMIN      | je.template.manage
CONTROLLER | je.template.manage
ACCOUNTANT | je.template.view
ADMIN      | je.template.view
CONTROLLER | je.template.view
```

**3–7. Live API proof** — a fresh 3-role fixture (`tenant-perm-test`,
`entity-perm-test`; `admin-test-user`/`controller-test-user`/`accountant-test-user`,
each holding exactly one role) authenticated with **real HS256 JWTs** minted
in-process (not the dev auth-bypass — the real `verifyJWT` signature-check
path was exercised), through the real gateway:
- **(3) ADMIN manage succeeds:** `POST journal-templates` (template
  `PERM-01`) → **201**.
- **(4) CONTROLLER manage succeeds:** `POST journal-templates` (template
  `PERM-02`) → **201**.
- **(5) ACCOUNTANT view succeeds:** `GET journal-templates?entity=...` →
  **200**, both templates returned.
- **(6) ACCOUNTANT generate succeeds:** `POST journal-templates:generate`
  → **200**, real drafts created for both templates (`idempotent:false`).
- **(7) ACCOUNTANT manage → 403:**
  - `POST journal-templates` (create) → **403** `{"error":"FORBIDDEN","message":"Missing required permission: je.template.manage","reason":"NO_MATCHING_ROLE"}`.
  - `PUT journal-templates/{id}` (update) → **403**, identical shape.
  - `POST journal-templates/{id}/deactivate` → **403**, identical shape.
  - (No `DELETE` endpoint exists in this API — templates are deactivated,
    never deleted; deactivation is the closest equivalent and is covered.)

**8. Frontend manage actions hidden/disabled for ACCOUNTANT:** both S032
pages now call the real `GET /api/v1/authz/check` (auth-service's actual
`AuthzService.check()`, the same engine the server-side guard calls) for
`je.template.manage` and gate on the result — **fail-closed** (defaults to
hidden/disabled while loading or on any error). Registry: "New Template"
disabled; per-row action reads **View** (not Edit) and navigates read-only;
Activate/Deactivate disabled. Editor: opening an existing template as a
non-manager renders every field `disabled`, hides "Add line"/remove-line
controls, and removes the "Save Template" button entirely (replaced with a
"Back" button); attempting to *create* a new template routes to a "Not
authorized" panel before the form ever renders. Live browser proof
(`tests/e2e/s032-recurring-templates.spec.ts`, real ACCOUNTANT JWT, real
backend): `docs/accounting-modernization/screenshots/s032/accountant-manage-disabled.png`
(New Template disabled, View/Deactivate disabled) and
`accountant-generate-succeeds.png` (generate still works).

**9. Direct API authorization remains authoritative:** the same Playwright
spec, from the browser's own JS context (not the app's UI), issues a raw
`fetch('/api/v1/coa/journal-templates', {method:'POST', ...})` with the real
ACCOUNTANT bearer token and asserts **403** with a `je.template.manage`
message — proving the server rejects the action regardless of whether the
UI happens to expose a button for it; the frontend gate is UX-only, never
the security boundary.

**10. Existing S032 Playwright flows remain passing:** all 3 pre-existing
specs (registry/ceremony/editor as ADMIN, empty state, unauthorized state)
re-run unmodified in behavior (only their login helper was upgraded from
the dev-bypass token to a real minted JWT, so the real JWT-verification
path is now exercised end-to-end for every S032 browser test, not only the
new one) — all still pass.

**Retest results (this pass):** coa-service **332 passed / 5 skipped / 0
failed**; auth-service **154 passed / 0 failed**; `tsc --noEmit` clean for
coa-service, auth-service, and apps/web; **S032 Playwright: 4/4 passing**
(3 pre-existing + 1 new ACCOUNTANT scenario).

## Known limitations / exclusions
- **Scheduler explicitly excluded (BLK-21)** — no cron/automatic trigger
  exists anywhere in this story.
- **BLK-24/BLK-22 date convention (period-end-date for both the original and
  the following-period auto-reverse draft) is documented here as a ratified
  R1 assumption** — a PO-ratified development decision, proven consistent
  and idempotent under live test (§3), but **not yet Accounting-SME-validated**.
  Per instruction, this is an acceptance gate for a future pass, not a
  development blocker for this one.
- **Permission Option A: RESOLVED** — `je.template.manage` restricted to
  ADMIN/CONTROLLER; ACCOUNTANT retains `.view`/`.generate` only. Applied and
  proven live in §7. No longer open.
- **Frontend store selector** — the live-proof/Playwright session ran
  without tenant-service (S032 doesn't own store/org data); the editor's
  Store dropdown renders empty in evidence screenshots, while `storeId`
  itself round-trips correctly server-side through every generated line.
- **Design parity** — `BASELINE_PRODUCT_QUALITY` on all three routes, not
  `DESIGN_PARITY_COMPLETE` (§5 gaps disclosed).
- **gl-service is a separate ledger** (ADR-JL-001) — S032 only ever
  generates into the coa-service ledger.
- **S008 (period close/lock) is not built on this branch** — the BLK-22
  "P+1 closed/locked" edge cases above were proven by directly setting
  `fiscal_period.status` (simulating the future S008 state), since no
  app-reachable transition into SOFT_CLOSED/HARD_CLOSED/LOCKED exists yet;
  the safety property demonstrated (draft creation unguarded, posting
  absolutely guarded) will hold unchanged once S008 ships real transitions,
  since it relies only on the existing, untouched BR013-2 gate.
