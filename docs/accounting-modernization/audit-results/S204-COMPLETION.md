# S204 — Franchise Maintenance — Completion Evidence

**Package:** R0-ORG-FOUNDATION · **Epic:** CE-01 · **Release:** R0
**Status:** DONE_PENDING_INTEGRATION
**Completed:** 2026-07-24
**Uses stubs:** yes (AuditPort/AuthzPort emulated at app layer; real S007/S207 wiring at integration gate)

---

## 1. Scope delivered

Record which OEM brands (Ford, GM, Toyota, Stellantis, Honda, Nissan) each store
sells, with the official dealer code per brand, effective-dating, and buy/sell
(sold-franchise) end-dating — all tenant-isolated.

| Layer | Artifact |
|-------|----------|
| Migration | `services/tenant-service/prisma/migrations/20260724000001_add_franchises/migration.sql` |
| Schema | `services/tenant-service/prisma/schema.prisma` (`OemRef`, `Franchise` models) |
| Service | `services/tenant-service/src/application/franchise-service.ts` |
| Routes | `services/tenant-service/src/http/franchise-routes.ts` |
| Wiring | `services/tenant-service/src/index.ts`, `services/api-gateway/src/index.ts` |
| Web API | `apps/web/src/api/client.ts` (`oemApi`, `franchiseApi`) |
| Web UI | `apps/web/src/pages/admin/FranchisesSection.tsx`, `apps/web/src/pages/admin/StoreDetail.tsx` |

---

## 2. Data model

**`oem_ref`** (reference table) — `oem_code` PK, `display_name`, `dealer_code_pattern`
(regex), `dealer_code_hint`, `active`. Seeded with 6 launch OEMs.

**`franchises`** — `id` PK, `tenant_id`, `store_id`, `oem_code`, `dealer_code`,
`effective_from` (DATE), `effective_to` (DATE, nullable), `version`, timestamps.

Key constraint — partial unique index:

```
franchises_store_oem_active_key ON franchises(store_id, oem_code) WHERE effective_to IS NULL
```

Enforces **one active franchise per OEM per store** (409 on duplicate) while
permitting historical/sold rows (`effective_to` set) to coexist. Additive-only DDL —
no drops, renames, or type changes.

Launch OEM dealer-code patterns:

| OEM | Pattern | Confidence |
|-----|---------|-----------|
| FORD | `^[0-9]{5}$` | confirmed |
| GM | `^[0-9]{6}$` | confirmed |
| TOYOTA | `^[0-9]{5}$` | R0 baseline — SME_VALIDATION_PENDING |
| STELLANTIS | `^[0-9]{5}$` | R0 baseline — SME_VALIDATION_PENDING |
| HONDA | `^[0-9]{6}$` | R0 baseline — SME_VALIDATION_PENDING |
| NISSAN | `^[0-9]{6}$` | R0 baseline — SME_VALIDATION_PENDING |

The four pending patterns are recorded in `oem_ref.dealer_code_hint` and are the only
spec deviations for this story; they are safe R0 defaults pending SME confirmation.

---

## 3. Business rules verified

| Rule | Behavior | Error → HTTP |
|------|----------|--------------|
| Store must belong to tenant | reject otherwise | `StoreNotFoundForFranchiseError` → 404 |
| OEM must be on launch list | `oemRef.findFirst` | `UNKNOWN_OEM` → 422 |
| Dealer code must match OEM pattern | `_assertDealerCodeFormat` | `DEALER_CODE_FORMAT` → 422 |
| No duplicate active OEM per store | active-row probe | `DUPLICATE_OEM_PER_STORE` → 409 |
| Effective range sanity | `effective_to >= effective_from` | `INVALID_EFFECTIVE_RANGE` → 422 |
| Optimistic concurrency | version check on update | `VERSION_CONFLICT` → 409 |

Event `org.franchise.created` / `org.franchise.updated` written to
`tenant_outbox_events` with the §9 payload shape
`{ eventId, storeId, oemCode, dealerCode, effectiveFrom, actor, ts, schemaV: 1 }`.

Authorization: `acct.franchise.view` (all roles) and `acct.franchise.manage`
(ADMIN / CONTROLLER / SERVICE; ACCOUNTANT is view-only).

---

## 4. Test evidence

**Unit / route / isolation (vitest): 31 new, full suite 150/150 green.**

| Suite | Count | Focus |
|-------|-------|-------|
| `tests/franchise.test.ts` | 14 | launch set, create paths, list/getById, update |
| `tests/franchise-routes.test.ts` | 10 | authz, status-code mapping, zod validation |
| `tests/franchise-isolation.test.ts` | 7 | cross-tenant read/write denial |

**End-to-end (Playwright): 4/4 green** — `tests/e2e/franchises.spec.ts`
(section renders, add-form opens, bad dealer code → server 422 surfaced, add
franchise for available OEM → row appears).

**Runtime API transcript (Docker dev, api-gateway :3100):**

| Action | Result |
|--------|--------|
| `GET /api/v1/oems` | 200 — 6 OEMs |
| `POST .../franchises` Ford `54321` | 201 |
| unknown OEM | 422 UNKNOWN_OEM |
| duplicate Ford | 409 DUPLICATE_OEM_PER_STORE |
| GM 5-digit code | 422 DEALER_CODE_FORMAT |
| `GET .../franchises` | 200 — Ford listed |

Outbox row confirmed: `org.franchise.created` payload matches §9 exactly.

---

## 5. Integration-gate carry-forward

- Re-run franchise suite against real S007 (audit) and S207 (permission-check) services.
- Wire the `org.franchise.*` outbox consumer.
- Confirm/replace the four SME_VALIDATION_PENDING dealer-code patterns.
