# S013 — Balanced Journal Posting API — COMPLETION

Package: R0-JOURNAL-LIFECYCLE · Story: S013 · Status: **DONE_PENDING_INTEGRATION**
Service: `coa-service` (per ADR-JL-001) · Endpoint: `POST /api/v1/coa/journals`

## Summary
S013 delivers the single point of ledger truth: a balanced journal posting API that
resolves reference data, runs the shared rule engine (`domain/journal-posting.evaluate`
— the SAME engine S215 validate will call), and, only on a clean pass, persists the
entry, its lines, per-account balance updates, append-only balance snapshots, an
`acct.je.posted` outbox event and an audit-outbox record in ONE SERIALIZABLE
transaction. No AI review gate and no auto-approve (stripped per packet §7).

## Business rules implemented
| Rule | Meaning | Evidence |
|------|---------|----------|
| BR013-1 | sum(dr) = sum(cr) to the cent; exactly one side per line; ≥1 line | runtime #3 → 422; deferred DB trigger `trg_je_balanced` as final safeguard |
| BR013-2 | date resolves to an OPEN period (S208/S209) | runtime #4 (FUTURE) → 422 |
| BR013-3 | source found + active + caller-class matched (S212) | runtime #7 (INACTIVE) → 422 |
| BR013-4 | accounts active + postable + type present (S210) | runtime #5 (non-postable) → 422 |
| BR013-5 | every line has a store; P&L lines require a dept (UQ-16) | runtime #6 (missing dept) → 422 |
| BR013-6 | duplicate idempotencyKey returns the original (200) | runtime #2 → 200 idempotent:true |
| BR013-7 | posted entries are immutable (no update path; reversal only — S218) | structural: no PATCH/PUT route |
| BR013-8 | journal number minted from S213 sequence | runtime #1 → `GJ-2026-01-000006` |

Rejections are 422 `{ error: 'POSTING_REJECTED', violations: [{ rule, lineIndex?, field?, diagnostic }] }`
with **no partial write** (validation precedes the transaction; number allocation and
all inserts happen only after a clean evaluation).

## Artifacts
- `src/domain/journal-posting.ts` — pure evaluator (single rule source, integer-cents math)
- `src/application/posting-service.ts` — `PostingService.post()` (atomic persistence + outbox + audit)
- `src/lib/serializable-retry.ts` — SERIALIZABLE + bounded backoff (adopted from gl-service)
- `src/http/journal-routes.ts` — `POST /journals`, `je.post` permission (AuthzPort stub)
- `prisma/migrations/20260724180000_add_journal_posting/migration.sql` — `journal_entry`,
  `journal_line` (CHECK one-side), `balance_snapshot` (append-only), `je_check_balanced()`
  + deferred CONSTRAINT TRIGGER `trg_je_balanced`
- `openapi/journals.yaml` — OpenAPI 3.1 for `POST /journals`
- Tests: `tests/posting-rules.test.ts` (19 — named BR013 matrix + determinism), `tests/posting.test.ts` (6 — persistence, idempotency, no-partial-write)

## Test evidence
- Unit/integration: **25 new** (`posting-rules` 19, `posting` 6). Full coa-service suite **144 passed / 10 files**.
- Runtime (through API gateway :3100 → coa-service :3016):
  1. balanced JE → **201** `GJ-2026-01-000006`
  2. duplicate idempotencyKey → **200** idempotent:true (same number, single DB row)
  3. unbalanced → **422** BR013-1
  4. FUTURE period → **422** BR013-2
  5. non-postable summary account → **422** BR013-4
  6. P&L line missing dept → **422** BR013-5
  7. inactive source → **422** BR013-3
  8. missing x-tenant-id → **400**
- Ledger side-effects verified in Postgres: 1 `journal_entry` (POSTED 100/100), 2 `journal_line`,
  2 append-only `balance_snapshot` (delta 100 each), 1 `acct.je.posted` in `coa_outbox_events`,
  1 `JOURNAL_ENTRY/POSTED` in `audit_outbox`, `gl_account` balances + `has_postings` updated.
- DB safeguard: a direct unbalanced/lineless `POSTED` insert is rejected by the deferred
  trigger at COMMIT (transaction rolled back — nothing persisted).

## Money & tenancy
- All monetary columns NUMERIC(15,2); evaluator computes in integer cents. Legacy gl-service
  DOUBLE PRECISION lines are NOT carried forward (ADR-JL-001).
- Every query is tenant-scoped; `POST /journals` requires `x-tenant-id` (400 otherwise).

## Pending integration gates (carry-forward, not blocking S013 closure)
- **S007 AuditPort** — audit rows land in `audit_outbox`; real audit sink integration pending.
- **S207 AuthzPort** — `je.post` enforced via in-service role→permission stub; real authz pending.
- **Broker-backed event verification** — outbox row is durable + best-effort publish; RabbitMQ-
  verified delivery pending (dev falls back to in-memory bus).
