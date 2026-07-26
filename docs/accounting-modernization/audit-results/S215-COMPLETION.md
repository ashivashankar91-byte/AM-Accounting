# S215 — Validate Manual JE — COMPLETION

Package: R0-JOURNAL-LIFECYCLE · Story: S215 · Status: **DONE_PENDING_INTEGRATION**
Service: `coa-service` · Endpoint: `POST /api/v1/coa/manual-journals/drafts/{id}:validate`

## Summary
S215 gives the accountant a "check my work" button that runs the draft against the
**exact same S013 rule engine** posting uses — the single rule source (BR215-1). It
kills the AMACC anti-pattern where a validation engine existed but posting never called
it. `DraftService.validate()` calls `PostingService.resolveContext()` + the pure
`evaluate()` from `domain/journal-posting.ts`; there is no second engine, so a
validate-pass can never post-fail (BR215-2). Errors surface with line precision and BR
references, plus a running debit/credit delta.

## Business rules implemented
| Rule | Meaning | Evidence |
|------|---------|----------|
| BR215-1 | validation reuses the S013 engine (single source) | `validate()` calls `posting.resolveContext` + shared `evaluate`; no duplicate rule code |
| BR215-2 | validate/post divergence is a test failure | `validate.test.ts` parity suite (6 scenarios) asserts `validate.pass === post-succeeds` |
| §2 response | `{pass, errors:[{lineIndex?, rule, message, field?}], deltaDr, deltaCr}` | runtime A–D show exact shape |
| §2 state | validationState UNCHECKED→PASS\|FAIL; revalidated on edit | pass→status VALIDATED; edit resets to DRAFT + clears result (runtime E) |
| §3 negative | engine-unavailable blocks with 503 (never silent pass) | `DraftEngineUnavailableError` (503); unit test "engine unavailability blocks with 503" |

## Acceptance criteria (runtime, gateway :3100)
- A. Unbalanced draft → `200 {pass:false, errors:[BR013-1 …], deltaDr:100, deltaCr:90}`
- B. Future-period date → `200 {pass:false, errors:[BR013-2 "Period 2026-03 is FUTURE…"]}`
- C. Non-postable account → `200 {pass:false, errors:[{lineIndex:0, BR013-4 …}]}`
- D. All-clear → `200 {pass:true, errors:[]}`; GET shows `status:"VALIDATED"`
- E. Edit a VALIDATED draft → `200` back to `status:"DRAFT"` (validation cleared, revalidate-on-edit)
- F. Unknown action → `404`; nonexistent-id `:validate` → `404 DRAFT_NOT_FOUND` (colon-action routing verified)

## Artifacts
- `src/application/draft-service.ts` — `validate(id, actor)` reusing the S013 engine;
  errors `DraftValidationBlockedError` (409 terminal state), `DraftEngineUnavailableError`
  (503); `update()` now resets validation on edit (revalidate-on-edit).
- `src/http/draft-routes.ts` — `POST /manual-journals/drafts/:target` colon-action
  dispatcher (`:validate`); perm `je.validate` implied by `je.draft.edit`; 503/409 wired.
- `openapi/manual-journal-drafts.yaml` — `:validate` operation added.
- Tests: `tests/validate.test.ts` (13, incl. the 6-scenario parity suite).
- No migration: `validated_at` / `validation_result` columns shipped with S214.

## Test evidence
- **13 new** (`validate.test.ts`): acceptance matrix (unbalanced/future/non-postable/all-clear),
  503 engine-unavailable, 409 terminal, revalidate-on-edit, and the **BR215-2 parity suite**
  (balanced-valid, unbalanced, future-period, non-postable-account, inactive-source,
  missing-dept-on-pnl — each asserts validate.pass ⇔ post succeeds). Full coa-service suite
  **169 passed / 12 files**.
- DB: `validation_result` JSONB persisted; 5 `DRAFT_VALIDATED` rows in `audit_outbox`
  with before/after images.

## Events / audit / tenancy
No domain events (per §9). Every validation writes a `DRAFT_VALIDATED` audit row
(before/after) via the AuditPort stub. Every query tenant-scoped; `x-tenant-id` required.
`je.validate` enforced via AuthzPort stub (deny-by-default).

## Known limitations
- UI: FIGMA_REQUIRED — inline error rendering and delta-bar states not built (interim R0 UI
  needs a recorded PO waiver). Backend + API + tests complete.
- Colon-action route uses a single `:target` dispatcher (find-my-way keeps the literal
  `:action` in-segment); unknown actions return a generic 404 message.

## Pending integration gates (carry-forward)
- **S007 AuditPort** — `DRAFT_VALIDATED` lands in `audit_outbox`; real audit sink pending.
- **S207 AuthzPort** — `je.validate` via role→permission stub; real authz pending.
