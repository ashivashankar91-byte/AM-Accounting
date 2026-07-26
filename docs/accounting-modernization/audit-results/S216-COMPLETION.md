# S216 — Post Manual JE (Direct-Post Mode) — Completion Evidence

**Story:** As an accountant with `je.post`, I want to post a validated draft directly so a
complete manual workflow exists before approval governance layers on.

**Status:** DONE_PENDING_INTEGRATION (AuditPort/AuthzPort stubs — full Done on S007/S207 integration re-run)
**Service:** `coa-service` · **Completed:** 2026-07-24

---

## What was built

The deliberate **Post** action moves a draft through the ONE posting door
(`PostingService.post` = the S013 engine — no second engine, no AI gate, no auto-approve)
and links the draft to its immutable journal.

- `DraftService.postDraft(id, actor)` — [services/coa-service/src/application/draft-service.ts](../../../services/coa-service/src/application/draft-service.ts)
  1. **Idempotent short-circuit** — an already `POSTED_LINKED` draft returns its journal (no re-post).
  2. **Terminal guard** — a `VOIDED` draft is refused (409); reverse the journal instead (S218).
  3. **Mode gate (BR216-2)** — resolves `je.posting_mode` (S223 config, ENTITY→TENANT precedence);
     non-`direct` refuses with `POSTING_MODE_GATE` / *"routing requires S031"* (422). Forward-compat
     gate tested now so S031/R1 layers on config, not re-architecture.
  4. **Validate-first (§3 negative)** — runs the SINGLE engine; failures surface as
     `POST_VALIDATION_FAILED` (422) carrying the S215 `ValidationResult`.
  5. **Post atomically (BR216-1)** — `PostingService.post` with `draftId` back-ref, idempotency
     key `draft-post:{id}`, and `postedBy` = authenticated user (BR216-3). The post tx emits `acct.je.posted`.
  6. **Link + audit** — draft → `POSTED_LINKED` with `posted_journal_id` / `posted_journal_number`,
     plus a `DRAFT_POSTED` audit record (before/after images, §11).
- New errors: `PostingModeGateError` (422), `DraftPostValidationError` (422).
- Route: `POST /manual-journals/drafts/{id}:post` on the shared colon-action dispatcher
  ([draft-routes.ts](../../../services/coa-service/src/http/draft-routes.ts)); each action gates on its
  own permission (`validate`=`je.draft.edit`, `post`=`je.post` via the reused `requireJePermission`).
- OpenAPI: `:post` operation added to
  [manual-journal-drafts.yaml](../../../services/coa-service/openapi/manual-journal-drafts.yaml).

## Data changes (§8, additive only)

- Migration `20260724200000_link_draft_journal` — **applied to dev DB**. Adds lookup indexes
  `idx_manual_je_draft_posted_journal` and `idx_journal_entry_draft`. The link columns
  (`manual_je_draft.posted_journal_id`, `journal_entry.draft_id`) already existed (S214/S013).
- **Known limitation:** a DB foreign key is intentionally *not* declared — `journal_entry.id` is
  `TEXT` while `manual_je_draft.id`/`posted_journal_id` are `UUID`, so a cross-type FK is impossible
  without a column-type change (destructive; deferred to a dedicated id-harmonization story). Stored
  values are valid UUID strings, so the link resolves from either side.

## Tests

- **9 new** — [tests/post.test.ts](../../../services/coa-service/tests/post.test.ts): BR216-1 post+linkage,
  BR216-3 poster identity, event+audit emission, validate-first success, unbalanced refusal (S215 shape,
  no journal), BR216-2 mode gate (422 + no journal), idempotent re-post, VOIDED 409, §12 atomicity fault
  injection (fault before persistence → draft unlinked, no journal).
- **Full coa-service suite: 178 passed / 13 files** (`vitest run`).

## Runtime transcript (through api-gateway :3100)

- **Happy path** — created a balanced draft, `POST .../{id}:post` → `201 {journalNumber:"GJ-2026-01-000007",
  status:"POSTED_LINKED", idempotent:false}` (never-validated → validated first → posted).
- **Idempotent re-post** → `201 {... idempotent:true}`, same journal, no second entry.
- **Unbalanced post** → `422 POST_VALIDATION_FAILED` with `validation.errors:[{rule:"BR013-1", ...}]`,
  `deltaDr:100/deltaCr:90`; draft stays `DRAFT`, no journal minted.
- **Mode gate** — set `je.posting_mode=review` at ENTITY scope (the winning scope over the pre-existing
  ENTITY `direct` override) → `POST ...:post` → `422 {error:"POSTING_MODE_GATE", message:"routing requires
  S031"}`; draft stays `DRAFT`, no journal; reset to `direct` afterward.

## DB verification

- `manual_je_draft`: `status=POSTED_LINKED`, `posted_journal_number=GJ-2026-01-000007`, linked.
- `journal_entry`: `status=POSTED`, `posted_by=dev-user` (BR216-3), `draft_id` back-ref set, `total_debits=total_credits=250.00`.
- `coa_outbox_events`: `acct.je.posted` present for the journal.
- `audit_outbox` for the draft: `DRAFT_CREATED → DRAFT_VALIDATED → DRAFT_POSTED` (validate-first + complete chain).

## Prohibited prototype behavior (§7) — confirmed absent

No AI gate, no 30-second auto-approve, no silent auto-post path, no in-memory persistence for financial
state, no validation logic divergent from the posting path (single engine reused).

## Integration gate (pending)

Uses AuditPort/AuthzPort **stubs** (role-map fixture + audit_outbox table). Full **Done** requires
re-running the integration suite green against the real S007 (audit) and S207 (authz) services.
Jira label: `pending-integration`.
