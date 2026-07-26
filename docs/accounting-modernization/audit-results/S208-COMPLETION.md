# S208 — Fiscal Calendar Definition — Completion Evidence

**Package:** R0-ACCOUNTING-SETUP | **Epic:** CE-02 | **Sprint:** 2
**Status:** DONE_PENDING_INTEGRATION (AuditPort + AuthzPort stubs in use)
**Completed:** 2026-07-24
**Host service:** `coa-service` (accounting-setup consolidation; see §1)

---

## 1. Scope & placement decision (spec deviation)

The packet classifies the existing `FiscalPeriod` model as **Reuse After Refactoring**
(§5/§6). The prototype lives in **eom-service** (`fiscal_periods`, created by FIX-021
from COBOL `KOMFCAL`) and is **tenant-scoped** — the exact `tenant = legal entity`
conflation packet §0/§7 forbid, and it mixes calendar definition with open/close status.

**Decision:** Build the governed S208 calendar in **coa-service**, the service already
hosting this package's configuration framework (S223) and the downstream consumers
S209 (period status, reads `fiscal.max_open_periods`) and S210/S211 (chart of accounts).
This keeps period state in a single owner alongside its consumers (packet §7: "do not
scatter period state") and refactors the prototype to **per-entity** scope.

- New tables: `fiscal_calendar`, `fiscal_period` (distinct from the legacy plural
  `fiscal_periods`, which remains owned by eom-service for later close stories).
- **Carry-forward (integration gate):** the legacy `fiscal_periods` and the new
  `fiscal_period` temporarily coexist. Consolidating eom-service onto this governed
  owner is an integration-gate task tracked with the S007/S207 re-run.

---

## 2. Business rules implemented

| Rule | Implementation |
|---|---|
| BR208-1 one calendar per entity | `fiscal_calendar` UNIQUE(entity_id); `defineCalendar` upserts |
| BR208-2 generation creates FUTURE periods | `generateYear` writes all rows `status='FUTURE'` in one `$transaction` |
| BR208-3 13th flagged adjustments_only | `TWELVE_PLUS_13TH` emits period 13, `adjustmentsOnly=true` |
| BR208-4 structure immutable after postings | structure/month change blocked (422 CALENDAR_LOCKED) when any period `has_postings=true` |
| BR208-5 deterministic date→period API | `resolve()` — monthly tiling guarantees exactly one match; 13th excluded |

## 3. Data model (`services/coa-service/prisma/migrations/20260724110000_add_fiscal_calendar/migration.sql`)

- `fiscal_calendar {id, tenant_id, entity_id, fy_start_month(1-12 CHECK), structure(CHECK TWELVE|TWELVE_PLUS_13TH), status(CHECK DEFINED|LOCKED), actor, created_at, updated_at, locked_at}` — UNIQUE(entity_id).
- `fiscal_period {id, tenant_id, entity_id, calendar_id FK, fiscal_year, period_number(1-13 CHECK), code, start_date, end_date, status, adjustments_only, has_postings, created_at}` — UNIQUE(entity_id, code), UNIQUE(entity_id, fiscal_year, period_number), resolve index (entity_id, start_date, end_date).
- Additive only (`CREATE TABLE IF NOT EXISTS`). **Applied + verified on dev DB** (schema `\d+` confirmed; CHECK constraints + FK present).

## 4. API (`/api/v1/fiscal`, via gateway → coa-service:3016)

| Method | Path | Perm | Success | Negatives |
|---|---|---|---|---|
| POST | `/entities/{id}/fiscal-calendar` | manage | 201 create / 200 update | 400 bad input; 422 CALENDAR_LOCKED |
| GET | `/entities/{id}/fiscal-calendar` | view | 200 | 404 CALENDAR_NOT_FOUND |
| POST | `/entities/{id}/fiscal-calendar/years` (:generateYear) | manage | 201 [12\|13 periods] | 409 FISCAL_YEAR_OVERLAP; 404 no calendar |
| GET | `/entities/{id}/periods` | view | 200 | — |
| GET | `/entities/{id}/periods/resolve?date=` | view | 200 {periodCode} | 400 bad date; 404 PERIOD_NOT_FOUND |

Event: `fiscal.year.generated {eventId, entityId, fy, periodCount, actor, ts, schemaV:1}`.
OpenAPI: `services/coa-service/openapi/fiscal.yaml`.

## 5. Tests — 20/20 pass (`services/coa-service/tests/fiscal.test.ts`)

Strategy: in-memory fake Prisma + fake event publisher via tsyringe (unit-level; the
real `audit_outbox`/`coa_outbox_events` rows are the Docker runtime evidence, §6).

- **Domain generation (5):** Jan-start 12 periods correct ranges; 12+13 (13th adjustments-only); leap-year Feb 2028=29 days; July-start calendar-year crossover; contiguous tiling (property, no gaps).
- **Domain resolution (4):** 2026-08-15→2026-08; month boundaries; 13th excluded (2026-12-31→2026-12); out-of-range→null.
- **Service happy (4):** define+audit; generate 13 FUTURE + emit event + outbox; live resolve; structure change before postings (200).
- **Named negatives (7):** 422 INVALID_STRUCTURE; 422 INVALID_START_MONTH; 409 FISCAL_YEAR_OVERLAP; 422 CALENDAR_LOCKED (BR208-4); 404 CALENDAR_NOT_FOUND; 404 PERIOD_NOT_FOUND; tenant isolation.

Full suite (config + fiscal): **36/36 pass.**

## 6. Runtime transcript (Docker; gateway :3100 + coa :3016)

| Step | Result |
|---|---|
| GET calendar (none) | 404 |
| POST define Jan 12+13 | 201 DEFINED |
| POST generate FY2026 | 201, count 13, first `2026-01` FUTURE, 13th `2026-13` adjustmentsOnly=true |
| resolve 2026-08-15 | `2026-08` (period 8) |
| resolve 2026-12-31 | `2026-12` (13th excluded) |
| regen FY2026 | 409 FISCAL_YEAR_OVERLAP |
| bad structure | 400 VALIDATION_ERROR |
| bad month 13 | 400 |
| resolve 2030-05-05 | 404 PERIOD_NOT_FOUND |
| missing x-tenant-id | 400 |
| resolve missing date | 400 |
| **gateway :3100 resolve** | `2026-08` (routing proof) |

**DB evidence:** `fiscal_calendar` 1 row (KUNES entity, 12+13, DEFINED); `fiscal_period`
13 rows (`2026-01`..`2026-13`, 13th `adjustments_only=t`, periods FUTURE);
`audit_outbox` 2 `fiscal_calendar` rows (CREATE + GENERATE_YEAR); `coa_outbox_events`
1 `fiscal.year.generated` (fy=2026, count=13, schemaV=1).

## 7. Known limitations / integration-gate re-run checklist

- **AuditPort stub** — writes shared `audit_outbox`; swap to real S007 consumer, re-run integration suite.
- **AuthzPort stub** — static deny-by-default role map; dev `authMiddleware` injects role=ADMIN so the 403 path is unit/code-enforced only. Swap to real `/authz/check` (S207) and re-run.
- **Broker verification** — `fiscal.year.generated` published best-effort; validate over a live RabbitMQ broker at the gate (outbox row is the record of truth).
- **Legacy `fiscal_periods` coexistence** — consolidate eom-service onto this governed owner (see §1).
- **13th-period posting semantics (UQ-20)** — flag-only per packet; posting behavior deferred (does not block generation).
- **FIGMA_REQUIRED** — backend-only story; no interim UI shipped (no PO waiver needed).

## 8. Packet §7 compliance

No AI gate in any path; no auto-approve; **tenant≠entity** (per-entity scope, the core
refactor); financial state persisted in Postgres (no in-memory persistence); no seeded
mock data; the resolution API is the single deterministic path consumed by posting.
