# Decision Register — AutoMate 2.0 Accounting (AMACC)

All architectural and product decisions that affect implementation are recorded here.
Individual decisions with significant context have their own ADR file.

---

## Register

| DecisionID | Title | Status | Date | ADR / Source | Notes |
|---|---|---|---|---|---|
| DEC-001 | Tenant isolation model: shared schema + RLS | ACCEPTED | 2026-07-23 | [ADR-001_TENANT_ISOLATION.md](ADR-001_TENANT_ISOLATION.md) | Supersedes implicit code-convention-only model |
| PO-DEC-001 | approveJournalEntry() Agent Review — KEEP | ACCEPTED | 2026-05-19 | CLAUDE.md | 30s auto-approve; auto_post bypass |
| PO-DEC-002 | F8=Post Keyboard Shortcut — KEEP (New in AMACC 2.0) | ACCEPTED | 2026-05-19 | CLAUDE.md | |
| PO-DEC-003 | FIFO/Weighted-Average Scope — PARTS MODULE ONLY | ACCEPTED | 2026-05-19 | CLAUDE.md | Vehicle inventory: Specific Identification per VIN |
| PO-DEC-004 | Journal Source = Numeric Code (Not Text Dropdown) | ACCEPTED | 2026-05-19 | CLAUDE.md | gl_sources.source_code VARCHAR(2) |
| PO-DEC-005 | Cash Receipts Architecture — Cashier-Sourced Primary | ACCEPTED | 2026-05-19 | CLAUDE.md | |
| ARCH-001 | GLBYID → single wider gl_accounts table | LOCKED | — | CLAUDE.md | No separate table |
| ARCH-002 | KOMHISTTRANREVADJ reversal → dedicated PATCH endpoint | LOCKED | — | CLAUDE.md | |
| ARCH-003 | SR-CLEARING-IND → split flags | LOCKED | — | CLAUDE.md | is_clearing_account + is_year_end_reserved + is_13th_month_reserved |
| ARCH-004 | KEY-FROM-PROG → readable enums with compat mapping view | LOCKED | — | CLAUDE.md | |
| ARCH-005 | Partial batch → PostgreSQL transaction wrapping | LOCKED | — | CLAUDE.md | Non-negotiable |
| ARCH-006 | HISTTRAN keys → PostgreSQL sequences | LOCKED | — | CLAUDE.md | Eliminates infinite loop |
| ARCH-007 | Journal source security → API gateway enforcement | LOCKED | — | CLAUDE.md | |
| ARCH-008 | EOM step 065 archive failure → non-blocking with retry queue | LOCKED | — | CLAUDE.md | |
| ARCH-009 | DETAIL-MF schema → Option A: single schedule_details table with discriminator | LOCKED | — | CLAUDE.md | |

---

## Open questions (UQ = Unresolved Question)

| UQID | Question | Raised by | Raised | Status |
|---|---|---|---|---|
| UQ-01 | Tenant isolation: should the database enforce tenant boundaries, not just application code? | S200 audit (GAP-S200-ISOLATION) | 2026-07-23 | **RESOLVED → DEC-001 (RLS)** |
| UQ-02 | Should `Tenant.schemaName` be removed (vestigial) or repurposed? | S200 audit | 2026-07-23 | OPEN — tracked as WI-S200-07 |
| UQ-03 | Should the Legal Entity update HTTP contract be `PATCH`+`If-Match`+`412` or keep `PUT`+body-version+`409`? | S200 audit (GAP-S200-APICONTRACT) | 2026-07-23 | OPEN — PO decision needed |
| UQ-04 | Should deactivated legal entities have a soft reactivation path, or is deactivation permanent? | S200 audit (GAP-S200-REACTIVATE) | 2026-07-23 | OPEN — PO decision needed |
| UQ-05 | Is a valid-time (bi-temporal) model required for effective-dated legal entity edits, or is current mutable-date sufficient? | S200 audit (GAP-S200-EFFDATE) | 2026-07-23 | OPEN — PO decision needed |

---

## Open questions — UXMAP series (Golden R0 UX implementation-mapping pass, 2026-07-28)

Raised by the S220/S221/S014/S222/S227 implementation-mapping pass. Full
evidence and citations in
[`../GOLDEN_R0_UX_IMPLEMENTATION_MAPPING.md`](../GOLDEN_R0_UX_IMPLEMENTATION_MAPPING.md).
Uses a distinct `UXMAP-NN` prefix to avoid colliding with this file's own
`UQ-NN` sequence and with the separate backlog-numbered UQs referenced in
`GOLDEN_R0_STORY_CONTRACT_GAPS.md` (e.g. `UQ-15_AUDIT_RETENTION_WORM.md`).

