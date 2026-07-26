# S210 — Basic Chart of Accounts CRUD — Completion Evidence

**Package:** R0-ACCOUNTING-SETUP (4 of 8)
**Epic:** CE-03 · **Sprint:** 2
**Status:** DONE_PENDING_INTEGRATION
**Completed:** 2026-07-24
**Host service:** `coa-service`

---

## 1. Scope & Placement (SPIKE-01/02 outcome)

S210 delivers the entity-scoped account master that posting validation and every
report will trust. Per packet §5/§6 the gl-service `GLAccount` was inspected as the
reuse oracle, and per §7 it must **not** be ported as-is:

| gl-service `gl_accounts` (legacy) | Required by S210 |
|---|---|
| `@@unique([tenantId, code])` — tenant-scoped | number unique **per entity** (BR210-1) |
| no type-immutability | type immutable after posting (BR210-2) |
| `isActive` boolean only | ACTIVE/INACTIVE status + `version` |
| no contra-reason capture | contra override requires reason (BR210-3) |

**Decision (rewrite, entity-dimensioned):** a new `gl_account` table (singular) is
owned by coa-service, mirroring the S208 precedent (`fiscal_period` vs legacy
`fiscal_periods`). The legacy `gl_accounts` (plural) coexists; consolidation is an
integration-gate task. The in-memory `/api/v1/coa` prototype (prohibited
"in-memory persistence for financial state") is superseded by the Prisma-backed
account CRUD; the old read-only standard-COA/OEM-mapping helper is retained for
S010 seeding (it holds no financial CRUD state).

---

## 2. Business Rules

| Rule | Implementation |
|------|----------------|
| BR210-1 number unique per entity | `@@unique([entityId, accountNumber])` + `uq_gl_account_entity_number`; duplicate → `DuplicateAccountError` (409). |
| BR210-2 type immutable after posting | `update()` rejects a type change when `hasPostings` → `TypeImmutableError` (422). |
| BR210-3 normal balance defaulted by type, contra needs reason | `defaultNormalBalance()`; non-default → `isContra=true` and a non-empty `contraReason` is mandatory else `CONTRA_REASON_REQUIRED` (422). |
| BR210-4 deactivation blocked while balance != 0 | `deactivate()` → `NonZeroBalanceError` (422) carrying `balance`. |
| BR210-5 non-postable summary accounts reject journal lines | `postable` flag persisted; enforced at S013 posting. |
| Perms | AuthzPort stub: `coa.account.view`, `coa.account.manage`. |

Account number = 5 digits (`^\d{5}$`, UQ-14 may extend); name 1–120; types
ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE; normalBalance DR/CR.

---

## 3. Data Model (additive migration)

`services/coa-service/prisma/migrations/20260724130000_add_gl_account/migration.sql`
— applied and verified on the dev DB. Table `gl_account` with CHECK constraints
(number 5-digit, type ∈ 5, normal_balance ∈ DR|CR, status ∈ ACTIVE|INACTIVE),
`UNIQUE(entity_id, account_number)`, indexes on tenant / tenant+entity /
entity+status. `balance` NUMERIC(15,2) and `has_postings` are maintained by the
S013 posting path (default 0/false here). Prisma model `GlAccount @@map("gl_account")`.

---

## 4. API (served under `/api/v1/coa`; gateway `:3100` → coa-service `:3016`)

| Method | Path | Perm | Result |
|--------|------|------|--------|
| POST | `/accounts` | manage | 201 / 409 dup / 422 validation |
| GET | `/accounts?entity=&status=` | view | COA browser |
| GET | `/accounts/{id}` | view | 200 / 404 |
| PATCH | `/accounts/{id}` | manage | 200 / 422 type-immutable / 404 |
| POST | `/accounts/{id}/deactivate` (`:deactivate`) | manage | 200 / 422 `{balance}` / 404 |

