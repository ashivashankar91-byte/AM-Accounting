# S211 — Account Hierarchy & Totaling Groups — Completion Evidence

**Package:** R0-ACCOUNTING-SETUP (5 of 8)
**Epic:** CE-03 · **Sprint:** 3
**Status:** DONE_PENDING_INTEGRATION
**Completed:** 2026-07-24
**Host service:** `coa-service`

---

## 1. Scope

Adds a single-parent account hierarchy on top of the S210 `gl_account` master so
TB/BS/IS can render structured subtotals from governed data (not report code).
`gl_account.parent_id` already shipped nullable in S210; S211 makes re-parenting
effective-dated, cycle-safe, depth-bounded, and adds a nested tree read model.

Per packet §6 the legacy `subtotal_group_1/2/3 + allow_posting` model was inspected;
it is a flattened FS artifact, not a real tree. S211 uses an explicit single-parent
link (`parent_id`) — the totaling model is data, resolving the UQ-14 question in
favour of a tree over group columns.

---

## 2. Business Rules

| Rule | Implementation |
|------|----------------|
| BR211-1 single-parent tree, cycles impossible | `parent_id` is a single column; `wouldCreateCycle()` rejects self/descendant targets → `CycleError` (422). |
| BR211-2 subtotal nodes reject postings | A re-parent target must be non-postable (`postable=false`) → `ParentNotSummaryError` (422); postings into summary nodes are rejected at S013 via the persisted `postable` flag. |
| BR211-3 re-parenting effective-dated | `parent_effective_from` on the account + append-only `gl_account_reparent` trail carrying `effectiveFrom` (defaults to now). |
| Depth guard ≤ 6 | `projectedMaxDepth()` (new parent depth + subtree height) → `MaxDepthError` (422). |
| Unknown parent | `ParentNotFoundError` (422) when the target is not in the account's entity. |
| Perms | AuthzPort stub: `coa.account.manage` (tree edit), `coa.account.view`. |

---

## 3. Data Model (additive migration)

`services/coa-service/prisma/migrations/20260724140000_add_account_hierarchy/migration.sql`
— applied and verified on the dev DB:
- `ALTER TABLE gl_account ADD COLUMN parent_effective_from TIMESTAMPTZ`
- `CREATE TABLE gl_account_reparent` (id, tenant_id, entity_id, account_id, old_parent_id, new_parent_id, effective_from, actor, created_at) + 2 indexes
- `CREATE INDEX idx_gl_account_entity_parent ON gl_account(entity_id, parent_id)`

Prisma: `GlAccount.parentEffectiveFrom`, new model `GlAccountReparent @@map("gl_account_reparent")`.

---

## 4. API (served under `/api/v1/coa`)

| Method | Path | Perm | Result |
|--------|------|------|--------|
| PATCH | `/accounts/{id}` (body `{parentId, effectiveFrom}`) | manage | 200 / 422 cycle · non-summary · max-depth · unknown-parent |
| GET | `/tree?entity=` | view | nested hierarchy (roots first, children by number) |

The PATCH endpoint is polymorphic: a body containing `parentId` triggers the
effective-dated re-parent path; otherwise it is the S210 field update.

**Events:** `coa.account.reparented` `{eventId,accountId,oldParentId,newParentId,effectiveFrom,actor,ts,schemaV:1}` (coa outbox + publish). **Consumes:** none.
OpenAPI: `services/coa-service/openapi/accounts.yaml` (updated same PR).

---

## 5. Tests — 13 new (full coa suite 84/84)

`services/coa-service/tests/tree.test.ts` (in-memory fake Prisma + fake events):

- **Domain (4):** buildTree nesting+ordering; `wouldCreateCycle` self/descendant/ancestor/detach; `depthOf` root=1; `projectedMaxDepth` includes subtree height.
- **Re-parent happy path (4):** leaf under summary — effective-dated, event + audit + trail row; detach to root; no-op when unchanged (no trail row); `tree()` nested.
- **Negatives (5):** 422 self-parent cycle; 422 descendant cycle; 422 non-summary parent (BR211-2); 422 unknown parent; 422 max-depth (chain of 6 + 1).

Property AC "TB subtotals foot" is satisfied by the tree-shape property tests
(structured nesting from one governed link).

---

## 6. Runtime Transcript (verified green)

coa `:3016` + gateway `:3100`, entity KUNES `a24612ec-…`:

1. `POST /accounts` 10100 "Cash & Equivalents" `postable:false` → summary node
2. `PATCH /accounts/{10000}` `{parentId:10100, effectiveFrom:2026-01-01}` → `200`, parentId set, v3
3. `GET /tree` → `10100 → [10000]` (nested); 12430 / 49000 roots
4. `POST /accounts` 10110 summary under 10100; then `PATCH /accounts/{10100}` `{parentId:10110}` → **`422 CYCLE_DETECTED`** (descendant)
5. `PATCH /accounts/{10000}` `{parentId:49000}` (postable) → **`422 PARENT_NOT_SUMMARY`**
6. `PATCH /accounts/{10000}` `{parentId:<ghost>}` → **`422 PARENT_NOT_FOUND`**
7. 3-level tree renders: `10100(SUM) → 10000(post), 10110(SUM)`
8. gateway `:3100` `GET /tree` → same roots

**DB evidence:** `gl_account_reparent` 1 row (account 10000, old_parent null → new_parent set); `coa_outbox_events` 1 `coa.account.reparented`; `audit_outbox` REPARENT row.

---

## 7. Known Limitations / Integration Carry-Forward

- **AuthzPort / AuditPort are stubs** → gate to `DONE` after the integration suite
  re-runs green against real S007/S207. Dev HTTP injects role ADMIN (403 path unit-only).
- **Posting-to-summary rejection (BR211-2)** is enforced at S013 (not built) via the
  persisted `postable=false` flag; S211 only guarantees summary nodes are the parents.
- **`effectiveFrom`** is recorded (trail + marker column) but not yet time-travelled by
  reports; statement-line mapping is S009/R1 (out of scope per §2).
- **Alternate rollup trees** are out of scope (not planned R0).

## 8. Spec Deviations

- Chose an explicit single-parent `parent_id` tree over the legacy
  `subtotal_group_1/2/3` columns (packet §6 "Reuse After Validation" — validation
  concluded the group columns are an FS artifact, not the totaling model).

## 9. Packet Compliance

- BR211-1/2/3 ✅ · depth guard ≤6 ✅ · endpoints PATCH re-parent + GET /tree ✅ ·
  event `coa.account.reparented` ✅ · perms `coa.account.manage/view` ✅ · additive migration applied+verified ✅ ·
  every §9 4xx path has a named test ✅ · OpenAPI updated same PR ✅ ·
  FIGMA_REQUIRED — no interim UI shipped (backend-only PR; no waiver consumed).
