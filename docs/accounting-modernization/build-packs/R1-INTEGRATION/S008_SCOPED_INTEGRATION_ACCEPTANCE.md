# S008 — Scoped Integration Acceptance Record

**R1 Controlled Integration — Step 1D**
**Status**: `S008_INTEGRATED_AND_ACCEPTED_FOR_CONTINUED_INTEGRATION_WITH_DISCLOSED_LIMITATIONS`

This record is scoped acceptance for continued controlled integration only. It
is not a Wave-0, demonstration, or production-readiness certification, and it
does not claim final Product/Accounting-SME acceptance.

---

## 1. Integrated source commit

`r1-s008-period-close-control@6916c2ac0ab1c3b2eb6bcc6e290ff183242bab5b`

Source worktree/branch verified unchanged at this SHA as of this checkpoint
(clean working tree).

## 2. Integration branch and evidence commit

- Integration branch: `r1-integration`
- Evidence commit (Step 1C — isolated integrated-runtime certification
  evidence): `94de702a67011b902efccb2fe1144ff9242099ab`
- Prior evidence commit (Step 1B — integration evidence and known
  limitations): `dac08589892e67c4be2908fd9bd18e0be8316f33`

## 3. Production/test commits integrated

Cherry-picked cleanly from the S008 source branch onto `r1-integration`
(backend/DB/authz):

| Hash | Summary |
|---|---|
| `3d452cc` | S008 database enforcement layer (schema + migration: transition-allowlist trigger, posting-path/concurrency trigger, adjusting-immutability trigger, RLS, SECURITY DEFINER ledger-writer role, AMPR0–AMPR6 SQLSTATE contract) |
| `08affc2` | S008 domain, service and HTTP layer (soft-close/hard-close/reopen/reopen-hard-closed/lock endpoints, adjusting-entry attestation wiring, actor-spoofing fix on `open()`) |
| `6bb25d2` | S008 authorization catalogue (auth-service catalog_version 1.10.0) |
| `adcdc3f` | S008 RLS and privilege corrections (real defects found via live fresh-Postgres testing) |
| `bc335c2` | S008 transition allowlist and test correction |
| `1a1cf50` | S008 BR008-5 hard-close drafts-block + board enrichment (real defect fixed: `board()` sourced from S007 audit outbox instead of nonexistent fields) |
| `29d9f5c` | S008 live-db certification suite: concurrency, idempotency, RLS-negative, live-code PostingService proof — 19 new tests, all passing |
| `25319cd` | S008 route-level authz-guard coverage for all five permissions plus two-tier-separation proof — 102/102 passing |

Cherry-picked cleanly (Playwright):

| Hash | Summary |
|---|---|
| `aaa085b` | S008 Playwright lifecycle spec (full cycle + negative-permission) |
| `ce35c3f` | S008 Playwright spec fixes found by actually running it live |

Added directly on `r1-integration` during this integration pass (not
cherry-picks from the source branch):

| Hash | Summary |
|---|---|
| `9cb6aea` | test(e2e): S008 Playwright lifecycle spec (full cycle + negative permission) |
| `9003cba` | fix(e2e): S008 Playwright spec — 2 real bugs found by actually running it |
| `dac0858` | docs(r1): record S008 integration evidence and known limitations (Step 1B) |
| `94de702` | docs(r1): record S008 isolated integrated-runtime certification evidence (Step 1C) |

Deliberately **not** cherry-picked: the S008 documentation-history commits
(`31b242a`, `bae9cfe`, `22b317b`, `fd636f3`, `c71045e`, `762e2b4`, `6916c2a`).
Their final-file state was instead copied as a snapshot from source HEAD
`6916c2a` and hand-reconciled into the two shared status files
(`MODULE_STATE.json`, `STORY_CERTIFICATION_MATRIX.csv`) rather than importing
old branch history. See `dac0858`'s commit body and
`evidence/S008/P01_PACK_INTEGRATION_NOTE.md` for the full rationale, including
why later story-integration passes (S003/S009/S011/S032/S012) must diff their
own P01 build-pack changes against this snapshot rather than overwrite it.

Whole-branch merge of `r1-s008-period-close-control` was **not** performed.

## 4. Frontend hand-port summary

`apps/web/src/App.tsx` and `apps/web/src/api/client.ts` had diverged from
S008's base (Golden R0 nav-shell rewrite to NavRail/Breadcrumb/ContextBar in
`App.tsx`; unrelated API additions + CRLF line endings in `client.ts`), so
both were hand-ported rather than cherry-picked, via commit `258e136`
(`integrate(r1): add S008 period-control frontend to Golden R0 shell`),
source-attributed to `1ea0a6a`:

- **`App.tsx`**: added the `PeriodControl` import, the
  `/accounting/admin/periods` nav entry under the existing "Period Close"
  module, and the `/accounting/admin/periods` route. `NavRail`/`Breadcrumb`/
  `ContextBar`, the `AppModule` type, and Golden R0 `GLInquiry` routing were
  left untouched.
