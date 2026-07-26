# AutoMate 2.0 Accounting — Copilot Operating Instructions

You are working inside the existing AMACC brownfield repository.

The complete accepted Fable backlog package is stored at:

`docs/accounting-modernization/AutoMate2_Accounting_Backlog_Package_v1.1.zip`

You may inspect and extract this ZIP locally for reference, but:

- Never modify the original ZIP.
- Never regenerate the backlog.
- Never change story IDs, release assignments, dependencies or requirements.
- Never implement the complete epic or release automatically.
- Implement only the item explicitly named in:
  `docs/accounting-modernization/releases/CURRENT_RELEASE.md`

---

## Source order

When information conflicts, use this precedence:

1. Approved decision register and ADRs (`docs/accounting-modernization/decisions/`)
2. `CURRENT_RELEASE.md`
3. Story-specific approved amendments
4. Accepted Fable V1.1 story packet
5. Existing AMACC implementation
6. Suggestions and inferred behavior

Do not silently resolve conflicts. Report them.

---

## At the beginning of every work item

1. Read `CURRENT_RELEASE.md`.
2. Identify the exact released story or work-item ID.
3. Locate that packet inside the Fable ZIP.
4. Read its related epic only for context.
5. Read the applicable decisions, ADRs, audits and amendments.
6. Inspect the existing AMACC repository for reusable implementation.
7. Confirm that all release gates are closed.
8. Stop if the story is unreleased or blocked.

---

## Required Phase 1 — Understanding

**Do not code immediately.**

Return:

- Plain-English functionality
- Persona and business problem
- End-to-end workflow
- Fields and validations
- Business rules
- Permissions
- Status transitions
- Existing AMACC functionality
- Reusable components
- Missing functionality
- Conflicts
- Dependencies
- Unresolved questions
- Proposed UI structure when Figma is unavailable
- Exact end-of-story demonstration

**Wait for Product Owner approval.**

---

## Required Phase 2 — Implementation plan

After approval, return:

- Files expected to change
- Database changes
- API changes
- UI changes
- Permission changes
- Events
- Unit tests
- Integration tests
- E2E tests
- Acceptance-criteria mapping
- Temporary stubs
- Risks and rollback approach

**Wait for Product Owner approval.**

---

## Required Phase 3 — Implementation

After explicit approval:

- Implement only the released item
- Reuse existing AMACC functionality where safe
- Do not implement sibling stories
- Do not make unresolved architecture decisions
- Do not use mock data as final evidence
- Add automated tests
- Preserve tenant isolation
- Report any new gaps rather than expanding scope

---

## Required Phase 4 — Closure

Return:

- Acceptance-criteria evidence matrix
- Files changed
- Unit-test results
- Integration-test results
- E2E-test results
- API and database evidence
- Permission evidence
- Screenshots or demo steps
- Remaining gaps
- Temporary dependencies
- Final recommendation: `DONE`, `PARTIAL`, `BLOCKED` or `DONE_PENDING_INTEGRATION`

**Never mark DONE while required evidence is missing.**

---

## How to invoke this workflow

Tell Copilot:

> Read `COPILOT_OPERATING_INSTRUCTIONS.md` and `CURRENT_RELEASE.md`.
> Begin Phase 1 for the currently released work item. Do not code.

After reviewing Phase 1:

> Phase 1 understanding is approved.
> Proceed with Phase 2 implementation planning only. Do not code.

After reviewing Phase 2:

> Phase 2 plan is approved.
> Proceed with Phase 3 implementation for the released item only.

After implementation:

> Proceed with Phase 4 closure validation. Do not start another story.

---

## AMACC critical rules (non-negotiable in all phases)

These rules are enforced by the CLAUDE.md and the decision register. Copilot must never violate them:

1. `NUMERIC(15,2)` for ALL monetary columns — never Float or Double.
2. Every Prisma query MUST include `tenantId` in WHERE clause.
3. Every API endpoint MUST require `x-tenant-id` header — return 400 if missing.
4. Every GL posting MUST go through `approveJournalEntry()`.
5. Total debits MUST equal total credits on every journal entry.
6. EOM steps ≥ ACCT_100 are destructive — cannot be reset after completion.
7. All SERIALIZABLE transactions must use `withSerializableRetry()` helper.
8. Tests before code — write verification tests first, then implementation.
9. Every new feature must cite COBOL source or mark as "net-new".
10. Frontend follows product design framework EXACTLY — no improvised design.

---

## Audit and decision references

| Document | Path |
|---|---|
| S200 Gap Audit | `docs/accounting-modernization/audit-results/S200-AUDIT_RESULTS_v1.2.md` |
| Decision Register | `docs/accounting-modernization/decisions/DECISION_REGISTER.md` |
| ADR-001 Tenant Isolation | `docs/accounting-modernization/decisions/ADR-001_TENANT_ISOLATION.md` |
| Fable Backlog ZIP | `docs/accounting-modernization/AutoMate2_Accounting_Backlog_Package_v1.1.zip` |
| Current Release | `docs/accounting-modernization/releases/CURRENT_RELEASE.md` |
| AMACC Technical Rules | `CLAUDE.md` |
| Discovery Report | `AMACC_DISCOVERY_REPORT.md` |
