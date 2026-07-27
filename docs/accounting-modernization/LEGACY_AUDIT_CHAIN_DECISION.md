# Legacy Audit-Chain Row Treatment — Decision Record

**Status:** DECIDED and APPLIED (Phase 4, GOLDEN-R0 Final Product Closure).
**Decision owner:** Product Owner directive; implemented and evidenced by
engineering per the zero-fabrication mandate.

## 1. The real finding (Phase 3)

`verifyChain()` in `services/audit-service/src/application/audit-service.ts`
was rewritten in Phase 3 (commit `2875ced`) to walk the real
`hashSelf -> hashPrev` linked list instead of trusting `occurredAt`/`id`
ordering. Running the corrected logic against the live `amacc` database's
long-lived partition `2026-07:1cf31f14-cb0b-4261-a41d-f79953594c86` returned
`ok:false, fork detected`.

Direct SQL inspection showed why: **502 of 506 rows** in that partition have
`hash_prev IS NULL` / `hash_self IS NULL`. These rows are real historical
audit events (logins, drafts, denials, etc.) spanning `03:05`-`15:59` on
2026-07-27 — written **before** the hash-chaining feature existed in this
codebase and never backfilled. The remaining **4 rows** (16:29-16:30,
written during this session's own live testing, after hash-chaining went
live) form a perfect chain that terminates exactly at the anchor's real
`tail_hash`. This proves the current write path and the corrected
`verifyChain()` read path are both correct; only pre-existing historical
data lacks chain values.

This is a genuine, disclosed **data** limitation, not a code defect.

## 2. Options considered

| Option | Description | Verdict |
|---|---|---|
| **A — Backfill** | Compute and write `hash_prev`/`hash_self` retroactively onto the 502 legacy rows. | **Rejected.** `audit_log` rows are protected by this service's own immutability trigger. Backfilling would require disabling that trigger to rewrite already-written, already-immutable rows — an operation indistinguishable, from an audit-trail-integrity standpoint, from the tampering BR7-2 exists to catch. Doing this to "pass" a tamper-detection check would itself be a tamper-detection bypass. |
| **B — Bare baseline anchor only** | Just point `tailHash`/`tailAuditLogId` at some row and call it done. | **Rejected.** Does not explain *why* verification is broken for anything before that point, and does not distinguish "legitimately out of scope" from "genuinely broken" for an auditor reading a bare `ok:false`. |
| **C — Explicit pre-chain cutoff (chosen)** | Add a per-partition `chainVerifiedFrom` timestamp to `AuditChainAnchor`. `verifyChain()` excludes rows with `occurredAt < chainVerifiedFrom` from the hash-chain walk and reports how many rows were excluded (`legacyExcluded`). | **Chosen.** Does not touch a single existing `audit_log` row. Is fully disclosed in the result (`legacyExcluded` count, always present, defaulting to `0`). Requires an explicit, deliberate, logged administrative action to set — never inferred automatically from missing hash values, so a *genuine* future chain break still fails loudly rather than being silently swallowed by "oh, that's just legacy data." |

## 3. Implementation

- **Schema** (`services/audit-service/prisma/schema.prisma`): `AuditChainAnchor.chainVerifiedFrom DateTime?`. `NULL` (the default) means "verify this partition from genesis, no exceptions" — the only state a partition can ever be in if hash-chaining was live from its very first write, which is true for every partition except the one legacy partition below.
- **Migration**: `services/audit-service/prisma/migrations/20260727100000_add_chain_verified_from/migration.sql` — a single additive `ALTER TABLE ... ADD COLUMN` (nullable, no default-value backfill, no data rewrite). Applied via `prisma migrate deploy` to both `amacc_fresh_cert` and the live `amacc` database.
- **Code** (`services/audit-service/src/application/audit-service.ts`): `verifyChain()` fetches the partition's anchor, filters `occurredAt < chainVerifiedFrom` rows out of the walk, and returns `legacyExcluded` (count of rows excluded) in **every** return path — success, fork, break, and incomplete-walk cases alike. `ChainVerifyResult.legacyExcluded?: number`.
- **Tests** (`services/audit-service/tests/audit-service.test.ts`): `fakePrisma()` extended with `auditChainAnchor.findUnique` + a `__anchors` test-only escape hatch. New dedicated unit test proves: (a) without a cutoff, a legacy unchained row mixed with real chained rows is correctly reported broken/forked; (b) with the cutoff set past the legacy row, verification passes with the correct `legacyExcluded` count; (c) a genuine tamper introduced *after* the cutoff is still caught (`ok:false`) — i.e. the cutoff narrows scope, it does not disable detection. Full suite: 32/32 passing (audit-service, fresh DB).

## 4. Applying the cutoff to the real live partition

The cutoff was applied to the one real partition proven to need it,
`2026-07:1cf31f14-cb0b-4261-a41d-f79953594c86`, via a single logged SQL
statement against the live `amacc` database:

```sql
UPDATE audit_chain_anchors
SET chain_verified_from = '2026-07-27T16:29:07.211Z'
WHERE partition_key = '2026-07:1cf31f14-cb0b-4261-a41d-f79953594c86';
```

The timestamp `2026-07-27T16:29:07.211Z` is the `occurredAt` of the true
genesis row of the real hash chain for this partition — identified directly
via SQL as the row with `hash_prev IS NULL AND hash_self IS NOT NULL`
(every genesis row has a null `hash_prev` by definition; what distinguishes
it from a true legacy row is that its `hash_self` **is** populated). This
value was read directly from the database, not assumed or rounded.

**Correction found and fixed during application (not concealed):** the
first attempt used `2026-07-27T16:29:07.229Z` (the first row with a
*non-null* `hash_prev`), which is the **second** real chained event, not
genesis. Applying that value produced `ok:false, reason: "no genesis record
(hashPrev IS NULL) found for this partition"`, because the true genesis of
the real chain — like every hash-chain genesis — itself has `hash_prev IS
NULL` (only its `hash_self` is populated), and that cutoff excluded it along
with the true legacy rows. A direct SQL query
(`hash_prev IS NULL AND hash_self IS NOT NULL`) identified the actual
genesis row at `2026-07-27T16:29:07.211Z`; the anchor was corrected to that
value.

Post-application live-gateway proof: `GET /api/v1/audit/chain/verify?partitionKey=...`
(real JWT via `/api/v1/auth/login`, real `x-tenant-id` header) on this
partition now returns `ok:true`, `recordsChecked:278`, `legacyExcluded:502`
— matching direct SQL row counts for the partition (502 legacy rows with
both `hash_prev`/`hash_self` null, excluded; the real chain, starting at
genesis, verified in full). The audit-service process was restarted to load
this code path, confirmed reconnecting as the non-superuser `amacc_app`
role via `pg_stat_activity`, consistent with the rest of the live stack.

## 5. Scope and limits of this decision

- This decision applies **only** to the `audit_chain_anchors` metadata
  table. No row in `audit_log` was modified, and the immutability trigger
  on `audit_log` was never touched or disabled.
- This is a **per-partition, explicit, human-approved** operation. No
  automatic process infers or sets `chainVerifiedFrom` from the presence of
  null hash values — doing so would risk masking a genuine future break as
  "just more legacy data."
- Any other partition discovered in the future with a similar null-hash
  legacy tail requires its own explicit review and its own explicit
  `chainVerifiedFrom` value set the same way — this is not a blanket
  suppression.