| ID | Question / Item | Screen(s) | Classification | Status |
|---|---|---|---|---|
| UXMAP-01 | `KNOWN_LIMITATIONS_REGISTER.md` miscategorizes S220 as a gl-service screen (it's coa-service) | S220 | API_CONFIRMATION_REQUIRED | OPEN |
| UXMAP-02 | Retire, rewire, or leave `GLInquiry.tsx` (legacy, disconnected from real S220 backend) | S220 | PRODUCT_DECISION_REQUIRED | OPEN |
| UXMAP-03 | TB→GL-Inquiry drill-through preset mismatch (`CURRENT_MONTH` vs `OPEN_MONTH`) — deterministic failure | S220/S222 | KNOWN_GOLDEN_R0_LIMITATION (active defect) | OPEN |
| UXMAP-04 | GL Inquiry preset catalogue: only 1 of ~12 contract-named presets implemented | S220 | SME_DECISION_REQUIRED | OPEN |
| UXMAP-05 | `sourceCode` filter named in story contract but absent from S220 code | S220 | API_CONFIRMATION_REQUIRED | OPEN |
| UXMAP-06 | S217 journal-detail response shape (S220 drill-down target) not verified in this pass | S220 | API_CONFIRMATION_REQUIRED | OPEN |
| UXMAP-07 | No dedicated Playwright coverage of the S220 endpoint itself | S220 | KNOWN_GOLDEN_R0_LIMITATION | OPEN |
| UXMAP-08 | Saved-search UPDATE missing entirely (no route/service method) | S221 | PRODUCT_DECISION_REQUIRED | OPEN |
| UXMAP-09 | No frontend UI for saved-search create/list/run/delete | S221 | KNOWN_GOLDEN_R0_LIMITATION | OPEN |
| UXMAP-10 | `S221_LIVE_GATEWAY_CERTIFICATION_REPORT.md` stale re: saved-search audit coverage (contradicted by commit `8bb96b0`) | S221 | API_CONFIRMATION_REQUIRED | OPEN |
| UXMAP-11 | No drill-down links rendered in GL Search UI despite drill keys being present in the data | S221 | KNOWN_GOLDEN_R0_LIMITATION | OPEN |
| UXMAP-12 | No negative/permission E2E coverage for saved-search-write endpoints | S221 | KNOWN_GOLDEN_R0_LIMITATION | OPEN |
| UXMAP-13 | No backend Trial Balance export endpoint / no export audit trail | S014/S222 | PRODUCT_DECISION_REQUIRED | OPEN |
| UXMAP-14 | Legacy `GLTrialBalance.tsx`: broken export link + dead department filter | S014/S222 | PRODUCT_DECISION_REQUIRED | OPEN |
| UXMAP-15 | Invalid `asOf` throws unhandled 500 instead of clean 400 | S014/S222 | API_CONFIRMATION_REQUIRED | OPEN |
| UXMAP-16 | gl-service default-stack deployment status not independently confirmed | S014/S222/S227 | API_CONFIRMATION_REQUIRED | OPEN |
| UXMAP-17 | `GOLDEN_R0_STORY_CONTRACT_MATRIX.md`/`GAPS.md` stale re: S227 implementation status | S227 | KNOWN_GOLDEN_R0_LIMITATION | OPEN |
| UXMAP-18 | No automated test for BS-specific `STRUCTURAL_IMBALANCE` banner | S227 (BS) | KNOWN_GOLDEN_R0_LIMITATION | OPEN |
| UXMAP-19 | No comparative-period / YTD support on Balance Sheet or Income Statement | S227 | PRODUCT_DECISION_REQUIRED | OPEN |
| UXMAP-20 | No drill-down from Balance Sheet or Income Statement line items | S227 | PRODUCT_DECISION_REQUIRED | OPEN |
| UXMAP-21 | No percentage-of-revenue column on Income Statement | S227 (IS) | PRODUCT_DECISION_REQUIRED | OPEN |
| UXMAP-22 | `KNOWN_LIMITATIONS_REGISTER.md` row 3 wording conflates BS-specific `STRUCTURAL_IMBALANCE` with Income Statement, where only `UNCLASSIFIED_ACCOUNT_TYPE` applies | S227 (IS) | PRODUCT_DECISION_REQUIRED | OPEN |

---

## How to add a decision

1. Assign the next `DEC-NNN` ID.
2. For decisions with >3 sentences of context, create `ADR-NNN_SHORT_TITLE.md` alongside this file.
3. Add a row to the Register above with a link to the ADR.
4. Update `CURRENT_RELEASE.md` if the decision gates or changes any released work item.
