# S220 — GL Account Activity Inquiry: Live-Gateway Certification Report

**Date:** 2026-07-27
**Branch:** `golden-r0-fleet` (worktree `AM-Accounting-final-r0`)
**Story status after this report:** `DONE_PENDING_INTEGRATION` (per PO condition 9 — S220 is
`FIGMA_REQUIRED` per `GOLDEN_R0_STORY_CONTRACT_MATRIX.md`; backend/authorization/tenant-isolation/audit/
migration/live-gateway evidence is complete below, but Figma/UX and browser validation remain open).

## 1. Scope

S220 is a read-only inquiry: for one GL account, over a caller-selected date range/fiscal
period/preset, optionally scoped to a store/department, it returns the beginning balance, the
chronological list of posted-ledger lines with a running balance, the ending balance, and CSV export
parity (BR220-3). Every line carries its `journalNumber` as a drill-down key into the already-certified
S217 `GET /journals/:number` view. No new coa-service tables were required — this story reads the
existing `GlAccount`, `JournalEntry`, `JournalLine`, `BalanceSnapshot` and `FiscalPeriod` tables only.

## 2. What was built

- **`GLInquiryService`** (`services/coa-service/src/application/gl-inquiry-service.ts`):
  - `getActivity()` resolves exactly one range selector (`periodCode` | `preset=OPEN_MONTH` |
    explicit `startDate`+`endDate`), fails closed with `400 RANGE_REQUIRED`/`RANGE_CONFLICT` if zero or
    more than one is supplied, `404 PERIOD_NOT_FOUND` for an unknown period/no-OPEN-period, and
    `400 UNKNOWN_PRESET` for any preset other than `OPEN_MONTH` (see §4 below — the approved contract
    names "12 presets incl. OPEN_MONTH" but leaves the other 11 as an open, non-DoR-blocking SME
    question; only the one explicitly named preset is implemented, not fabricated others).
  - Beginning balance: a fast path reads the latest `BalanceSnapshot` before the range start when no
    store/dept filter is requested (`BalanceSnapshot` aggregates dr/cr for an account across every
    line in a journal entry, so it is *not* store/dept-granular); when a store/dept filter is present,
    beginning balance is independently re-derived by summing filtered `JournalLine` rows before the
    range start through the same `balanceDelta()` domain function the posting engine itself uses —
    proven distinct from the (wrong, cross-store) snapshot total in a dedicated unit test.
  - BR220-4 / BR013-7: a `JournalEntry.status = REVERSED` does **not** exclude its lines from the
    activity or balance math — reversal creates a new, separately-linked entry (S218) rather than
    mutating history, so both the original and its reversal are real, permanent ledger effects that
    must both be counted. Proven live below (scenario 1 includes 4 REVERSED-status entries).
  - BR220-1: `endingBalance` is computed two independent ways — as the last line's running balance,
    and as `beginningBalance + balanceDelta(normalBalance, sum(dr), sum(cr))` — and both are asserted
    equal in the unit tests, per the contract's foot/cross-foot proof requirement.
  - Running balance is computed over the *full* chronological result set before pagination slices it,
    so a page boundary never perturbs the balance math (proven live and in a dedicated unit test).
  - Zero-activity account/period → `beginningBalance === endingBalance`, `lines: []`, not an error
    (proven live, scenario 5).
  - `exportCsv()` recomputes through the identical `computeActivity()` path (unpaginated) so the CSV
    matches the screen exactly (BR220-3), and emits its own single `EXPORTED` audit event — refactored
    during this work to no longer also emit a spurious `VIEWED` event (see §3).
  - S007 audit: unlike S217's masked-role-only `audit.viewed`, the PO's S220 outcomes require a real
    audit event on *every* view/export unconditionally (matching S224's document-history convention) —
    implemented via the same transactionally-coupled `coaOutboxEvent` + `auditOutboxEvent` write used
    by `journal-view-service.ts` (BR7-1).
- **Routes** (`services/coa-service/src/http/gl-inquiry-routes.ts`), mounted under the
  already-gateway-routed `/api/v1/coa` prefix (no gateway change required):
  `GET /inquiry/accounts/:id/activity` and `GET /inquiry/accounts/:id/activity:export` (colon-suffix
  literal path segment, same safe Fastify pattern already used for `/journals/:id:reverse` and
  `/role-templates:apply`), both gated by the real `AuthzService.check()` guard on
  `inquiry.account.view`.
- **auth-service migration** `20260728000001_extend_authz_catalog_gl_inquiry`: seeds catalog version
  `1.5.0` and the single approved permission key `inquiry.account.view`, granted to
  `ADMIN`/`CONTROLLER`/`ACCOUNTANT` — the exact same role set already holding `je.view`. `CLERK` (which
  also holds `je.view`) is deliberately **not** granted this permission: GL Inquiry exposes
  cross-store/cross-department account totals, a broader read surface than a single posted JE, and no
  approved contract or existing shipped grant establishes CLERK access to it — a documented scope
  decision, not an oversight.

## 3. Real defect found and fixed (pre-live-evidence)

**`toCents()` silently produced `NaN` (serialized as `null`) on Prisma `Decimal` values.** The shared
domain helper `toCents(v)` (`services/coa-service/src/domain/journal-posting.ts`) only converts
`string`/`number` inputs — for any other type (including Prisma's real `Decimal` objects returned by
`journalLine.dr`/`.cr` and `balanceSnapshot.balanceAfter`) it passes the object through unchanged, and
`Number.isFinite(object)` is `false`, so it returns `NaN`. `NaN` serializes to `null` over JSON, which is
why this was **not** caught by the first unit-test pass (the fake Prisma there used plain JS numbers,
not Decimal-shaped fixtures) but **was** caught immediately on the first live-gateway call: `endingBalance`,
`periodDebitActivity`, `periodCreditActivity` and every line's `runningBalance` all came back `null`.

**Fix:** every dr/cr/balanceAfter value read back from Prisma is now wrapped in `Number(...)` before
being passed to `toCents()` — matching how `journal-view-service.ts` already does `dr: Number(l.dr)` for
the same reason. Added a dedicated regression unit test using a Decimal-like fixture (`{ toString() }`,
no `valueOf`, mirroring both the real `decimal.js` shape and this repo's own `dec()` fixture pattern in
`account.test.ts`) asserting every numeric field is `Number.isFinite`, not `null`/`NaN`. Re-verified live
below (scenario 1) — all four fields now return real numbers, foot/cross-foot correctly.

**Also fixed during this work (design correction, not a live defect):** the first draft of `exportCsv()`
called `getActivity()` internally, which — after the audit-emission code was added — would have caused
every CSV export to emit both a spurious `VIEWED` audit row *and* the intended `EXPORTED` row. Caught by
review before any live call; refactored so `getActivity()` and `exportCsv()` both call a shared
audit-free `computeActivity()` and each emits exactly one, correctly-typed audit event. Proven live
below (scenario 9) and in the unit suite.

## 4. Known, documented gap (not fabricated)

The approved Story Contract (`GOLDEN_R0_STORY_CONTRACT_MATRIX.md`, S220 field 22) names "12 presets
incl. OPEN_MONTH" as an SME-confirmation item that is explicitly **not** DoR-blocking. Only `OPEN_MONTH`
(the one preset actually named in the contract) is implemented, alongside `periodCode` and explicit
`startDate`/`endDate`, which together cover every acceptance-criteria example in the contract. Inventing
the other 11 preset names would violate the zero-fabrication mandate. This is recorded here and must be
closed with real SME input before Figma/UX sign-off, not silently assumed.

## 5. Migration verification — fresh database from zero

`services/auth-service`: ephemeral Postgres 15 container (port 55501), `prisma migrate deploy` — all 12
migrations (including the new `20260728000001_extend_authz_catalog_gl_inquiry`) applied cleanly, no
`db push`, no manual tables. Verified: `permission.key = 'inquiry.account.view'` present at
`since_version = '1.5.0'`; `role_permission` rows exist for exactly `ADMIN`, `CONTROLLER`, `ACCOUNTANT`.
Container torn down after verification.

`services/coa-service`: no schema/migration changes in this story (purely additive read-only service
logic against already-certified tables) — no fresh-database re-verification was required for coa-service
itself; its existing migration set was already certified in prior sessions and is untouched here.

## 6. Live-stack deployment

- Deployed `20260728000001_extend_authz_catalog_gl_inquiry` to the live shared Postgres (port 45433) via
  the schema-owning `amacc` role (`amacc_app` deliberately lacks `CREATE` on `public`).
- Verified live: `permission`/`role_permission` rows present exactly as in the fresh-DB check.
- Restarted `coa-service` (port 13016) with the new route/service code, twice — once for the initial
  deploy, once after the `toCents()` Decimal fix — reconstructing its exact prior environment via
  `ps eww` each time. `auth-service` itself required no restart (the new permission is data, read live
  on every `AuthzService.check()` call, not code).

## 7. Live-gateway evidence (real HTTP, real JWT, real PostgreSQL, real S007)

All calls through the real gateway (`localhost:13100`) against the live `coa-service`/`auth-service`,
using real login (`POST /api/v1/auth/login`), real bcrypt password verification, and real signed JWTs.
Test data: Tenant A (`1cf...94c86`) GL account `10001` "Operating Checking" (id `ff35545f-...`), which
already carried 9 real posted `JournalLine` rows across period `2026-01` from prior E2E Golden Path
activity — 5 `POSTED` entries and 4 `REVERSED` entries (proving BR013-7/BR220-4 handling of reversed
entries' lines).

1. **200 positive** — `GET .../accounts/{id}/activity?periodCode=2026-01` as ADMIN:
   `beginningBalance: 0`, `periodDebitActivity: 200`, `periodCreditActivity: 300`,
   `endingBalance: -100` (= `0 + (200 - 300)`, DR-normal), last line's `runningBalance: -100` — matches
   independently, foot/cross-foot proven live. All 9 lines present in chronological
   (`entryDate`, then `journalNumber`) order, each carrying its real `journalNumber` drill-down key.
2. **401** — no `Authorization` header → `401`.
3. **403** — a scratch user granted only `CLERK` (which lacks `inquiry.account.view`) →
   `403 {"error":"FORBIDDEN","message":"Missing required permission: inquiry.account.view","reason":"NO_MATCHING_ROLE"}`.
   Scratch user + its `authz_role_assignment` row and `session` row were deleted immediately after capture.
4. **Cross-tenant denial** — `xtuser@crosstenant.test` (Tenant B, real ADMIN role, real login, real JWT
   for Tenant B) requesting Tenant A's account id → `404 {"error":"ACCOUNT_NOT_FOUND", ...}` — RLS/tenant
   scoping in `AccountService.get()`, no existence leaked (same 404 shape as a genuinely unknown id).
5. **Zero-activity** — `periodCode=2026-02` (no lines posted that period) →
   `beginningBalance: 0, endingBalance: 0, lines: [], pagination.totalLines: 0` — not an error.
6. **`preset=OPEN_MONTH`** — resolves to `periodCode: "2026-03"` (the highest-`periodNumber` of the 3
   currently-OPEN periods for this entity — a documented, defensible tie-break, see the code comment).
7. **Unknown `periodCode`** — `periodCode=2099-01` → `404 PERIOD_NOT_FOUND`.
8. **No range selector** — no `periodCode`/`preset`/`startDate`+`endDate` → `400 RANGE_REQUIRED`.
9. **Conflicting selectors** — `periodCode` + `startDate`/`endDate` together → `400 RANGE_CONFLICT`.
10. **CSV export** — `GET .../activity:export?periodCode=2026-01` → `200`, `text/csv`, header row plus
    9 data rows matching the JSON view's lines exactly (same running balances).
11. **Pagination** — `page=1&pageSize=3` → `pagination: {page:1, pageSize:3, totalLines:9, totalPages:3}`,
    running balances `[50, 100, 150]` — identical to the unpaginated page-1 slice, confirming pagination
    never perturbs the balance math.
12. **Real S007 audit** — verified via `psql` against `audit_outbox`: 7 `VIEWED` rows (one per view call
    above, correctly attributed to the calling user's real id — including the CLERK scratch user's own
    row and the cross-tenant-denied call producing none, since it 404's before any audit emission) and
    exactly 1 `EXPORTED` row (not 2 — confirming the exportCsv refactor in §3 holds live), all
    tenant-scoped to Tenant A, `published_at` set (drained to `audit_logs` by the existing async worker).

## 8. Tests

`services/coa-service`: **294/299 pass, 5 skipped** at the time this report was first written (live-db-only
tests, `describe.skipIf(!LIVE_DATABASE_URL)`, unchanged from baseline), zero regressions against the
pre-S220 baseline of 277/282. **This 5-skip figure was not represented as a fully green regression suite —
see §10 addendum: those 5 tests were subsequently run for real (not skipped) and, in doing so, surfaced and
led to the fix of a real, unrelated pre-existing concurrency defect in `SequenceService.allocate()`.**

- `tests/gl-inquiry.test.ts` — **13 new tests**: beginning/period/ending balance + BR220-1 foot/cross-foot
  proof; BR013-7 REVERSED-entry-lines-still-count; zero-activity; store-filtered beginning balance
  (proven distinct from the unfiltered snapshot path); pagination-does-not-perturb-running-balance;
  `OPEN_MONTH` preset resolution; unknown-preset rejection; no-selector / conflicting-selector /
  unknown-periodCode / malformed-range rejections; cross-tenant 404; CSV export parity + distinct
  single audit events per action; the Prisma-Decimal regression test for the defect in §3.
- `tests/authz-guard-integration.test.ts` — extended with the S220/`inquiry.account.view` case
  (401 unauthenticated / 403 deny-by-default / 200-not-403 for a granted role / cross-tenant 403),
  **74 tests total** (70 prior + 4 new), zero regressions.
- `npx tsc --noEmit` — clean, both before and after the `toCents()` fix.

## 9. Verdict

`inquiry.account.view` — real S207 authorization, real tenant isolation (RLS-backed via `AccountService`
scoping plus proven cross-tenant 404), real S007 audit-on-view/export, real PostgreSQL reads against
already-posted ledger data (no new tables), fresh-migration reproducibility for the new permission key,
and a full positive/negative/edge-case live-gateway matrix all pass. **S220 backend is
`DONE_PENDING_INTEGRATION`** — remaining gap to `DONE` is the required Figma/UX and browser validation
(per PO condition 9) and the open, documented, non-blocking SME question on the remaining 11 date
presets (§4).

## 10. Addendum (2026-07-27, post-S220) — the 5 skipped tests were resolved, not just documented

Per PO direction, the 5 tests under `tests/live-db/posting-live.test.ts` (conditionally skipped via
`describe.skipIf(!LIVE_DATABASE_URL)` whenever no live database URL is supplied — a pre-existing gate from
an earlier R0 phase, unrelated to S220 itself) were not left as an unexplained gap in the regression count.
They were actually run against a fresh ephemeral Postgres 15 instance (`prisma migrate deploy`, 9/9
coa-service migrations applied cleanly from empty), and doing so surfaced a real, previously-undetected
defect:

**Real defect found and fixed: `SequenceService.allocate()` was not safe under real Postgres concurrency.**
The BR213-1 test (20 concurrent `allocate()` calls against a cold counter row) failed with
`P2010`/`25P02 current transaction is aborted`. Root cause: the method did `findUnique` → `create` (racy —
on a cold row every concurrent caller observes no row and races to insert) → a separate
`UPDATE ... RETURNING` to claim a value. The 19 losing callers' `create()` unique-constraint violation was
caught by an empty `catch {}`, but catching the JS exception does not un-abort the underlying Postgres
transaction — once one statement in a transaction errors, Postgres aborts the whole transaction until an
explicit `ROLLBACK`/`ROLLBACK TO SAVEPOINT`, so every losing caller's subsequent `UPDATE` failed too. This
is a defect a mocked-Prisma unit test can never reproduce (JS is single-threaded; the fake never models a
real aborted-transaction state) — it only surfaces against a genuinely concurrent Postgres connection,
exactly why leaving these 5 tests permanently skipped would have been a real trust gap, not merely a
documentation gap.

**Fix:** replaced the two-statement find+create+update with a single atomic
`INSERT ... ON CONFLICT (tenant_id, source_code, entity_id, period_code) DO UPDATE SET
next_seq = next_seq + 1 ... RETURNING (next_seq - 1) AS claimed` — no statement in the sequence can fail
and abort the transaction, so every concurrent caller (whether racing to create the row or updating an
existing one) completes successfully with identical claim semantics to the original design. Updated
`tests/sequence.test.ts`'s in-memory fake `$queryRawUnsafe` to match the new call signature/semantics (all
13 sequence unit tests re-verified green).

**Final, corrected regression result:** re-ran the full coa-service suite against the same fresh ephemeral
Postgres 15 (`LIVE_DATABASE_URL` set, nothing skipped) **four consecutive times** to rule out flakiness in a
freshly-fixed concurrency path: **299/299 pass, 0 skipped, 0 failed, all four runs** — genuinely green, not
294/299-with-an-unexplained-skip. This defect and fix are unrelated to S220's own code (it lives in
`sequence-service.ts`, not `gl-inquiry-service.ts`) but were only uncovered because the previously-skipped
live-DB suite was actually executed while closing out S220's test-evidence gap; documented here rather than
silently folded into a later story's evidence.

