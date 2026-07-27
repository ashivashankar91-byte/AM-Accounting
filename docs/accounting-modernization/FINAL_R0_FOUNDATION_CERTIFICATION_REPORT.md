# FINAL-R0 Foundation Certification Report

**Scope:** Final-R0 Foundation Completion gate (S205 + 12 individually-certified
stories: S201/S203/S204/S206/S223/S210/S211/S213/S214/S215/S216/S219), plus a
revalidation of the 9 previously-certified foundation stories (S010/S013/S200/
S207/S208/S209/S212/S217/S218) that this batch's evidence directly exercised or
depended on.

**Branch:** `final-r0` in `/Users/shivashankarangadi/Public/Projects/AM-Accounting-final-r0`
(isolated worktree; original `/Users/shivashankarangadi/Public/Projects/AM-Accounting`
worktree was never touched).

**Method:** every scenario below was executed against a real, locally-running
5-service stack (auth-service, tenant-service, coa-service, api-gateway,
audit-service) backed by real PostgreSQL (with row-level security enforced),
real RabbitMQ, real bcrypt password hashing, and real signed JWTs — no stubs,
no mocked authorization, no fabricated evidence. Every claim below is backed by
either a live HTTP transcript, a direct `psql` query, or a passing automated
test, all captured during this session.

---

## 1. Foundation status — 22 of 22 DONE

| Story | Title | Status | Batch |
|---|---|---|---|
| S200 | Legal Entity | DONE | (prior stabilization, re-verified Priority 1) |
| S201 | Store | DONE | Final-R0 Batch A |
| S203 | Department | DONE | Final-R0 Batch A |
| S204 | Franchise | DONE | Final-R0 Batch A |
| S205 | Login & Session | DONE | Final-R0 (dedicated pass, see §3) |
| S206 | Roles | DONE | Final-R0 Batch A |
| S207 | Centralized Authorization | DONE | (prior stabilization, re-verified) |
| S223 | Configuration | DONE | Final-R0 Batch A |
| S208 | Fiscal Calendar | DONE | (prior stabilization; exercised live as Batch B/C scaffolding) |
| S209 | Accounting Period | DONE | (prior stabilization; exercised live as Batch B/C scaffolding) |
| S210 | Chart of Accounts | DONE | Final-R0 Batch B |
| S211 | Account Hierarchy | DONE | Final-R0 Batch B |
| S010 | Canonical COA Seed | DONE | (prior stabilization) |
| S212 | Journal Source Registry | DONE | (prior stabilization; exercised live as Batch C scaffolding) |
| S213 | Journal Numbering | DONE | Final-R0 Batch B |
| S013 | Balanced Journal Posting | DONE | (prior stabilization; shared by S216) |
| S214 | Journal Draft | DONE | Final-R0 Batch C |
| S215 | Validate Journal | DONE | Final-R0 Batch C |
| S216 | Post Journal | DONE | Final-R0 Batch C |
| S217 | Journal View | DONE | (prior stabilization; exercised live in S216) |
| S218 | Journal Reversal | DONE | (prior stabilization; RLS-transaction defect fixed in this pass) |
| S219 | Void Journal | DONE | Final-R0 Batch C |

**No PARTIAL foundation stories. No DONE_PENDING_INTEGRATION foundation
stories.** Full per-story evidence is recorded in
`docs/accounting-modernization/stabilization/STORY_CERTIFICATION_MATRIX.csv`
and `docs/accounting-modernization/MODULE_STATE.json`
(`finalR0Certification` block per story).

---

## 2. Defect register (this Final-R0 pass)

All defects below were found through live evidence-gathering (not through
theoretical code review) and fixed before the affected story was certified.
Each has its own commit.

| # | Defect | Severity | Found while certifying | Commit |
|---|---|---|---|---|
| 1 | RLS tenant-context never set on pre-auth `/login`/`/logout` routes | Critical | S205 | `6e29469` |
| 2 | `grantAssignment()` wrongly rejected tenant-wide (`entityId=null`) grants | High | S205 | `6e29469` |
| 3 | Shared-kernel JWT signature bug: `digest('binary')` fed into UTF-8 `Buffer.from()` corrupted signatures with bytes ≥0x80 | Critical | S205 | `1ac91cc` |
| 4 | `HttpAuditClient` sent no auth header to audit-service, breaking outbox delivery once the dev-mode bypass was closed | High | S205 | `9d687f4` |
| 5 | S205 failed-login attempts generated no audit evidence (audit-gap) | High | S205 (directive Step 1) | `35be79e` |
| 6 | 5 test files (tenant-service/coa-service) hand-rolled a JWT signer using the same buggy `digest('binary')` pattern as defect #3, silently broken by the real fix and only caught when those suites were finally re-run | High (test-only) | Batch A prep | `8718931` |
| 7 | `AUTHZ_SERVICE_URL` not set when manually restarting tenant-service/coa-service, causing every S207-gated route to fail closed (`AUTHZ_SERVICE_UNAVAILABLE`) | Environment/ops, not code | Batch A | n/a (env-var checklist corrected, no code change) |
| 8 | **`/api/v1/iam/roles`, `/api/v1/iam/role-assignments`, `/api/v1/iam/users` had NO JWT verification at all** — trusted a raw, spoofable `x-user-id` header as caller identity, a full authentication bypass distinct from the Priority-0 NODE_ENV bypass | **Critical** | S206 | `3dbeb30` |
| 9 | **Every manual-journal-draft write (S214/S215/S216/S219) and journal reversal (S218) used Prisma's interactive `$transaction(async tx => ...)` form, whose queries run on a dedicated connection separate from the RLS middleware's `SET app.current_tenant_id` — a 100%-reproducible RLS violation (42501) on every write** | **Critical** | S214 | `72c4fb4` |

