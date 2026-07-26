# S010 — Seed Canonical COA Skeleton — COMPLETION

**Status:** DONE_PENDING_INTEGRATION
**Epic:** CE-03 · **Sprint:** 2 · **Level:** L0 · **Priority:** P0
**Owner service:** `coa-service` · **Package:** R0-ACCOUNTING-SETUP (6/8)

## Scope delivered
Idempotent, per-entity canonical Chart-of-Accounts skeleton loader. Seeds the
**BP 3.2** dealership skeleton (interim content per UQ-14, PO-signed assumption)
into the S210 `gl_account` table, merge-by-number (never overwrite), with a
diff-from-canonical report and a single `coa.seeded` domain event.

## Business rules
| Rule | Implementation |
|------|----------------|
| BR010-1 seed idempotent on re-run | `SeedService.seed()` skips existing numbers; re-run = 0 created / all merged. Verified live (run 2: created=0 merged=31). |
| BR010-2 includes types, normal balances, hierarchy | Manifest carries `type`/`normalBalance`/`postable`/`parentNumber`; `orderedForSeed()` creates parents first and resolves `parentId`. Contra accounts (12430, 15900) computed + `contraReason` set. |
| BR010-3 diff-from-canonical after customization | `diffFromCanonical()` → `{missing, divergent, extra}`. |
| BR010-4 seed content pending UQ-14 | Interim = **BP-3.2** skeleton (31 accounts). `MANIFESTS` registry allows adding the UQ-14-decided version without code changes to callers. |

## Endpoints (under `/api/v1/coa`)
- `POST /seed` `{entityId, manifestVersion?, actor?}` → **201** `{manifestVersion, created, merged, conflicts:[]}` — idempotent, merge-by-number, never overwrites.
- `GET /diff-from-canonical?entity=&manifestVersion=` → **200** `{manifestVersion, missing:[], divergent:[], extra:[]}`.
- Permission: **`coa.seed.run`** (deny-by-default AuthzPort stub; ADMIN/CONTROLLER granted).

### Spec deviation (documented)
Packet §9 uses colon-verb paths (`/coa:seed`, `/coa:diff-from-canonical`).
Rendered as path segments (`/coa/seed`, `/coa/diff-from-canonical`) for Fastify
prefix + api-gateway (`startsWith /api/v1/coa`) compatibility — functionally
identical. Consistent with the S210 `:deactivate` → `/deactivate` choice.

## Event
`coa.seeded` `{eventId, entityId, manifestVersion, createdCount, actor, ts, schemaV:1}`
— **one** event per seed run (not per-account). Written to `coa_outbox_events`
and published via `IEventPublisher`.

## Data
- Additive migration `20260724150000_add_coa_seed_run` — `coa_seed_run`
  (run audit: created/merged/conflict counts per entity). Applied + verified.
- Accounts seeded as bulk rows into existing `gl_account` (no DDL for accounts).
- Prisma model `CoaSeedRun` added to `coa-service` schema.

## Tests — `tests/seed.test.ts` (8) · suite **92/92**
Domain: parents-before-children ordering; summary non-postable + contra reason.
Service: full-skeleton seed w/ hierarchy + contra + `coa.seeded` (createdCount);
idempotent re-run; **AC-negative** merge-by-number conflict report never
overwrites; **§9 422** unknown manifest version. Diff: missing/divergent/extra;
all-missing on empty entity.

## Live runtime evidence
```
(1) seed fresh entity      created=31 merged=0  conflicts=0  version=BP-3.2
(2) re-run (idempotent)    created=0  merged=31 conflicts=0
(3) diff (clean)           missing=0  divergent=0 extra=0
(4) seed KUNES             created=29 merged=0  conflicts=2
      conflict 10000: name Current Assets≠Operating Cash; postable false≠true
      conflict 12430: name Allowance for Doubtful Accounts≠Allowance Doubtful
(5) diff KUNES             missing=0 divergent=2 extra=[49000,10100,10110]
(6) 422 unknown manifest   HTTP 422
(7) 400 missing tenant     HTTP 400
(8) api-gateway :3100      HTTP 200
```
DB: `coa_seed_run` 3 rows (31/0·0/31·29 w/2 conflicts); `coa_outbox_events`
3 × `coa.seeded` (createdCount 31/0/29); `audit_outbox` 3 × SEED; `gl_account`
31 rows for fresh entity. Pre-existing KUNES 10000/12430 **not overwritten**.

## Integration gate (why DONE_PENDING_INTEGRATION)
- **AuthzPort** = static role→permission map (S207 will replace). Dev HTTP runs as
  ADMIN; 403 path unit-tested but not exercisable over dev HTTP.
- **AuditPort** = shared `audit_outbox` writes (final audit service later).
- **UQ-14** seed content: interim BP-3.2; final canonical version swaps in via the
  `MANIFESTS` registry with no caller change.

## Files
- `prisma/migrations/20260724150000_add_coa_seed_run/migration.sql`
- `prisma/schema.prisma` (`model CoaSeedRun`)
- `src/domain/coa-blueprint.ts` (BP-3.2 manifest + helpers)
- `src/application/seed-service.ts`
- `src/http/seed-routes.ts`
- `src/index.ts` (DI + route wiring)
- `tests/seed.test.ts`
- `openapi/seed.yaml`