- **`client.ts`**: inserted the five S008 `goldenPathApi` methods
  (`softClosePeriod`, `hardClosePeriod`, `reopenPeriod`,
  `reopenHardClosedPeriod`, `lockPeriod`) immediately after `openPeriod`.
  204-handling, `listJournalSources`, `exportTrialBalance`,
  `exportAccountActivity`, and the file's CRLF line endings were preserved
  byte-for-byte elsewhere in the file.
- `PeriodControl.tsx` (new), the `FiscalPeriod.tsx` changes, and
  `S008_LIVE_GATEWAY_CERTIFICATION_REPORT.md` were carried over verbatim from
  source commit `1ea0a6a` (byte-identical, diff-verified).

## 5. Isolated runtime topology (Step 1C)

Fully isolated Docker Compose stack, Compose project `amacc-r1int-s008-cert`,
built fresh from `r1-integration@dac0858` (all 7 application images —
auth/tenant/coa/gl/audit-service, api-gateway, web — plus official
postgres:15/redis:7-alpine/rabbitmq:3-management-alpine), all ports remapped
into an unused 53xxx range, dedicated network/volume, `api-gateway`'s
`depends_on` trimmed to the 5 services this pass actually needs. Proven never
to share a network, volume, or port with the long-lived Final-R0 (13xxx) or
Golden-R0-cert (33xxx) stacks. Full topology, image IDs, and isolation proof:
`evidence/S008/integrated-runtime/ENVIRONMENT_MANIFEST.md`.

Isolated stack torn down and all its volumes removed after evidence capture;
confirmed absent from `docker ps -a` / `docker volume ls` / `docker network
ls` at this checkpoint.

## 6. Migration totals

**86/86 migrations applied, 0 errors**, against a genuinely fresh/empty
isolated Postgres (`\dt` returned no relations before replay):

| Service | Migrations applied | Last migration |
|---|---|---|
| auth-service | 17 | `20260728050000_extend_authz_catalog_s008_period_close` |
| tenant-service | 9 | `20260727000002_add_org_reparent_events` |
| coa-service | 20 | `20260728010000_s008_period_close_control` |
| gl-service | 33 | `20260728010006_drop_legacy_trial_balance_unique_gl_svc` |
| audit-service | 7 | `20260727100000_add_chain_verified_from` |

All S008 database objects (role, RLS policies, SECURITY DEFINER functions,
triggers, columns, permission keys, role grants) independently re-verified
present and correct on this fresh instance. Detail:
`evidence/S008/integrated-runtime/MIGRATION_REPLAY_REPORT.md`.

## 7. Service-test totals

- coa-service: 355/355 (24 live-db tests skipped without
  `LIVE_DATABASE_URL`)
- auth-service: 154/154
- `apps/web` and both service `tsc --noEmit` runs: clean
- `apps/web` production build: clean

## 8. S008 Playwright — 2/2

Clean-state run against the isolated stack (`tests/e2e/fiscal-period-close.spec.ts`):

```
2 passed (3.9s)
```

Full lifecycle (OPEN→SOFT_CLOSED→HARD_CLOSED-blocked-by-drafts→unblocked→
HARD_CLOSED→REOPEN_HARD_CLOSED→SOFT_CLOSED→HARD_CLOSED→LOCKED-terminal) and
the CLERK negative-permission case both passed. Detail:
`evidence/S008/integrated-runtime/PLAYWRIGHT_RESULTS.md`.

## 9. Golden R0 Playwright — 13/14

Final run, after two fixture corrections (below):

```
13 passed, 1 failed (26.4s)
```

## 10. Precise cause of the one Golden R0 failure

The failing test is the main 16-step journey
(`golden-path.spec.ts`), failing at the Trial Balance step
(entity `01`, `asOf 2026-02`). That step depends on "already-certified,
pre-seeded evidence data... from the S014/S222/S227 backend certification
sessions" (per the spec's own header comment) — historical GL postings
accumulated incrementally across many prior long-lived-stack sessions, not
creatable from a single deterministic seed step. This isolated instance's
`gl-service` has zero historical postings for that scope. Confirmed live in
the browser: the Trial Balance page renders its correct, non-error empty
state ("No accounts to display" / "Balanced" badge) — not a crash, not a
wrong response, not an S008 defect. Reproducing that historical dataset from
scratch was not attempted, per the established
`docs/accounting-modernization/PHASE4_FRESH_STACK_PLAYWRIGHT_EXCEPTION.md`
precedent. This is now tracked as `DEBT-INT-001` (see the debt register).

## 11. Full-E2E totals

```
57 discovered, 16 passed, 30 failed, 11 skipped
```

## 12. Categorized root causes for every failure class