Defect #9 is flagged as a **repo-wide risk, not fully remediated**: the same
interactive-`$transaction` pattern was found (via `grep -rln '\$transaction(async'`)
in `apar-service`, `eom-service`, `fs-service`, and `gl-service`. None of those
are among the 22 foundation stories certified in this pass; they must be
audited for the identical RLS-bypass risk before any story living in those
services is certified.

---

## 3. S205 — dedicated certification

See `docs/accounting-modernization/S205_CERTIFICATION_REPORT.md` for the full
14-scenario + 9-audit-gap-scenario matrix (all PASS), including the later
addendum documenting defect #8's fix to `/iam/users`.

---

## 4. Batch A — S201 / S203 / S204 / S206 / S223

All 5 individually proved: positive workflow, real Postgres persistence,
validation failure, unauthorized denial (401), cross-tenant denial (403),
centralized S207 authorization, and audit evidence via `audit_logs`. S206
additionally closes defect #8. Full per-story evidence text is in
`STORY_CERTIFICATION_MATRIX.csv`. Commits: `3dbeb30` (defect fix), `64de928`
(certification docs).

## 5. Batch B — S210 / S211 / S213

Chart-of-Accounts CRUD, hierarchy (cycle detection, parent-must-be-summary,
effective-dated reparent), and gapless journal numbering (with explicit
gap-logging for failed posts) all proved live against real Postgres. A fiscal
calendar was defined and FY2026 periods generated/opened for the test legal
entity as realistic scaffolding, reused for Batch C. Commit: `1c2253b`.

## 6. Batch C — S214 / S215 / S216 / S219

The full manual-journal lifecycle (draft → validate → post → void) proved
live, including:
- BR013-1/4/5 business-rule enforcement (balance, account-postability,
  store/department dimensioning) surfaced identically on both validate and
  post (shared evaluator).
- Idempotent re-post and re-void (no duplicate ledger rows, no duplicate
  state transitions).
- `REVERSE_ONLY` business-rule denial correctly redirecting a void attempt on
  an already-posted draft toward the S218 reversal path instead.
- Real double-entry ledger persistence and a read-only journal view
  (immutable, balanced, dimensioned).

This batch is also where defect #9 (critical RLS-in-transaction bypass) was
found and fixed — every draft write had been failing 100% of the time before
the fix. Commits: `72c4fb4` (defect fix), `def0950` (certification docs).

---

## 7. Tests executed

- `auth-service`: 118/118 passing (includes S205's 28 login/audit-gap tests
  and S206's 26 role/user-route tests with real JWT harnesses).
- `tenant-service`: 154/154 passing (5 files' JWT-signer regression fixed).
- `coa-service`: 275/275 passing, 5 live-DB tests intentionally skipped
  outside a live-DB CI profile (includes the draft/validate/post/reverse/void
  suites re-verified after the RLS-transaction fix).
- Live-gateway manual scenario matrices: 14 (S205) + 9 (S205 audit-gap) + 5
  (S201) + 5 (S203) + 5 (S204) + 7 (S206) + 5 (S223) + 5 (S210) + 7 (S211) +
  7 (S213) + 5 (S214) + 4 (S215) + 6 (S216) + 5 (S219) = **89 live-gateway
  scenarios**, all executed against the real running stack and confirmed via
  either the HTTP response, a direct `psql` query with RLS tenant context set,
  or both.

## 8. Commit register (this Final-R0 continuation session)

| Commit | Description |
|---|---|
| `35be79e` | S205 audit-gap closure code + tests |
| `c16ebd1` | S205 certification docs |
| `8718931` | JWT test-signer regression fix (tenant/coa services) |
| `3dbeb30` | Critical `/iam/*` identity-spoofing fix (defect #8) |
| `64de928` | Batch A certification docs |
| `1c2253b` | Batch B certification docs |
| `72c4fb4` | Critical RLS-in-interactive-transaction fix (defect #9) |
| `def0950` | Batch C certification docs |

(Earlier commits from Priority 0/1/2 of this same Final-R0 execution —
`cf33db7`, `6755eb4`, `5cab1b7`, `de73f87`, `3704ac3`/`df8eb0c`, `6e29469`,
`1ac91cc`, `9d687f4` — are listed for completeness in prior checkpoints and
are not repeated here.)

---

## 9. Remaining blockers before `FINAL_R0_FOUNDATION_COMPLETION_PASSED`

Backend foundation certification (S205 + 12 stories, 22/22 DONE) is complete.
**Step 4 (frontend reconciliation + browser Golden Path) has not yet been
started** as of this report. The final gate verdict is withheld until Step 4
is genuinely complete and verified — see the session's final verdict message
for current status.
