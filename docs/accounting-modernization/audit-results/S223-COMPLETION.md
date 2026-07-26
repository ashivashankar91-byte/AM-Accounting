# S223 — Configuration Framework — Completion Evidence

**Package:** R0-ACCOUNTING-SETUP · **Epic:** CE-01 · **Release:** R0 · **Priority:** P0
**Status:** DONE_PENDING_INTEGRATION
**Completed:** 2026-07-24
**Uses stubs:** yes — `AuditPort` stub (shared `audit_outbox` table, no S007 consumer yet); `AuthzPort` stub (static deny-by-default role map, swaps to real `/authz/check` when S207 integration lands here).

---

## 1. Scope delivered

A typed, scoped, effective-dated **configuration registry** — the single governed home
for every later policy toggle (posting mode, open-period limit, lockout threshold…),
replacing AMACC's single-row `GlSystemConfig` anti-pattern. Keys are catalog-controlled
(unknown keys are rejected), values are type-validated, and every scope
(`TENANT → ENTITY → STORE`) resolves most-specific-wins with a catalog default fallback.
Each change is effective-dated, audit-logged with before/after images, and emits a
`config.changed` event.

### Placement decision (spec deviation — recorded)

The package's home service is **`coa-service`**, promoted from an in-memory prototype
(no DB, no tests — exactly the persistence anti-pattern §7 prohibits) to a real
Prisma + vitest service. This mirrors the R0-ORG-FOUNDATION precedent where
`tenant-service` hosted an entire package's stories. It reuses the existing
docker-compose + api-gateway + rabbitmq wiring (port 3016) and directly retires the
prohibited prototype. Recorded here per packet §0 ("extend or refactor existing
components where safe").

| Layer | Artifact |
|-------|----------|
| Migration | `services/coa-service/prisma/migrations/20260724100000_add_config_framework/migration.sql` |
| Schema | `services/coa-service/prisma/schema.prisma` (`ConfigKeyCatalog`, `ConfigSetting`, `AuditOutboxEvent`, `CoaOutboxEvent`) |
| Domain | `services/coa-service/src/domain/config-catalog.ts` (typing + scope validation) |
| Service | `services/coa-service/src/application/config-service.ts` |
| Routes | `services/coa-service/src/http/config-routes.ts` |
| Events | `services/coa-service/src/infrastructure/event-publisher.ts` |
| Wiring | `services/coa-service/src/index.ts`; gateway `services/api-gateway/src/index.ts` (`/api/v1/config` → `coa-service:3016`) |
| Tests | `services/coa-service/tests/config.test.ts` (16 tests) |

---

## 2. Data model (additive, §8)

- **`config_key_catalog`** — catalog of allowed keys (BR223-4). `key` (PK), `type`
  (`BOOL|INT|ENUM|STRING`), `allowed_scope[]`, `enum_values[]`, `default_value`,
  `since_version`. Any key absent here is rejected `400`.
- **`config_setting`** — scoped, effective-dated value versions. `scope`
  (`TENANT|ENTITY|STORE`), `entity_id?`, `store_id?`, `value`, `effective_from`,
  `status` (`SCHEDULED → EFFECTIVE → SUPERSEDED`), `actor`, `superseded_at?`.
- **`audit_outbox`** — shared AuditPort stub table (created by S206; `CREATE TABLE
  IF NOT EXISTS` keeps the migration idempotent). Written with before/after images.
- **`coa_outbox_events`** — domain-event outbox for reliable `config.changed` delivery.

Migration applied and verified on the dev database — schema diff:

```
config_key_catalog   CREATE TABLE  (+ seed: 2 keys)
config_setting       CREATE TABLE  (+ 3 indexes)
audit_outbox         skipped (already exists — shared table)
coa_outbox_events    CREATE TABLE  (+ 1 index)
```

**Seeded catalog keys (interim, UQ-22 gates legacy `GlSystemConfig` keys — does not block the framework):**

| key | type | allowed scopes | default | consumer |
|-----|------|----------------|---------|----------|
| `je.posting_mode` | ENUM `direct\|review` | TENANT/ENTITY/STORE | `direct` | S013 posting |
| `fiscal.max_open_periods` | INT | TENANT/ENTITY | `2` | S209 periods |

---

## 3. API (§9)

Mounted under `/api/v1/config` (gateway `/api/v1/config` → `coa-service:3016`).
Deny-by-default via the `AuthzPort` stub — writes require `config.manage`, reads
`config.view`. Tenant scoping enforced on every query (`x-tenant-id`).

| Endpoint | Behavior |
|----------|----------|
| `GET /config/catalog` | `200 {keys[]}` — the registry of allowed keys |
| `GET /config/:key?entity=&store=` | `200 {value, resolvedScope}` · **`400 UNKNOWN_CONFIG_KEY`** |
| `PUT /config/:key` | `200 {value, scope, status, before}` · **`400` unknown-key** · **`422 INVALID_VALUE`** (type) · **`422 INVALID_SCOPE`** |

`config.changed` payload: `{eventId, key, scope, before, after, effectiveFrom, actor, ts, schemaV:1}`.

---

## 4. Tests (§12)

`AMACC_JWT_SECRET=test-secret npx vitest run` → **16 passed / 16**.

Scope-resolution matrix + effective-date flip + cache invalidation + audit/event + named negatives:

- `scope resolution matrix` › falls back to catalog default; tenant inherited by entity/store; entity overrides tenant; store is most specific (4)
- `effective-date flip` › future-dated value is SCHEDULED and observed only once its date arrives; immediate value is EFFECTIVE (2)
- `cache invalidation` › put() invalidates cached resolutions; invalidateAll() clears cache (2)
- `audit + event` › put() writes audit before/after and emits config.changed schemaV:1 (1)
- **negatives (7):** `400 unknown key` resolve + put (2); `422 type-invalid` non-integer INT + out-of-set ENUM (2); `422 scope-invalid` disallowed scope + ENTITY missing entityId + STORE missing storeId (3)

---

## 5. Runtime transcript (real dev DB, via api-gateway :3100 and coa-service :3016)

```
GET  /config/je.posting_mode                       → {value:"direct", resolvedScope:"DEFAULT"}
PUT  /config/je.posting_mode {TENANT, review}      → 200 {value:"review", status:"EFFECTIVE", before:"direct"}
GET  /config/je.posting_mode                       → {value:"review", resolvedScope:"TENANT"}
PUT  /config/je.posting_mode {ENTITY a246…, direct}→ 200 {value:"direct", before:"review"}
GET  /config/je.posting_mode?entity=a246…          → {value:"direct", resolvedScope:"ENTITY"}   ← inheritance override
GET  /config/je.posting_mode?entity=other-entity   → {value:"review", resolvedScope:"TENANT"}    ← inherits tenant
GET  /config/does.not.exist                        → 400 UNKNOWN_CONFIG_KEY
PUT  /config/je.posting_mode {value:"nope"}        → 422 INVALID_VALUE (ENUM)
PUT  /config/fiscal.max_open_periods {value:"abc"} → 422 INVALID_VALUE (INT)
PUT  /config/fiscal.max_open_periods {STORE,…}     → 422 INVALID_SCOPE (STORE not allowed)
GET  (via gateway :3100) /config/je.posting_mode?entity=a246… → 200 {resolvedScope:"ENTITY"}  ← gateway routing proof
```

DB evidence after the flows:

```
audit_outbox (doc_type=config_setting): PUT direct→review, PUT review→direct   (actor dev-user)
coa_outbox_events (config.changed):     direct→review schemaV=1, review→direct schemaV=1
config_setting:                         je.posting_mode TENANT review EFFECTIVE, ENTITY direct EFFECTIVE
```

---

## 6. OpenAPI diff

Added path group `/api/v1/config` (`GET /config/catalog`, `GET /config/{key}`,
`PUT /config/{key}`) with the `config.changed` event schema. Recorded in
`services/coa-service/openapi/config.yaml`.

---

## 7. Known limitations / integration gate

- **AuditPort stub** — writes the shared `audit_outbox` table; no real S007 consumer yet.
- **AuthzPort stub** — static deny-by-default role map; dev-mode `authMiddleware` injects
  `role: ADMIN`, so the `403` path is enforced in code and unit-covered but not exercised
  over HTTP in dev. Swaps to the real `/authz/check` adapter when S207 integrates here.
- **`config.changed` broker delivery** — RabbitMQ unavailable in dev → in-memory fallback;
  the outbox row is the durable record of truth. Real broker verification is a carry-forward
  integration gate.

### Integration-gate re-run checklist (to reach full DONE)

- [ ] Re-run `config.test.ts` integration variants against real S007 audit consumer.
- [ ] Swap `AuthzPort` stub → real S207 `/authz/check`; re-verify `config.manage`/`config.view`.
- [ ] Verify `config.changed` delivered over a real RabbitMQ broker (not in-memory).

---

## 8. Prohibited-behavior compliance (§7)

- ✅ No single-row unscoped config — replaced with scoped, versioned `config_setting`.
- ✅ No in-memory persistence for financial state — Prisma + Postgres; the prior
  in-memory `CoAService` prototype is scheduled for replacement by S210.
- ✅ Validation lives in one module (`config-catalog.ts`) used by read and write paths.
- ✅ Tenant/entity/store kept distinct — no tenant=entity=rooftop conflation.