| Cause | Tests affected | In S008/Golden-R0 scope? |
|---|---|---|
| Same gl-service historical-certification-evidence gap as item 10 | `golden-path.spec.ts` main journey (1) | Yes — already disclosed |
| S008's own dedicated-year spec (`fiscal-period-close.spec.ts`) re-run against an already-`LOCKED` (terminal-by-design) period from the earlier clean run in this same session | 1 | Yes — but the authoritative result is the clean-state 2/2 run in item 8, not this re-run artifact. This is the terminal-state protection working exactly as designed, not a regression. Tracked as `DEBT-INT-003`. |
| Missing fixture data specific to other, pre-existing R0 stories never in this pass's seed scope (canonical department seeds for S203, specific store/franchise data for S201, specific legal-entity records for S200, hardcoded assumptions in the ad-hoc `qa-review.spec.ts`) | `departments.spec.ts` (9), `stores.spec.ts` (5), `legal-entity.spec.ts` (4), `qa-review.spec.ts` (10) — 28 tests | No — unrelated pre-existing R0 feature suites, out of scope for S008 integration certification. Tracked as `DEBT-INT-002`. |

`franchises.spec.ts` (4/4) passed fully despite no dedicated franchise
fixture being seeded — its assertions tolerate the empty/default state.

Two real fixture gaps were found and fixed during this pass (both
run-configuration/fixture fixes, not product code changes): a missing
`60050 Office Supplies Expense` GL account, and the `psql()` test helper's
`PG_CONTAINER` defaulting to the long-lived stack instead of the isolated
one. Detail: `evidence/S008/integrated-runtime/PLAYWRIGHT_RESULTS.md` and
`FIXTURE_SEED_REPORT.md`.

No test's assertions were weakened, retried, or skipped to obtain a green
result.

## 13. Visual-regression result

**Passed.** Golden R0 `NavRail`/`Breadcrumb`/`ContextBar` intact on every
screen; Period Control usable with real live board state (real open-drafts
count, real `LOCKED` transition persisted from the Playwright run); CLERK
correctly denied twice with specific, permission-named messages; GL Inquiry
confirmed still routed to the goldenpath implementation; Trial
Balance/Balance Sheet/Income Statement confirmed still the Golden R0
implementations; no pre-convergence page restored. Full checklist:
`evidence/S008/integrated-runtime/VISUAL_REGRESSION_CHECKLIST.md`.

## 14. 200% zoom result

**Passed.** `ContextBar` text remained fully legible with no clipping or
overlap at `document.body.style.zoom='2'`, captured on the Period Control
empty state and the CLERK-denied state.

## 15. Product/Engineering decision allowing S003 integration

S008 is accepted for continued controlled integration. Basis: S008
Playwright 2/2 against the isolated integrated runtime; 86/86 migration
replay across five services with all S008 DB objects verified; COA/auth/live
PostgreSQL/authorization/TypeScript/build gates passed; Golden R0 shell and
converged routes preserved; visual regression and 200% zoom passed; no S008
production defect identified. The Golden R0 13/14 result does not block
continued integration because the single failure is the disclosed,
pre-existing gl-service historical-fixture gap (item 10), not an S008 defect.
The wider full-E2E failures do not block S003 integration because they are
root-caused to missing fixtures for unrelated, pre-existing R0 stories or to
known repeated-run state (item 12) — these remain recorded as
release-certification debt and do not waive any gap from final Wave-0 or
demonstration certification.

## 16. Final limitations

- BR008-6 (sequential close — hard-close blocked by an earlier still-open
  period) remains unimplemented and undecided (`DEBT-INT-004`).
- Historical GL certification fixture data is absent from a fresh stack,
  producing the Golden R0 13/14 result (`DEBT-INT-001`).
- Fixtures for unrelated, pre-existing R0 stories (S200/S201/S203, ad-hoc
  `qa-review.spec.ts`) remain incomplete, producing 28 of the 30 full-E2E
  failures (`DEBT-INT-002`).
- The S008 Playwright spec is not repeat-safe against a fixed fiscal
  year/period across multiple runs (`DEBT-INT-003`).
- Final Product/Accounting-SME acceptance of the Fiscal Period Management
  workflow is not claimed by this integration.

## 17. Work still required before combined-demo certification

- Resolve `DEBT-INT-001` through `DEBT-INT-004` (see
  `INTEGRATION_TEST_DATA_AND_CERTIFICATION_DEBT.md`).
- Obtain Product review and Accounting-SME confirmation of the Fiscal Period
  Management workflow (OPEN/SOFT_CLOSED/adjusting-entry/HARD_CLOSED/two-tier
  reopen/terminal LOCKED behavior).
- Achieve a full 14/14 Golden R0 Playwright pass on a fresh, disposable stack
  once `DEBT-INT-001` is resolved.
- Achieve a repeatable full-E2E pass once `DEBT-INT-002` and `DEBT-INT-003`
  are resolved.
- Reach an explicit decision and disposition on BR008-6 (`DEBT-INT-004`).
- Complete S003 (and remaining R1 vertical-slice stories) selective
  integration and their own scoped-acceptance checkpoints.

---

This record does not use, and must not be conflated with,
`S008_FULLY_CERTIFIED`, `WAVE_0_CERTIFIED`, `DEMO_READY`, or
`PRODUCTION_READY`.
