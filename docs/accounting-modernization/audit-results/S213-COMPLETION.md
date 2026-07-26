# S213 — Journal Numbering Sequences — COMPLETION

**Status:** DONE_PENDING_INTEGRATION
**Epic:** CE-03 · **Sprint:** 2 · **Level:** L1 · **Priority:** P0
**Owner service:** `coa-service` · **Package:** R0-ACCOUNTING-SETUP (8/8)

## Scope delivered
Atomic per-`source+entity+period` journal numbering with gap logging and a gap
report. This is the **numbering/sequencing primitive** consumed by the future
posting story (S013/S214) — it mints numbers and records gaps; it does **not**
post journals.

## Business rules
| Rule | Implementation |
|------|----------------|
| BR213-1 assignment atomic under concurrency | `allocate()` claims via single `UPDATE journal_sequence SET next_seq = next_seq + 1 RETURNING (next_seq-1)` (row-lock). Race-verified: 20 concurrent HTTP allocations → 20 distinct numbers against real Postgres; unit hammer 100 → contiguous 1..100. |
| BR213-2 number assigned at post, immutable after | Service is mint-only (never revises). Posted immutability is enforced by the S013/S214 posting path + schema (no update endpoint exposes the number). |
| BR213-3 gaps logged with reason; report available | `logGap()` writes `sequence_gap_log` (reason required); `GET /journals/gap-report` returns rows. Sequence continues past a gap (verified: #4 gapped, #5 allocated). |
| BR213-3 resets per period | New `periodCode` → new counter row starting at 1 (verified: 2026-02 → seq 1). |
| BR213-4 gapless pending UQ-12/19 | Current model is non-reserving (gap-logging). If UQ-12 mandates gapless, switch to a reservation model — isolated to `allocate()`. |

## Number format
`{SOURCE}-{YYYY-MM}-{seq:06d}` — **INTERIM** per UQ-12/19 (e.g. `GJ-2026-01-000001`).

## Endpoints (under `/api/v1/coa`)
- `POST /journal-sequences/allocate` `{sourceCode,entityId,periodCode}` → **200** `{journalNumber,seq,...}` — internal primitive (perm `je.sequence.allocate`).
- `POST /journal-sequences/log-gap` `{sourceCode,entityId,periodCode,seq,reason}` → **201** (perm `je.sequence.allocate`).
- `GET /journals/gap-report?entity=&period=` → **200** rows (perm `je.gap_report.view`).
- 4xx: 422 `INVALID_SOURCE_CODE` / `INVALID_PERIOD_CODE` / `MISSING_REASON`; 400 zod / missing tenant; 403 deny-by-default.

### Spec deviations (documented)
- Packet §9 says allocation is "internal to S013". Since S013 is not yet built, `allocate`/`log-gap` are exposed as **guarded HTTP handles** (dedicated `je.sequence.allocate` permission, not public) so BR213-1 atomicity is runtime-verifiable now. The S013 posting path will call `SequenceService.allocate()` in-process; the HTTP handle can be removed or locked to internal callers at that point.
- Routes mounted under `/api/v1/coa/...` (gateway-reachable, S210/S212 precedent); the report path matches the packet's `GET /journals/gap-report`.

## Events / audit
No new event — numbers ride on `acct.je.posted` (posting story). Gap logging
writes an audit record (`docType journal_sequence`, action `GAP_LOGGED`) via AuditPort.

## Data
Additive migration `20260724170000_add_journal_sequence` — `journal_sequence`
(UNIQUE(tenant, source, entity, period); CHECK period `^[0-9]{4}-[0-9]{2}$`,
next_seq ≥ 1) + `sequence_gap_log`. Applied + verified. Prisma models
`JournalSequence`, `SequenceGapLog`.

## Tests — `tests/sequence.test.ts` (11) · suite **119/119**
Allocate: sequential from 1 + interim format; upper-cases source; **BR213-1 race
hammer 100 → 100 distinct contiguous** (REGULATORY zero-duplicate); BR213-3
period reset → 1; independent source/entity scoping; 422 invalid source; 422
invalid period. Gaps: log gap + interim number + audit; failed-post gap while
sequence continues + report; 422 missing reason; report filters by entity/period.

## Live runtime evidence
```
(1) allocate GJ 2026-01 x3     GJ-2026-01-000001/000002/000003
(2) 20 concurrent RACE alloc   distinct numbers = 20   (BR213-1)
(3) alloc #4, gap #4, alloc #5 GJ-...-000004 → log-gap 201 → GJ-...-000005 (continues)
(4) period reset GJ 2026-02    GJ-2026-02-000001 (BR213-3)
(5) gap report 2026-01         GJ-2026-01-000004 reason="post aborted by user"
(6) invalid source             HTTP 422
(7) invalid period             HTTP 422
(8) empty reason (zod)         HTTP 400
(8b) whitespace reason         HTTP 422 MISSING_REASON
(9) missing tenant             HTTP 400
(10) api-gateway :3100         HTTP 200
```
DB: `journal_sequence` next_seq GJ/2026-01=6, GJ/2026-02=2, RACE/2026-01=21;
`sequence_gap_log` 1 row (GJ-2026-01-000004); `audit_outbox` 1 GAP_LOGGED.

## Integration gate (why DONE_PENDING_INTEGRATION)
- **AuthzPort** = static role→permission map (S207 replaces). Dev HTTP = ADMIN; 403 enforced in code.
- **AuditPort** = shared `audit_outbox` writes.
- **UQ-12** gapless decision (Sprint 2) may switch `allocate` to a reservation model; **UQ-19** informs reference-number parity — both isolated to `allocate()`.
- **allocate/log-gap** become in-process calls from the S013/S214 posting path; HTTP handles are interim.

## Files
- `prisma/migrations/20260724170000_add_journal_sequence/migration.sql`
- `prisma/schema.prisma` (`model JournalSequence`, `model SequenceGapLog`)
- `src/domain/journal-sequence.ts` (format + validators)
- `src/application/sequence-service.ts`
- `src/http/sequence-routes.ts`
- `src/index.ts` (DI + route wiring)
- `tests/sequence.test.ts`
- `openapi/journal-sequences.yaml`
