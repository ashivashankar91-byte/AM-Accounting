# S212 — Journal Source Registry — COMPLETION

**Status:** DONE_PENDING_INTEGRATION
**Epic:** CE-03 · **Sprint:** 2 · **Level:** L0 · **Priority:** P0
**Owner service:** `coa-service` · **Package:** R0-ACCOUNTING-SETUP (7/8)

## Scope delivered
Governed registry of journal origin codes — reserved system sources
(Service/Parts/Warranty/Payroll) + reserved manual codes (GJ/ADJ/YE/M13) +
tenant-added custom MANUAL sources — with `MANUAL|SYSTEM` class separation and
behavioral flags (`autoPost`, `yearEndOnly`, `thirteenthOnly`).

## Business rules
| Rule | Implementation |
|------|----------------|
| BR212-1 SYSTEM sources unusable by manual JE path | `assertUsableByManual()` → 422 `SYSTEM_SOURCE_NOT_MANUAL`; exposed as reusable `POST /journal-sources/assert-manual` (S214 JE path consumes it). Verified: SVC→422, GJ→200. |
| BR212-2 reserved codes immutable; tenants add MANUAL only | `create()` rejects `class=SYSTEM` (422 `CANNOT_CREATE_SYSTEM_SOURCE`); `update()`/`deactivate()` reject `reserved` (422 `RESERVED_SOURCE_IMMUTABLE`). |
| BR212-3 deactivation blocks new journals only | `deactivate()` ACTIVE→INACTIVE (idempotent, version++); reserved cannot be deactivated. |
| BR212-4 source on every journal/inquiry/report | Registry + guard primitive ready for JE/report stories (S214+). |
| BR212-5 code scheme pending UQ-13 | Interim mnemonic `code` (2-6 uppercase alnum) + reserved `numericAlias` column (legacy 88/3/90/91/30/32/40/95). |

## Endpoints (under `/api/v1/coa`)
- `POST /journal-sources` `{code,name,numericAlias?,flags?}` → **201** — MANUAL only.
- `POST /journal-sources/bootstrap-reserved` → **200** `{created,merged}` — idempotent reserved seeding.
- `POST /journal-sources/assert-manual` `{code}` → **200** `{usable}` | **422** BR212-1.
- `GET /journal-sources?class=&status=` → **200** (registry / source lookup for S214).
- `GET /journal-sources/:code` → **200** | **404**.
- `PATCH /journal-sources/:code` → **200** | **422** reserved-immutable.
- `POST /journal-sources/:code/deactivate` → **200** | **422** reserved.
- Permissions: `coa.source.manage` (write), `coa.source.view` (read) via deny-by-default AuthzPort stub.

### Reserved source set (adopted from GlSource evidence)
| code | alias | class | flags |
|------|-------|-------|-------|
| GJ | 88 | MANUAL | — |
| ADJ | 3 | MANUAL | — |
| YE | 90 | MANUAL | yearEndOnly |
| M13 | 91 | MANUAL | thirteenthOnly |
| SVC | 30 | SYSTEM | autoPost |
| PART | 32 | SYSTEM | autoPost |
| WARR | 40 | SYSTEM | autoPost |
| PAY | 95 | SYSTEM | autoPost |

### Spec deviations (documented)
- Registry mounted under `/api/v1/coa/journal-sources` (coa-service-owned, gateway-reachable) rather than a top-level `/journal-sources` route — no gateway change, consistent with S210/S010 placement.
- Reserved sources are system-defined via idempotent `bootstrap-reserved` (not tenant CRUD), enforcing BR212-2 "tenants add MANUAL only".
- `assert-manual` guard added so BR212-1 API enforcement is exercisable now and reused by the S214 manual JE path.

## Event
`coa.source.created|updated|deactivated` `{eventId, code, class, flags, actor, ts, schemaV:1}`
— `coa_outbox_events` + `IEventPublisher`.

## Data
Additive migration `20260724160000_add_journal_source` — `journal_source`
(CHECK code `^[A-Z0-9]{2,6}$`, class MANUAL|SYSTEM, status ACTIVE|INACTIVE;
UNIQUE(tenant_id, code)). Prisma model `JournalSource`. Applied + verified.

## Tests — `tests/source.test.ts` (16) · suite **108/108**
Create (MANUAL happy + event/audit; 422 SYSTEM; 422 code; 422 name; 409 dup;
flag adoption). Bootstrap (idempotent created→merged; MANUAL+SYSTEM reserved).
BR212-1 guard (SYSTEM→422; MANUAL→ok; INACTIVE→422). Reserved immutability
(update 422; deactivate 422). Update (name+flags+event). Deactivate (idempotent
+ single event). 404. List filters by class/status.

## Live runtime evidence
```
(1) bootstrap reserved      created=8 merged=0
(1b) re-bootstrap           created=0 merged=8   (idempotent)
(2) SYSTEM list             PART/PAY/SVC/WARR autoPost=true
(3) MANUAL list             ADJ,GJ,M13(13th),YE(YE),MISC(custom)
(4) assert-manual SVC       HTTP 422 (BR212-1)
(5) assert-manual GJ        {usable:true, class:MANUAL}
(6) PATCH GJ (reserved)     HTTP 422 RESERVED_SOURCE_IMMUTABLE
(7) create SYSTEM           HTTP 422 CANNOT_CREATE_SYSTEM_SOURCE
(8) deactivate MISC         INACTIVE v2 (BR212-3)
(9) deactivate SVC          HTTP 422 (reserved)
(10) duplicate GJ           HTTP 409
(11) unknown code           HTTP 404
(12) missing tenant         HTTP 400
(13) api-gateway :3100      HTTP 200
```
DB: `journal_source` 9 rows (8 reserved + MISC INACTIVE); `coa_outbox_events`
9 created + 1 deactivated; `audit_outbox` 2 BOOTSTRAP + 1 CREATE + 1 DEACTIVATE.

## Integration gate (why DONE_PENDING_INTEGRATION)
- **AuthzPort** = static role→permission map (S207 replaces). Dev HTTP = ADMIN; 403 unit-tested.
- **AuditPort** = shared `audit_outbox` writes.
- **UQ-13** final code scheme (SPIKE-05); **UQ-21** source-level security — interim build proceeds per packet §16.
- **BR212-1 UI path** + JE wiring land with the manual JE story (S214); the `assert-manual` guard is the enforcement primitive.

## Files
- `prisma/migrations/20260724160000_add_journal_source/migration.sql`
- `prisma/schema.prisma` (`model JournalSource`)
- `src/domain/journal-source.ts` (types, validators, RESERVED_SOURCES)
- `src/application/source-service.ts`
- `src/http/source-routes.ts`
- `src/index.ts` (DI + route wiring)
- `tests/source.test.ts`
- `openapi/journal-sources.yaml`
