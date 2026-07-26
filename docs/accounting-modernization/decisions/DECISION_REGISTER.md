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

## How to add a decision

1. Assign the next `DEC-NNN` ID.
2. For decisions with >3 sentences of context, create `ADR-NNN_SHORT_TITLE.md` alongside this file.
3. Add a row to the Register above with a link to the ADR.
4. Update `CURRENT_RELEASE.md` if the decision gates or changes any released work item.
