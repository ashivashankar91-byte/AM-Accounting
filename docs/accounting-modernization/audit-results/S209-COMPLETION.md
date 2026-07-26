# S209 — Accounting Period Open & Status — Completion Evidence

**Package:** R0-ACCOUNTING-SETUP (3 of 8)
**Epic:** CE-02 · **Sprint:** 2
**Status:** DONE_PENDING_INTEGRATION
**Completed:** 2026-07-24
**Host service:** `coa-service` (extends the S208 `fiscal_period` model)

---

## 1. Scope & Placement

S209 adds the period **open lifecycle** on top of the S208 fiscal calendar. It is
hosted in `coa-service` alongside S208 (same `/api/v1/fiscal` prefix), so the
calendar and its period status live in one bounded context. No new tables — the
S208 `fiscal_period` table is extended with two nullable audit columns and one
resolve index (additive migration only, per packet §8).

**In scope (this story):**
- `FUTURE -> OPEN` transition only (BR209-1). Close transitions (SOFT/HARD/LOCKED)
  are owned by S008/R1; their enum values ship now for S013.
- Concurrent-open limit (BR209-2) driven by config `fiscal.max_open_periods`.
- Skip-open warning + confirm (BR209-3).
- Posting-eligibility API and a status board.

---

## 2. Business Rules

| Rule | Implementation |
|------|----------------|
| BR209-1 — only FUTURE→OPEN | `canTransition()` legal-transition map; any other source status → `InvalidTransitionError` (422). Already-OPEN is an idempotent no-op. |
| BR209-2 — max N concurrent OPEN | `PeriodService.resolveMaxOpen()` reads `fiscal.max_open_periods` (S223 config, default 2) via `ConfigService`; count of OPEN ≥ max → `MaxOpenReachedError` (422). |
| BR209-3 — skip-open warning | `detectSkippedPeriods()` finds earlier, non-adjustment periods still FUTURE; without `confirm=true` returns `requiresConfirmation` with **no state change**; `confirm=true` proceeds. |
| Eligibility | `postable = (status === 'OPEN')`, with a human reason for every status. |
| Perms | AuthzPort stub: `fiscal.period.view`, `fiscal.period.open` (ADMIN/CONTROLLER manage; ACCOUNTANT view). |

Full status vocabulary shipped for S013: `FUTURE | OPEN | SOFT_CLOSED | HARD_CLOSED | LOCKED`.

---

## 3. Data Model (additive migration)

`services/coa-service/prisma/migrations/20260724120000_add_period_open/migration.sql`
— applied and verified on the dev DB:

```sql
ALTER TABLE fiscal_period ADD COLUMN IF NOT EXISTS opened_by TEXT;
ALTER TABLE fiscal_period ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_fiscal_period_entity_status
  ON fiscal_period(entity_id, status);
```

Prisma `FiscalPeriod`: `openedBy String? @map("opened_by")`, `openedAt DateTime? @map("opened_at")`, `@@index([entityId, status])`.

---

## 4. API

Served under `/api/v1/fiscal` (gateway `:3100` → coa-service `:3016`; no gateway change — prefix shared with S208).

| Method | Path | Perm | Result |
|--------|------|------|--------|
| GET | `/periods?entity=` | `fiscal.period.view` | Status board (all periods, ordered) |
| GET | `/periods/{id}/eligibility` | `fiscal.period.view` | `{ postable, reason }` |
| POST | `/periods/{id}/open` (`:open`) | `fiscal.period.open` | 200 opened / 200 skip-open warning / 422 / 404 |

**Event emitted:** `fiscal.period.opened` `{ eventId, entityId, periodCode, actor, ts, schemaV:1 }` (coa outbox row + publish).
**Consumes:** `fiscal.year.generated` (S208) — periods already materialized FUTURE; no action.

OpenAPI: `services/coa-service/openapi/period.yaml`.

---

## 5. Tests — 14/14 (full coa suite 50/50)

`services/coa-service/tests/period.test.ts` (in-memory fake Prisma + fake events + fake ConfigService via tsyringe):

- **Domain (4):** status enum, transition matrix (FUTURE→OPEN only), eligibility, skip detection.
- **Service happy (4):** open + event + audit, eligibility postable/ineligible, board, idempotent re-open (no new event).
- **Skip-open (2):** warn with no state change; `confirm=true` opens.
- **Negatives (4):** 422 `MAX_OPEN_REACHED`, 404 `PERIOD_NOT_FOUND`, 422 `INVALID_TRANSITION` (LOCKED), tenant-isolation.

---

## 6. Runtime Transcript (verified green)

coa-service `:3016` + gateway `:3100`, entity KUNES `a24612ec-…`, FY2026 periods from S208:

1. `POST /periods/{p1}/open` → `200 {opened:true,status:OPEN}`
2. `GET /periods/{p1}/eligibility` → `postable:true`
3. `GET /periods/{p3}/eligibility` → `postable:false, reason:"Period is FUTURE…"`
4. `POST /periods/{p3}/open` (no confirm, skips 2026-02) → `200 {opened:false, requiresConfirmation:true, warning:SKIP_OPEN, skippedPeriods:["2026-02"]}` — **no state change**
5. `POST /periods/{p2}/open` → `200 OPEN` (2 concurrent)
6. `POST /periods/{p3}/open` `confirm:true` → **`422 MAX_OPEN_REACHED`** (limit 2)
7. `POST /periods/{unknown}/open` → **`404 PERIOD_NOT_FOUND`**
8. `GET /periods?entity=` → 2026-01 OPEN/dev-user, 2026-02 OPEN/dev-user, 2026-03 FUTURE
9. `GET /periods?entity=` without `x-tenant-id` → **`400`**
10. Gateway `:3100` `GET /periods/{p1}/eligibility` → `postable:true`

**DB evidence:** `fiscal_period` 2 rows OPEN by `dev-user`; `audit_outbox` 2 `fiscal_period`/`OPEN` rows; `coa_outbox_events` 2 `fiscal.period.opened`.

---

## 7. Known Limitations / Integration Carry-Forward

- **AuthzPort / AuditPort are stubs** (static role map; shared `audit_outbox`). Real
  S207 authz + S007 audit replace these → gate to `DONE` after the integration suite
  re-runs green. Over dev HTTP, `authMiddleware` injects role `ADMIN`, so the 403
  path is unit-tested but not exercisable via dev HTTP.
- **Close transitions deferred** to S008/R1 — `SOFT_CLOSED`/`HARD_CLOSED`/`LOCKED`
  are valid enum values with no inbound transition yet.
- **Legacy eom-service `fiscal_periods` (plural)** still coexists (S208 carry-forward);
  consolidation is an integration-gate task.

## 8. Spec Deviations

- Skip-open warning returns **HTTP 200 with `requiresConfirmation`** (soft warn+confirm)
  rather than a distinct status code, staying within packet §9 codes (200/422/404).

## 9. Packet Compliance

- BR209-1/2/3 ✅ · eligibility + board ✅ · event `fiscal.period.opened` ✅ ·
  consumes `fiscal.year.generated` ✅ · perms `fiscal.period.open/view` ✅ ·
  additive migration only ✅ · FIGMA_REQUIRED — backend-only story, no UI (no waiver needed).
