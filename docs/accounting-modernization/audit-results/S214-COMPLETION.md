# S214 — Create & Save Draft Manual JE — COMPLETION

Package: R0-JOURNAL-LIFECYCLE · Story: S214 · Status: **DONE_PENDING_INTEGRATION**
Service: `coa-service` · Endpoints: `/api/v1/coa/manual-journals/drafts` (CRUD + attachments)

## Summary
S214 delivers the accountant's safe scratchpad: a manual JE draft that saves in ANY
state with no validation on save (BR214-1), reloads with full fidelity, retains edit
history, and binds attachments. Posting rules do not apply here — validation (S215),
posting (S216) and void (S219) are separate deliberate acts. The prototype
PENDING_REVIEW/AI path is stripped (packet §7).

## Business rules implemented
| Rule | Meaning | Evidence |
|------|---------|----------|
| BR214-1 | drafts save without validation (any state) | runtime #1 empty draft 201; #2 unbalanced half-line 200; test "saves a half-finished draft" |
| BR214-2 | draft visible to preparer + `je.draft.view_all` roles only | tests visibility matrix (403 cross-preparer, view_all sees all, list scoped) |
| BR214-3 | draft edit history retained | `manual_je_draft_revision` append-only; runtime showed v1+v2 rows |
| BR214-4 | attachments bind at draft (basic upload) | runtime #4 201 PDF; #5 oversize 422; MIME whitelist + 25MB cap |

Status transitions owned here: create/edit only while `DRAFT`; editing a
`VALIDATED/POSTED_LINKED/VOIDED` draft → 409 (`DRAFT_NOT_EDITABLE`).

## Artifacts
- `src/domain/draft.ts` — attachment admission (MIME whitelist + 25MB) + line normalization
- `src/application/draft-service.ts` — `DraftService` (create/update/get/list/addAttachment)
- `src/http/draft-routes.ts` — CRUD + attachments; perms `je.draft.create|edit|view_all` (AuthzPort stub)
- `prisma/migrations/20260724190000_add_manual_je_draft/migration.sql` — `manual_je_draft`
  (lines JSONB, any-state), `manual_je_draft_revision` (append-only history), `attachment`
  (25MB CHECK). Additive only.
- `openapi/manual-journal-drafts.yaml` — OpenAPI 3.1
- Tests: `tests/draft.test.ts` (12)

## Test evidence
- Unit/integration: **12 new** (`draft.test.ts` — save-any-state, reload fidelity, edit-history,
  visibility matrix, attachment admission, 404/403/409/422 named). Full coa-service suite **156 passed / 11 files**.
- Runtime (gateway :3100 → coa-service :3016):
  1. create empty draft → **201** `draftId`
  2. update to half-finished unbalanced state → **200** version 2 (no validation)
  3. GET → faithful reload (lines, memo, dr 250.55, attachments [])
  4. add PDF attachment → **201**
  5. add oversize (>25MB) → **422** ATTACHMENT_REJECTED
  6. list → scoped drafts
  7. GET missing → **404** DRAFT_NOT_FOUND
  8. create without `x-tenant-id` → **400**
- DB side-effects verified: 2 `manual_je_draft_revision` rows (v1, v2 — BR214-3),
  `acct.je.draft.created` + `acct.je.draft.updated` in `coa_outbox_events`,
  `DRAFT_CREATED/DRAFT_UPDATED/DRAFT_ATTACHMENT_ADDED` in `audit_outbox`, 1 `attachment` row.

## Events
`acct.je.draft.created` / `acct.je.draft.updated` — payload `{eventId, draftId, preparer, ts, schemaV:1}`
(outbox `coa_outbox_events`; best-effort broker publish).

## Tenancy & security
Every query tenant-scoped; all routes require `x-tenant-id` (400 otherwise). Permissions
enforced deny-by-default via the AuthzPort stub. Every state change writes an audit row
with before/after images.

## Known limitations
- UI: FIGMA_REQUIRED — the JE editor / DR-CR delta bar / attachment panel are not built
  (interim R0 UI requires a recorded PO waiver). Backend + API + events + tests complete.
- Attachment storage is metadata-binding only (R0 basic upload); real object store + virus
  scan are R1 hardening. `controlNumber`/`applyNumber` are INTERIM fields (UQ-18 semantics pending).

## Pending integration gates (carry-forward)
- **S007 AuditPort** — audit rows land in `audit_outbox`; real audit sink pending.
- **S207 AuthzPort** — `je.draft.*` enforced via role→permission stub; real authz pending.
- **Broker-backed event verification** — outbox durable + best-effort publish; RabbitMQ-verified delivery pending.
