# S218 — Reverse Posted JE — COMPLETION

**Status:** DONE_PENDING_INTEGRATION
**Service:** coa-service (ADR-JL-001 — journal lifecycle lives in coa-service)
**Endpoint:** `POST /api/v1/coa/journals/{id}:reverse`
**Completed:** 2026-07-24

## What was built
A posted mistake is corrected the honest, auditable way: the reversal is an
**equal-and-opposite (mirrored) posting through the single S013 door** with a
mandatory reason, linked both directions to the original. History is never
mutated — the original is flagged `REVERSED` and back-linked to its reversal.

### BR coverage
- **BR218-1** — reversal has **mirrored lines** (DR↔CR swapped, all other
  dimensions preserved: account, store, dept, control/apply numbers, memo),
  its **own journal number**, and `reversal_of` linkage. It is a normal posting,
  so consumers see `acct.je.posted` carrying `reversalOf`.
- **BR218-2** — an entry is **reversible once** (second attempt → 409
  `ALREADY_REVERSED` with `reversedBy` + `reversalNumber`). A **reversal is
  itself reversible** (reinstatement) and the result flags `reinstatement:true`.
- **BR218-3** — **reason mandatory (1–500)**, rejected 422 `REASON_REQUIRED`
  before anything is posted; rendered into both documents' memo.
- **Period guard** — target defaults to the original's period; an explicit
  `targetPeriod` must be a **same-or-later OPEN** period, else 422
  `CLOSED_TARGET_PERIOD` carrying `eligiblePeriods[]`.
- **Perm** — `je.reverse` (ADMIN/CONTROLLER/ACCOUNTANT; CLERK denied).

### REGULATORY property — Trial-Balance restoration
The headline test posts an original, records every account balance, reverses,
and asserts **each account balance returns exactly to its pre-post value** — the
mirrored deltas cancel. Also verified across a later target period (net-zero).

## Artifacts
- `src/application/reversal-service.ts` — `ReversalService.reverse()` +
  `ReversalReasonRequiredError` / `ReversalTargetNotFoundError` /
  `AlreadyReversedError` / `ClosedTargetPeriodError`.
- `src/http/journal-routes.ts` — `POST /journals/:target` colon-action
  dispatcher (`{id}:reverse`), gated `je.reverse`; reversal errors mapped in
  `handleError` (422/404/409/422).
- `src/index.ts` — `ReversalService` DI registration.
- `prisma/migrations/20260724220000_reversal_linkage_index/migration.sql` —
  additive `idx_journal_entry_reversed_by` (the `reversal_of`/`reversed_by`
  columns pre-exist from S013).
- `openapi/journals.yaml` — `POST /journals/{id}:reverse` + `ReverseRequest` /
  `ReverseResult` / `AlreadyReversed` / `ClosedTargetPeriod`.
- `tests/reverse.test.ts` — 10 tests.

## Tests
`tests/reverse.test.ts` — 10 new: REGULATORY TB-restoration property; BR218-1
mirrored + linkage + own-number; event + audit chain; BR218-3 reason 422 (no
post); BR218-2 double-reverse 409; BR218-2 reinstatement warned; closed-target
422 with `eligiblePeriods`; later-open-period reverse; 404 unknown id; tenant
scoping. **Full suite: 195 passed / 15 files.**

## Runtime evidence (gateway :3100, tenant-kunes)
- `POST journals/8c3a5d42…:reverse {"reason":"…"}` → **201** `GJ-2026-01-000009`,
  `reversalPeriod 2026-01`, `reinstatement:false`.
- Second reverse → **409** `ALREADY_REVERSED` `{reversedBy, reversalNumber:GJ-…-000009}`.
- `GET journals/GJ-2026-01-000007` → `status REVERSED`, `reversedBy → GJ-…-000009`.
- `GET journals/GJ-2026-01-000009` → `reversalOf → GJ-…-000007`, mirrored lines
  (`10000` cr 250 / `49000` dr 250). *(Fills the S217-deferred bidirectional
  linkage runtime demo.)*
- DB: `coa_outbox_events` `acct.je.posted` `payload.reversalOf = original`;
  `audit_outbox` chain `POSTED → REVERSED (rev_no GJ-…-000009) + REVERSAL_POSTED`;
  `journal_entry` original `REVERSED + reversed_by`, reversal `POSTED + reversal_of`.

## Known limitations / integration gates
- Masked-role paths unreachable at runtime until **S207** (dev auth hardcodes
  ADMIN) — covered by unit tests.
- Integration re-run against real **S007** audit port + broker-backed event
  verification remains pending (package-level gate).
