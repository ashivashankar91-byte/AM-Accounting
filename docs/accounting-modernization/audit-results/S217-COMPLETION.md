# S217 — View Journal Entry — Completion Evidence

**Story:** As an authorized user, I want to open a JE by number and see header, lines,
source, poster, timestamps, attachments and reversal linkage so every posted amount is
inspectable.

**Status:** DONE_PENDING_INTEGRATION (AuditPort/AuthzPort stubs — full Done on S007/S207 integration re-run)
**Service:** `coa-service` · **Completed:** 2026-07-24

---

## What was built

A read-only view: open any posted JE by number and read exactly what it did, who posted
it, and what reversed it.

- `JournalViewService.view(tenantId, journalNumber, actor)` —
  [services/coa-service/src/application/journal-view-service.ts](../../../services/coa-service/src/application/journal-view-service.ts)
  - Fetches the entry tenant-scoped, loads lines ordered by `lineIndex`, and assembles
    header, source, poster, timestamps, totals.
  - **BR217-2** immutability badge — `immutable: true` on every persisted JE.
  - **BR217-3** reversal linkage resolved in **both directions** to navigable
    `{id, journalNumber}` refs (`reversalOf` = this reverses X; `reversedBy` = X reversed this).
  - Attachments surfaced through the S214 draft via the S216 `draftId` back-ref.
  - **BR217-1** field masks (S004A stub): a masked role has PII fields **absent** (not nulled)
    at serialization, and `maskedFields[]` lists what was hidden.
  - **§9** `audit.viewed` event + a `VIEWED` audit record emitted **only** when a masked-role
    user opens (PII access policy).
- Route `GET /journals/{number}` on
  [journal-routes.ts](../../../services/coa-service/src/http/journal-routes.ts), gated by
  `je.view` (reusing `requireJePermission`). 404s carry a search suggestion.
- Registered `JournalViewService` in
  [index.ts](../../../services/coa-service/src/index.ts).
- OpenAPI: `GET /journals/{number}` + `JournalView` / `NotFoundWithSuggestion` schemas added to
  [journals.yaml](../../../services/coa-service/openapi/journals.yaml).

## Data changes (§8, additive only)

- Migration `20260724210000_journal_view_index` — **applied to dev DB**. Adds
  `idx_journal_entry_tenant_number` on `journal_entry(tenant_id, journal_number)` to serve the
  exact-number fetch and the 404 prefix-suggestion scan. No DDL on existing columns; the story
  otherwise only reads `journal_entry`/`journal_line`. Schema kept in sync in `schema.prisma`.

## Tests

- **7 new** — [tests/journal-view.test.ts](../../../services/coa-service/tests/journal-view.test.ts):
  BR217-2 full render + immutability badge; BR217-3 linkage both directions; BR217-1 masked role
  (postedBy absent + `maskedFields` + `audit.viewed` outbox + `VIEWED` audit record); attachments via
  draft linkage; §3 unknown-number 404 with sibling suggestions; §3 unknown-number with no siblings
  (empty matches, different message); tenant scoping (other tenant's JE not visible).
- **Full coa-service suite: 185 passed / 14 files** (`vitest run`).

## Runtime transcript (through api-gateway :3100)

- **Happy path** — `GET /api/v1/coa/journals/GJ-2026-01-000007` → `200` with full header
  (`immutable:true`, `postedBy:"dev-user"`, `memo:"S216 demo post"`), both balanced lines
  (10000 DR 250 / 49000 CR 250 dept SVC), `attachments:[]`.
- **Negative** — `GET .../journals/GJ-2026-01-000999` → `404 {error:"JOURNAL_NOT_FOUND",
  suggestion:{prefix:"GJ-2026-01-", matches:["GJ-2026-01-000006","...07","...08"]}}`.

## Known limitations / deferred verification

- **Masked-role runtime path** is proven by unit test only: dev auth (`NODE_ENV=development`)
  hardcodes role `ADMIN`, so the CLERK masking + `audit.viewed` emission can't be exercised through
  the gateway until real tokens arrive with **S207** (AuthzPort). This is part of the integration gate.
- **Reversal-pair runtime demo** lands with **S218** (no reversal entries exist yet); the linkage
  read paths are unit-tested against both directions.

## Prohibited prototype behavior (§7) — confirmed absent

None applicable; no posting-path AI gate, no auto-approve, no in-memory financial state, no seeded
mock data behind the widget. The view reads only real persisted rows.

## Integration gate (pending)

Uses AuditPort/AuthzPort **stubs** (`audit_outbox` table + role-map fixture). Full **Done** requires
re-running the integration suite green against real S007 (audit) and S207 (authz), including the
masked-role serialization + `audit.viewed` path. Jira label: `pending-integration`.
