# S219 — Void/Delete Draft JE — COMPLETION

Status: DONE_PENDING_INTEGRATION
Service: coa-service
Endpoint: POST /api/v1/coa/manual-journals/drafts/{id}:void
Completed: 2026-07-24

## What was implemented
S219 adds a true soft-delete path for unposted drafts.

- BR219-1: only draft records are voidable; void performs status transition to VOIDED with audit trail and event emission.
- BR219-2: posted history is inviolable; attempting to void a POSTED_LINKED draft returns 409 REVERSE_ONLY with message "reverse only".
- BR219-3: voiding another preparer's draft requires je.draft.void.any and a non-empty reason.
- Idempotency: already-voided draft returns 200-equivalent success payload with idempotent=true.
- Worklist hygiene: list endpoint excludes VOIDED drafts.

## Artifacts
- src/application/draft-service.ts
  - Added DraftReverseOnlyError (409 REVERSE_ONLY)
  - Added DraftVoidReasonRequiredError (422 VOID_REASON_REQUIRED)
  - Added voidDraft(id, dto, actor)
  - Added DraftActor flags canVoidOwn/canVoidAny
  - list() now excludes VOIDED rows
- src/http/draft-routes.ts
  - Added permissions je.draft.void and je.draft.void.any
  - Added :void action to colon-action dispatcher
  - Added VoidSchema and error mapping for S219 errors
- tests/void.test.ts
  - 10 tests covering positive, idempotent, and negative paths
- prisma/migrations/20260724230000_manual_je_void_worklist_index/migration.sql
  - Additive partial index for non-voided worklists
- openapi/manual-journal-drafts.yaml
  - Added /manual-journals/drafts/{id}:void and VoidRequest/VoidResult schemas

## Tests
- New tests: 10 (tests/void.test.ts)
- Full coa-service suite: 205 passed / 16 files

S219 test coverage includes:
- Soft-delete transition + outbox + audit
- Already-voided idempotent replay
- Posted-linked draft -> 409 reverse only
- Admin-any reason required
- Admin-any with reason succeeds
- No .any permission cannot void another preparer's draft
- Own-void permission guard
- Worklist excludes VOIDED
- Tenant scoping guard
- Own void with null reason succeeds

## Runtime evidence (gateway :3100)
Tenant: tenant-kunes

1) Own draft void + idempotent replay
- Create draft -> draftId 2995ce42-c95d-4da7-be2e-2212f2a95304
- POST :void {} -> 200 {draftId, status:VOIDED, idempotent:false}
- POST :void {} again -> 200 {draftId, status:VOIDED, idempotent:true}
- GET drafts list -> voided id absent (contains_voided false)

2) Posted-linked draft cannot be voided (BR219-2)
- Create draft -> 9e5e6cc5-9d02-4520-83a8-3cffd29c1c8c
- POST :post -> journal GJ-2026-01-000010
- POST :void {} -> HTTP 409 {error:REVERSE_ONLY, message:"reverse only"}

3) Admin-any reason required (BR219-3)
- Seeded other-preparer draft -> b5ce0fe3-5d8b-4238-90aa-9d58a53997cd
- POST :void {} -> HTTP 422 {error:VOID_REASON_REQUIRED,...}
- POST :void {"reason":"abandoned duplicate"} -> 200 VOIDED

DB verification:
- manual_je_draft shows VOIDED rows with voided_at and void_reason
- coa_outbox_events includes je.draft.voided for voided draft ids
- audit_outbox includes DRAFT_VOIDED for voided draft ids

## Known limitations / integration gate
- This path still uses AuthzPort/AuditPort stub contracts in-service.
- Story remains DONE_PENDING_INTEGRATION until integration suites are rerun green against real S007/S207 and broker-backed event verification.
