# CLAUDE.md — AutoMate 2.0 Accounting Module (AMACC)

## MODULE IDENTITY
- Module: Accounting (AMACC)
- Product: AutoMate 2.0 — Agentic DMS
- Owner: Shiva (Product Owner)
- Engineering: Hemant, Datta, James
- Architecture: Multi-tenant, white-labelable, enterprise-grade SaaS
- Target: Any dealership group (not Kunes-specific)
- Zero Tolerance: Every deliverable must be 100% correct and production-ready

## REPOSITORY STRUCTURE
- Workspace: AM-Accounting
- Active application source: amacc/
- Services: services/ (35 microservices)
- Shared packages: packages/
- Infrastructure: k8s/, docker-compose.yml
- Schema: services/gl-service/prisma/ (primary), per-service Prisma schemas
- Tests: services/*/tests/
- Archaeology: ../archaeology-phase*.json (5 files, 461 KB)
- Audit: ../audit-*.json (6 files, 268 KB)
- BRD/PRD: automate2-accounting-brd.md, automate2-accounting-prd.md
- User Stories: automate2-accounting-user-stories.json (68 stories)
- Steps 4-6 Data: ../steps-4-5-6-data.json
- Product Design Framework: Reference agentic_dms_loop_v3.html Section 6

## TECH STACK
- Runtime: Node.js + TypeScript
- Framework: Fastify
- ORM: Prisma
- Database: PostgreSQL (NUMERIC(15,2) for ALL money — NEVER use Float/Double)
- Message Queue: RabbitMQ (outbox pattern for events)
- Cache: Redis
- AI: Claude API (5 agents: GL Integrity, EOM Orchestration, Payroll, AP/AR, T1 Copilot)
- Frontend: React + TypeScript + Tailwind CSS (design system in Section 2 of product framework)
- Deployment: Kubernetes (AWS EKS)

## CRITICAL RULES (NON-NEGOTIABLE)
1. NUMERIC(15,2) for ALL monetary columns — NEVER Float or Double Precision
2. Every Prisma query MUST include tenantId in WHERE clause — no exceptions
3. Every API endpoint MUST require x-tenant-id header — return 400 if missing
4. Every GL posting MUST go through approveJournalEntry() — no direct status updates
5. Total debits MUST equal total credits on every journal entry — DB trigger enforced
6. EOM steps >= ACCT_100 are destructive — cannot be reset after completion
7. All SERIALIZABLE transactions must use withSerializableRetry() helper
8. Tests before code — write verification tests first, then implementation
9. Every new feature must cite COBOL source or mark as "net-new"
10. Frontend follows product design framework EXACTLY — no improvised design

## ARCHITECTURAL DECISIONS (LOCKED)
1. GLBYID → single wider gl_accounts table (no separate table)
2. KOMHISTTRANREVADJ reversal → dedicated PATCH endpoint
3. SR-CLEARING-IND → split into is_clearing_account + is_year_end_reserved + is_13th_month_reserved
4. KEY-FROM-PROG → readable enums with compat mapping view
5. Partial batch → PostgreSQL transaction wrapping (non-negotiable)
6. HISTTRAN keys → PostgreSQL sequences (eliminates infinite loop)
7. Journal source security → API gateway enforcement
8. EOM step 065 archive failure → non-blocking with retry queue
9. DETAIL-MF schema → Option A: single schedule_details table with discriminator

## PRODUCT OWNER DECISIONS (Locked 2026-05-19)

### PO-DEC-001: approveJournalEntry() Agent Review — KEEP
Decision: Keep the AI agent review step as an AMACC 2.0 enhancement over legacy.
Legacy behavior: Save → OK TO POST → Post (no approval step).
AMACC behavior: Save → PENDING_REVIEW → Agent Review → POSTED (with 30s auto-approve timeout).
Bypass: Sources with auto_post=true in gl_sources skip agent review (matches legacy auto-post behavior).
Rationale: AI agent review is our primary differentiation vs Tekion/CDK. The 30s timeout prevents blocking. Auto-post bypass preserves legacy parity for automated postings.
Source: Video analysis — "Creating and Posting Journal Entries in Program 37" shows zero approval steps in legacy.

### PO-DEC-002: F8=Post Keyboard Shortcut — KEEP (New in AMACC 2.0)
Decision: Keep F8 as the Post shortcut across all accounting screens.
Legacy behavior: No F8 shortcut confirmed in training videos.
AMACC behavior: F8=Post on Journal Entry, Cash Receipts, AP Invoice, Bank Reconciliation.
Rationale: F-key shortcuts are industry standard in DMS (CDK and Reynolds both use them). Dealers expect keyboard-first navigation. Label in UI as "Post (F8)" so new users discover it.
Source: Video analysis — no F8 shown, but keyboard-first design is a confirmed dealer expectation from field visits.

### PO-DEC-003: FIFO/Weighted-Average Scope — PARTS MODULE ONLY
Decision: Re-scope Phase 2 FIFO/WA inventory valuation to parts inventory only. Vehicle inventory uses Specific Identification per VIN.
Legacy behavior: Per-VIN Total Cost on vehicle inventory list (confirmed in Vehicle Inventory Navigation video). LIFO engine handles tax-layer accounting, not per-unit tracking.
AMACC behavior: BUILD-013 LIFO engine remains for tax layers. New FIFO/WA engine targets parts-catalog-service, not gl-service.
Rationale: Video confirms vehicle costing is Specific Identification. FIFO/WA only makes sense for fungible inventory (parts), not unique assets (vehicles).
Source: Video analysis — "Automate Vehicle Inventory List Navigation" shows per-VIN Total Cost field.

### PO-DEC-004: Journal Source = Numeric Code (Not Text Dropdown)
Decision: Replace the text dropdown (MANUAL, ADJUSTING, etc.) with numeric source code input + lookup popup.
Legacy behavior: Source codes are numbers (88=Standard General Journal, 3=Prior Month Entries, 30=Service ROs, 32=Part Sales, 40=Warranty Remittances). Managed in Program 8 Option 12.
AMACC behavior: gl_sources table already has source_code VARCHAR(2). Frontend must use numeric input + JournalSourceLookup popup, not a hardcoded text dropdown.
Rationale: Source codes drive GL posting behavior, journal security, auto-post rules, and year-end/13th-month reserved flags. Text values break all of these integrations.
Source: Video analysis — "Creating and Posting Journal Entries in Program 37" shows numeric source code field with lookup.

### PO-DEC-005: Cash Receipts Architecture — Cashier-Sourced Primary
Decision: WF-A003 primary workflow is cashier-generated receipts (auto-created at Service Cash Out and Parts Invoice). Manual back-office entry is the exception path, not the primary.
Legacy behavior: "Clicking Cash Out generates cash receipt transactions and updates RO status" (confirmed in Cashiering video). Accounting reviews/posts, does not create.
AMACC behavior: Restructure AccountsReceivable.tsx — primary tab shows cashier-sourced receipts for review/posting. Secondary button for manual exception entry.
Rationale: This matches actual dealer workflow. Controllers review receipts, they don't create them.
Source: Video analysis — "Automate Accounting, Service and Parts Cashiering" confirms auto-generation at cashier window.

## COBOL ARCHAEOLOGY REFERENCE
- Total COBOL: 221 programs, 370 copybooks, 180,358 lines in acct/
- KOM Layer: 9 programs, 134 fields — file-IPC gateways replaced by REST
- GL Pipeline: 4-stage (TRANUP → TRANPR → TRANPOST → HISTTRAN)
- Chained Sale: 1 TRAN record → 9 file operations (3×JOURNAL + 3×DETAIL + 3×HISTTRAN)
- EOM: PURGE Program 13, 12 steps, 7 purge types for schedule details
- GL Roll-Forward: ABSORB if JR-DATE > OLD-LASTCLOSE AND <= CUT-GL-DATE AND JR-SOURCE != SPACE
- 8-Year Prune: DELETE if JR-DATE < (CUT-YEAR - 8) + CUT-MM
- Failure Modes: 12 identified, 9 fixed in architecture, 3 fixed in code

## IMPLEMENTATION STATUS
### Phase 1 Critical Fixes (DONE): FIX-001 through FIX-007
### Phase 2 Core Infrastructure (DONE): BUILD-001 through BUILD-005
### Phase 3 High-Severity Fixes (DONE): FIX-009 through FIX-021
### Phase 4 Feature Completeness (DONE): BUILD-006 through BUILD-011
### Phase 5 Enhancements (DONE): BUILD-012 through BUILD-015
### Verification Tests (DONE): VER-001 through VER-008
### New Features (NOT STARTED): Sales Tax, 1099, Commission, Floor Plan (Phase 1), Manufacturer Recon, FIFO/WA, Fixed Assets, Warranty Accrual (Phase 2)
### Frontend (NOT STARTED): WF-A001 through WF-A010 (10 accounting workflows)
### REDESIGN Features (NOT STARTED): GL Exception Agent, Deal P&L, Bank Recon AI

## 16-STEP FRAMEWORK STATUS
- Step 0: Infrastructure → THIS FILE
- Step 1: Legacy Code Analysis → DONE (5 archaeology JSONs)
- Step 2: Market Research → DONE (CDK, Tekion, Reynolds, Dealertrack)
- Step 3: Generic DMS Features → DONE (30 features, 16 gaps)
- Step 4: Required Features → DONE (89 endpoints, 20 pain points)
- Step 5: Triage + USP → DONE (8 IMPLEMENT, 4 PLATFORM, 3 REDESIGN, 2 DROP)
- Step 6: RICE Prioritization → NEEDS FORMAL SCORING
- Step 7: BRD/PRD → DONE (112 KB, 68 user stories)
- Step 8: Feature Map + LLD → IN PROGRESS (LLD docx, needs OpenAPI + event contracts)
- Step 9: Coding → IN PROGRESS (backend done, frontend + new features pending)
- Steps 10-16: NOT STARTED

## PRODUCT DESIGN FRAMEWORK
### Accounting Workflows: WF-A001 through WF-A010
- WF-A001: GL Journal Entry
- WF-A002: Accounts Payable
- WF-A003: Accounts Receivable / Cash Receipts
- WF-A004: Bank Reconciliation
- WF-A005: Payroll Processing
- WF-A006: End of Month Close
- WF-A007: Financial Statements
- WF-A008: Purchase Order Management
- WF-A009: Recurring Entries
- WF-A010: Financial Dashboard

### Design System
- Font UI: Inter
- Font Mono: JetBrains Mono
- Primary: #1D4ED8 (blue-700)
- Layout: Sidebar (192px) + Main Content + Detail Panel (256px)
- Table row height: 36px
- Form field height: 32px
- Keyboard-first navigation (F-keys mapped per workflow)
- All monetary values: monospace font, right-aligned
- All stock statuses: badge component with color coding

### AI Enhancements Per Workflow
- WF-A001: Anomaly detection, auto-suggest offset account, recurring detection
- WF-A002: Auto GL coding, duplicate invoice detection, PO auto-match
- WF-A003: Duplicate receipt prevention (critical — legacy bug)
- WF-A004: Auto-clear matching, discrepancy highlight, trend alert
- WF-A005: Double-post prevention (critical — legacy bug), variance report
- WF-A006: Idempotent close steps (critical — legacy 062/065/068 fix)
- WF-A007: OEM line position mapping, drill-down
- WF-A008: State machine enforcement (critical — legacy corruption fix)
- WF-A009: Auto-generate from templates
- WF-A010: Cash flow forecast, anomaly scan, month-end readiness

## HOW TO USE THIS FILE
1. Read this file FIRST before any coding session
2. Check MODULE STATE FILE for current progress
3. Read the relevant archaeology JSON for COBOL behavioral contracts
4. Read the BRD/PRD for feature specifications
5. Follow the product design framework for any frontend work
6. Write tests FIRST, then implementation
7. Update MODULE STATE FILE after every session