**Events:** `coa.account.created|updated|deactivated` `{eventId,entityId,accountNumber,changes,actor,ts,schemaV:1}` (coa outbox + publish). **Consumes:** none.
OpenAPI: `services/coa-service/openapi/accounts.yaml`.

---

## 5. Tests — 21/21 (full coa suite 71/71)

`services/coa-service/tests/account.test.ts` (in-memory fake Prisma + fake events via tsyringe):

- **Domain (4):** types, default normal balance, contra flag, 5-digit validation.
- **Create (3):** 10000 Cash ASSET/DR postable, REVENUE→CR default, contra 12430 with reason.
- **Negatives (9):** 409 duplicate; same-number-different-entity allowed; 422 CONTRA_REASON_REQUIRED; 422 invalid number; 422 invalid type; 422 TYPE_IMMUTABLE_AFTER_POSTING; 422 NONZERO_BALANCE (carries balance); 404 ACCOUNT_NOT_FOUND; tenant-isolation.
- **Update/deactivate (5):** rename+version bump+event changes; type change with no postings; deactivate zero-balance→INACTIVE; idempotent re-deactivate; list ordered+status-filtered.

---

## 6. Runtime Transcript (verified green)

coa `:3016` + gateway `:3100`, entity KUNES `a24612ec-…`:

1. `POST /accounts` 10000 Cash ASSET → `201` DR/postable/ACTIVE/v1
2. `POST /accounts` 49000 REVENUE → CR (default)
3. `POST /accounts` 12430 ASSET/CR + reason → `isContra:true`, reason captured
4. duplicate 10000 → **`409 DUPLICATE_ACCOUNT_NUMBER`**
5. contra CR w/o reason → **`422 CONTRA_REASON_REQUIRED`**
6. (posting state simulated: 10000 `has_postings=true`, 49000 `balance=250`) PATCH type on 10000 → **`422 TYPE_IMMUTABLE_AFTER_POSTING`**
7. PATCH rename 10000 → `200` name "Operating Cash", v2
8. deactivate 49000 (balance 250) → **`422 NONZERO_BALANCE {balance:"250"}`**
9. deactivate 12430 (balance 0) → `200 INACTIVE`
10. GET unknown id → **`404`**
11. gateway `:3100` browser list → 10000 ASSET DR ACTIVE / 12430 ASSET CR INACTIVE / 49000 REVENUE CR ACTIVE

**DB evidence:** `gl_account` 3 rows; `audit_outbox` 5 `gl_account` rows (3 CREATE + 1 UPDATE + 1 DEACTIVATE); `coa_outbox_events` 3 created + 1 updated + 1 deactivated.

---

## 7. Known Limitations / Integration Carry-Forward

- **AuthzPort / AuditPort are stubs** (static role map; shared `audit_outbox`) →
  gate to `DONE` after the integration suite re-runs green against real S207/S007.
  Dev HTTP injects role ADMIN, so the 403 path is unit-tested but not HTTP-exercisable.
- **`balance` / `hasPostings`** are set by the S013 posting path (not built);
  the runtime transcript simulates them via direct DB updates to exercise BR210-2/4.
- **`parentId`** column ships nullable for S211 hierarchy; no hierarchy logic here.
- **Legacy gl-service `gl_accounts`** coexists — consolidation is an integration-gate task.

## 8. Spec Deviations

- Rewrite (not port) of the gl-service model to add the entity dimension +
  immutability + version/status, per packet §7. Standard-COA helper retained.

## 9. Packet Compliance

- BR210-1..5 ✅ · field inventory + validation ✅ · endpoints `/coa/accounts` CRUD + `:deactivate` ✅ ·
  events created/updated/deactivated ✅ · perms `coa.account.manage/view` ✅ · additive migration ✅ ·
  every §9 4xx path has a named test ✅ · FIGMA_REQUIRED — no interim UI shipped (no widget; backend-only PR, no waiver consumed).
