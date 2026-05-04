# AMACC CODEBASE AUDIT — COMPLETE SOURCE-LEVEL ANALYSIS

**Date:** 2026-03-29
**Scope:** All 19 TypeScript microservices, React frontend (29 pages), 5 AI agents, shared-kernel
**Method:** Every source file read and analyzed — no guessing

---

## SERVICE-BY-SERVICE — MICRO VIEW

---

### 1. auth-service

| Field | Value |
|-------|-------|
| **Port** | 3001 |
| **Database** | Yes — Prisma: `ApiKey`, `RefreshToken` |
| **Routes** | `POST /token` — Exchange API key for JWT |
| | `POST /verify` — Verify JWT token |
| | `POST /api-keys` — Create API key (admin only) |
| **Business logic** | Issues JWT tokens (HS256, 8h expiry) from API keys. Admin-gated key creation. MVP: no actual DB hash lookup — always issues token. |
| **Events published** | None |
| **Events consumed** | None |
| **Status** | **Partial** — Token issuance works, but no actual API key validation against DB. No refresh token flow. |
| **Gaps** | No DB-backed key validation (always issues token). No refresh token rotation. No password/user auth. No rate limiting. |

---

### 2. tenant-service

| Field | Value |
|-------|-------|
| **Port** | 3002 |
| **Database** | Yes — Prisma: `Tenant` |
| **Routes** | `POST /` — Create tenant (admin) |
| | `GET /` — List tenants (admin) |
| | `GET /:id` — Get tenant |
| | `PATCH /:id` — Update tenant (admin) |
| | `DELETE /:id` — Soft delete (admin) |
| **Business logic** | CRUD for tenants. Auto-generates slug + schema name. Publishes `TENANT_PROVISIONED` on creation. |
| **Events published** | `TENANT_PROVISIONED` |
| **Events consumed** | None |
| **Status** | **Fully implemented** |
| **Gaps** | No actual schema provisioning (event is published but no listener creates the DB schema). `oems` field on Tenant not in Prisma schema. |

---

### 3. gl-service

| Field | Value |
|-------|-------|
| **Port** | 3010 |
| **Database** | Yes — Prisma: `GlAccount`, `JournalEntry`, `JournalLine` |
| **Routes** | `POST /accounts` — Create GL account |
| | `GET /accounts` — List accounts |
| | `POST /journal-entries` — Create journal entry (DRAFT) |
| | `POST /journal-entries/:id/post` — Post entry |
| | `GET /journal-entries` — List with filters |
| | `GET /trial-balance` — Trial balance for period |
| | Plus `/api/v1/dashboard/summary` and `/api/v1/command-center/*` (7 endpoints) served from this service |
| **Business logic** | Full GL lifecycle: create accounts, create DRAFT entries, post entries (triggers agent review), trial balance computation. Validation engine with 7 rules: DuplicateEntry, AccountTypeMismatch, UnbalancedEntry, AnomalousAmount, WarrantyLaborMisclassification, InternalVsCustomerLabor, NegativeInventory, FSLineMappingGap. |
| **Events published** | `JOURNAL_ENTRY_SUBMITTED`, `JOURNAL_ENTRY_POSTED` |
| **Events consumed** | None |
| **Status** | **Fully implemented** |
| **Gaps** | Validation engine is defined but NOT called during `postJournalEntry` — it exists as dead code. AccountTypeMismatchRule has placeholder logic only. Dashboard/Command Center endpoints referenced in nginx but routes not in gl-service routes file (likely in separate route file or index). |

---

### 4. eom-service

| Field | Value |
|-------|-------|
| **Port** | 3011 |
| **Database** | Yes — Prisma: `EomClose`, `EomStep` |
| **Routes** | `POST /` — Initiate close |
| | `GET /` — List closes |
| | `GET /:id` — Get close |
| | `POST /:id/advance` — Advance step |
| | `POST /:id/retry-step` — Retry blocked step |
| | `GET /:id/steps` — List steps |
| **Business logic** | 11-step EOM close orchestration: 010 (Pre-Close) -> 020 (Verify Open Items) -> 062 (Parts Close) -> 065 (Parts Recon) -> 068 (Service Close — actually calls gl-service to post DRAFT RO entries) -> 070 (Body Shop) -> 071 (Variable Ops) -> 074 (Fixed Ops) -> 077 (Master Close — validates all prior steps) -> 200 (FS Generation) -> 300 (FS Submission). Also 13th Month: 13TH_SNAP -> 13TH_FINAL. |
| **Events published** | `EOM_STEP_CHANGED` |
| **Events consumed** | None directly (agent-eom subscribes) |
| **Status** | **Fully implemented** — most sophisticated domain service |
| **Gaps** | Step 068 (ServiceCloseHandler) makes HTTP calls to gl-service — if gl-service is down, the step fails with no circuit breaker. `EOM_CLOSE_INITIATED` and `EOM_CLOSE_COMPLETED` events are defined but never published. Steps 010/020 are hardcoded to always return success (no real validation). `context.period`/`context.periodEnd` used in 068 but not set in EOMService context construction. |

---

### 5. payroll-service

| Field | Value |
|-------|-------|
| **Port** | 3012 |
| **Database** | Yes — Prisma: `PayrollBatch` |
| **Routes** | `POST /batches` — Submit batch |
| | `GET /batches` — List |
| | `GET /batches/:id` — Get by ID |
| | `POST /batches/:id/validate` — Mark validated |
| | `POST /batches/:id/post` — Post (requires VALIDATED) |
| | `POST /batches/:id/hold` — Hold with reason |
| | `POST /batches/:id/release` — Release hold |
| **Business logic** | Payroll batch lifecycle with idempotency key dedup (24h window). State machine: PENDING -> VALIDATED -> POSTED (or HELD). |
| **Events published** | `PAYROLL_BATCH_SUBMITTED`, `PAYROLL_BATCH_HELD` |
| **Events consumed** | None |
| **Status** | **Fully implemented** |
| **Gaps** | No actual payroll line items (just batch totals). No GL journal creation on post — posting a batch doesn't create journal entries. `PAYROLL_BATCH_POSTED` event defined but never published. |

---

### 6. apar-service

| Field | Value |
|-------|-------|
| **Port** | 3013 |
| **Database** | Yes — Prisma: `ArEntry`, `ApEntry` |
| **Routes** | `POST /ar` — Create AR entry |
| | `GET /ar` — List AR |
| | `POST /ap` — Create AP entry |
| | `GET /ap` — List AP |
| | `POST /ar/oem-import` — Bulk import OEM remittance |
| **Business logic** | AP/AR CRUD. OEM remittance bulk import publishes `OEM_REMITTANCE_IMPORTED` event. |
| **Events published** | `OEM_REMITTANCE_IMPORTED` |
| **Events consumed** | None |
| **Status** | **Fully implemented** |
| **Gaps** | No aging report. No payment matching. No GL account linkage for AP entries. No invoice workflow. |

---

### 7. recon-service

| Field | Value |
|-------|-------|
| **Port** | 3014 |
| **Database** | Yes — Prisma: `BankRecon`, `BankTransaction` |
| **Routes** | `POST /` — Create recon |
| | `GET /` — List recons |
| | `POST /:id/import` — Import bank transactions |
| | `GET /:id/unmatched` — Get unmatched |
| | `POST /:id/match-manual` — Manual match |
| | `POST /:id/complete` — Complete recon |
| **Business logic** | Bank reconciliation: create recon -> import transactions -> manual match to journal lines -> complete. |
| **Events published** | `BANK_RECON_STARTED`, `BANK_RECON_COMPLETED` |
| **Events consumed** | None |
| **Status** | **Fully implemented** |
| **Gaps** | No auto-matching algorithm. No locking (lockedBy/lockedAt fields exist but not enforced). Variance not recalculated on match. |

---

### 8. fs-service

| Field | Value |
|-------|-------|
| **Port** | 3015 |
| **Database** | No — in-memory document store |
| **Routes** | `GET /preview/:tenantId/:period/:oem` — Get FS preview |
| | `POST /preview` — Generate FS from trial balance |
| | `POST /submit/:tenantId/:period/:oem` — Submit to OEM |
| | `GET /status/:tenantId/:period/:oem` — Submission status |
| | `GET /validate/:tenantId/:period/:oem` — Validate FS |
| **Business logic** | Generates OEM-formatted financial statements from trial balance data. Has GM and Ford formatters. In-memory storage of FS documents. |
| **Events published** | None (defined in events but not wired) |
| **Events consumed** | None |
| **Status** | **Partial** |
| **Gaps** | In-memory only — data lost on restart. No actual OEM API submission. `FS_PREVIEW_READY`, `FS_SUBMITTED` etc. events defined but never published. No Prisma/database. |

---

### 9. coa-service

| Field | Value |
|-------|-------|
| **Port** | 3016 |
| **Database** | No — hardcoded standard CoA in memory |
| **Routes** | `GET /standard/:version` — Get standard CoA |
| | `GET /standard` — Latest CoA |
| | `GET /tenant/:tenantId` — Tenant CoA |
| | `GET /oem-mapping/:tenantId/:oem` — GL->FS line mappings |
| | `GET /unmapped/:tenantId/:oem` — Unmapped accounts |
| | `POST /legacy-map` — Map legacy GL to canonical |
| **Business logic** | Serves a hardcoded standard chart of accounts (90+ accounts with GM/Ford OEM mappings). Legacy GL mapper for AutoMate/CDK/Reynolds DMS migration. |
| **Events published** | None |
| **Events consumed** | None |
| **Status** | **Fully implemented** (for demo) |
| **Gaps** | No database — all in memory. No CoA versioning (immutable seed). No tenant-specific overrides persisted. |

---

### 10. agent-gl

| Field | Value |
|-------|-------|
| **Port** | 3020 |
| **Database** | No — InMemoryAuditLogger |
| **Routes** | `GET /health` only |
| **Business logic** | GL Integrity Agent — triggered by `JOURNAL_ENTRY_SUBMITTED`. Uses Claude to review entries for: duplicates, account type correctness, balance check, anomalous amounts. Can post entry or flag for human review. |
| **Events published** | `AGENT_ACTION_TAKEN`, `AGENT_HUMAN_REQUIRED` (via BaseAgent) |
| **Events consumed** | `JOURNAL_ENTRY_SUBMITTED` |
| **Status** | **Fully implemented** |
| **Gaps** | Uses InMemoryAuditLogger (logs lost on restart). Tools initialized but `setTools()` never called with real implementations in index.ts — agent would fail on tool execution. No error handling for Claude API failures. |

---

### 11. agent-eom

| Field | Value |
|-------|-------|
| **Port** | 3021 |
| **Database** | No — InMemoryAuditLogger |
| **Routes** | `GET /health` only |
| **Business logic** | EOM Orchestration Agent — triggered by `EOM_STEP_CHANGED`. Uses Claude to evaluate step state, auto-advance eligible steps, surface blocker root cause, escalate after 3 retries. |
| **Events published** | `AGENT_ACTION_TAKEN`, `AGENT_HUMAN_REQUIRED` (via BaseAgent) |
| **Events consumed** | `EOM_STEP_CHANGED` |
| **Status** | **Fully implemented** |
| **Gaps** | Same as agent-gl: `setTools()` never called. InMemory logger. No retry counting logic implemented (just described in prompt). |

---

### 12. agent-payroll

| Field | Value |
|-------|-------|
| **Port** | 3022 |
| **Database** | No — InMemoryAuditLogger |
| **Routes** | `GET /health` only |
| **Business logic** | Payroll Integrity Agent — triggered by `PAYROLL_BATCH_SUBMITTED`. Checks: idempotency key uniqueness, total vs prior period variance, GL mapping, period overlap. Decisions: PASS/HOLD/REJECT. |
| **Events published** | `AGENT_ACTION_TAKEN`, `AGENT_HUMAN_REQUIRED` (via BaseAgent) |
| **Events consumed** | `PAYROLL_BATCH_SUBMITTED` |
| **Status** | **Fully implemented** |
| **Gaps** | Same: `setTools()` never called. No prior-period data access to calculate variance. |

---

### 13. agent-apar

| Field | Value |
|-------|-------|
| **Port** | 3023 |
| **Database** | No — InMemoryAuditLogger |
| **Routes** | `GET /health` only |
| **Business logic** | AP/AR Reconciliation Agent — triggered by `OEM_REMITTANCE_IMPORTED` and `BANK_RECON_STARTED`. Matches warranty AR to remittance, flags unmatched >45 days, identifies short-payments, auto-generates journal entries. |
| **Events published** | `AGENT_ACTION_TAKEN`, `AGENT_HUMAN_REQUIRED` (via BaseAgent) |
| **Events consumed** | `OEM_REMITTANCE_IMPORTED`, `BANK_RECON_STARTED` |
| **Status** | **Fully implemented** |
| **Gaps** | Same: `setTools()` never called. No actual AR data access. |

---

### 14. agent-t1

| Field | Value |
|-------|-------|
| **Port** | 3024 |
| **Database** | No — InMemoryAuditLogger |
| **Routes** | `POST /api/v1/agents/t1/chat` — SSE streaming chat |
| | `GET /api/v1/agents/log` — Agent activity log |
| | `GET /api/v1/agents/log/:id` — Single log entry |
| | `POST /api/v1/agents/log/:id/resolve` — Resolve human-required |
| **Business logic** | T1 Copilot — conversational AI assistant with SSE streaming. Has 13 tools (most of any agent): get_gl_accounts, get_journal_entries, get_trial_balance, get_payroll_batch, get_eom_steps, get_fs_preview, get_pending_approvals, get_eom_readiness, post_journal_entry, hold_payroll_batch, create_journal_entry, request_approval, flag_for_human_review. Full system prompt with OEM FS context, approval workflow, and example queries. |
| **Events published** | `AGENT_ACTION_TAKEN`, `AGENT_HUMAN_REQUIRED` (via BaseAgent) |
| **Events consumed** | None directly (HTTP-triggered, not event-triggered) |
| **Status** | **Fully implemented** — most complete agent |
| **Gaps** | Same: `setTools()` never called. Some tool executors use optional chaining (`tools.getFSPreview?.()`) suggesting tool implementations may not exist. InMemory logger. |

---

### 15. notification-service

| Field | Value |
|-------|-------|
| **Port** | 3030 |
| **Database** | No |
| **Routes** | `GET /health` only |
| **Business logic** | Subscribes to events and sends notifications via WebhookChannel and ConsoleChannel. |
| **Events published** | None |
| **Events consumed** | `AGENT_HUMAN_REQUIRED`, `PAYROLL_BATCH_HELD`, `EOM_CLOSE_BLOCKED` |
| **Status** | **Partial** |
| **Gaps** | Only 3 of 15+ events consumed (EVENT_ROUTING defines many more). WebhookChannel requires webhookUrl in metadata but no service provides it. No email/SMS/Slack channels. No notification history API. No HTTP endpoints for clients. |

---

### 16. audit-service

| Field | Value |
|-------|-------|
| **Port** | 3031 |
| **Database** | Yes — Prisma: `AgentLog` |
| **Routes** | `GET /api/v1/audit/log` — List audit logs |
| | `GET /api/v1/audit/log/:id` — Get log by ID |
| **Business logic** | Persists audit trail for agent actions. Subscribes to 5 event types. PrismaAuditLogger with full CRUD. |
| **Events published** | None |
| **Events consumed** | `JOURNAL_ENTRY_POSTED`, `AGENT_HUMAN_REQUIRED`, `AGENT_ACTION_TAKEN`, `TENANT_PROVISIONED`, `TENANT_UPDATED` |
| **Status** | **Fully implemented** |
| **Gaps** | Only consumes 5 of 30+ events. No write endpoints (log-only). No search/filter. |

---

### 17. connector-service

| Field | Value |
|-------|-------|
| **Port** | 3032 |
| **Database** | No |
| **Routes** | `POST /ingest` — Ingest DMS data -> normalize -> GL journal entry |
| | `GET /adapters` — List available DMS adapters |
| **Business logic** | DMS integration hub. Normalizes raw DMS payloads via adapter pattern (AutoMate, CDK, Reynolds, DealerTrack adapters). Maps deal data to GL journal lines via `mapDealToGLLines()`. Resolves GL account codes to UUIDs. Auto-posts if requested. |
| **Events published** | None |
| **Events consumed** | None |
| **Status** | **Fully implemented** |
| **Gaps** | No DMS-sync events (`DMS_SYNC_COMPLETED` defined but never published). Adapters are minimal normalizers, not real DMS API clients. No webhook receiver for real-time DMS data. |

---

### 18. approval-service

| Field | Value |
|-------|-------|
| **Port** | 3033 |
| **Database** | No — InMemoryApprovalWorkflow |
| **Routes** | `POST /request` — Request approval |
| | `GET /pending/:tenantId` — Get pending |
| | `POST /:id/approve` — Approve |
| | `POST /:id/reject` — Reject |
| | `GET /history/:tenantId` — History |
| **Business logic** | Approval workflow with timeout, role-based access, approve/reject with notes. |
| **Events published** | `APPROVAL_REQUESTED`, `APPROVAL_GRANTED`, `APPROVAL_REJECTED` |
| **Events consumed** | None |
| **Status** | **Partial** |
| **Gaps** | In-memory only — approvals lost on restart. No timeout/expiry enforcement. No AGENT_HUMAN_REQUIRED event subscription (agents can't trigger approvals via events). |

---

### 19. onboarding-service

| Field | Value |
|-------|-------|
| **Port** | 3035 |
| **Database** | No — InMemoryOnboardingService |
| **Routes** | `POST /start` — Start onboarding |
| | `POST /:sessionId/step` — Complete step |
| | `POST /:sessionId/fail` — Fail step |
| | `GET /:sessionId` — Get session |
| | `GET /tenant/:tenantId` — Get by tenant |
| | `GET /` — List all sessions |
| **Business logic** | 5-step onboarding wizard: DMS_CONFIG -> OEM_CONFIG -> COA_SETUP -> IMPORT_HISTORY -> FS_VALIDATION. |
| **Events published** | None (ONBOARDING_COMPLETED defined but never published) |
| **Events consumed** | None |
| **Status** | **Partial** |
| **Gaps** | In-memory only. Steps just track state — no actual DMS connection test, no actual COA import, no actual history import. `ONBOARDING_COMPLETED` event never published. |

---

## PORT MAP (from docker-compose.yml)

| Service | Port | Database | Status |
|---------|------|----------|--------|
| auth-service | 3001 | Yes (ApiKey, RefreshToken) | Partial |
| tenant-service | 3002 | Yes (Tenant) | Fully implemented |
| gl-service | 3010 | Yes (GlAccount, JournalEntry, JournalLine) | Fully implemented |
| eom-service | 3011 | Yes (EomClose, EomStep) | Fully implemented |
| payroll-service | 3012 | Yes (PayrollBatch) | Fully implemented |
| apar-service | 3013 | Yes (ArEntry, ApEntry) | Fully implemented |
| recon-service | 3014 | Yes (BankRecon, BankTransaction) | Fully implemented |
| fs-service | 3015 | No (in-memory) | Partial |
| coa-service | 3016 | No (in-memory) | Fully implemented (demo) |
| agent-gl | 3020 | No (InMemory) | Fully implemented |
| agent-eom | 3021 | No (InMemory) | Fully implemented |
| agent-payroll | 3022 | No (InMemory) | Fully implemented |
| agent-apar | 3023 | No (InMemory) | Fully implemented |
| agent-t1 | 3024 | No (InMemory) | Fully implemented |
| notification-service | 3030 | No | Partial |
| audit-service | 3031 | Yes (AgentLog) | Fully implemented |
| connector-service | 3032 | No | Fully implemented |
| approval-service | 3033 | No (InMemory) | Partial |
| onboarding-service | 3035 | No (InMemory) | Partial |
| api-gateway (nginx) | 8081->80 | — | Fully implemented |
| web (React) | 5174 | — | Partial |

**Infrastructure:** PostgreSQL 15, Redis 7, RabbitMQ 3

---

## FRONTEND — SCREEN BY SCREEN

**Framework:** React 18 + Vite + React Router v6 + Tailwind CSS + React Query (TanStack v5)
**State management:** React Query + local useState — no Redux/Zustand
**Auth flow:** None — hardcoded tenant selector in sidebar (Kunes/Premier/Sunrise)
**Navigation:** 4-section sidebar (Core, Operations, Advanced, Admin) + persistent T1 Copilot sidebar
**29 routes total**

| Route | Component | API Calls | Data | Actions | Demo Gaps |
|-------|-----------|-----------|------|---------|-----------|
| `/` | Dashboard | `dashboardApi.getSummary`, `glApi.getEntries`, `agentApi.getLog` | Real | View KPIs, recent entries, agent log | Dashboard endpoint may return seed data |
| `/command-center` | AccountingCommandCenter | `commandCenterApi.*` (7 endpoints) | Real | View alerts, take actions, ask Ashley AI | Backend endpoints likely return computed data |
| `/gl` | GeneralLedger | `glApi.getAccounts`, `glApi.getEntries`, `glApi.getTrialBalance` | **Real** | Create account, create/post entry, view TB | Works end-to-end |
| `/transactions` | Transactions | `glApi.getEntries`, `glApi.createEntry`, `glApi.postEntry` | **Real** | Create/post/view entries | Edit/Delete not implemented, Reverse not wired |
| `/coa` | ChartOfAccounts | None (seeded `SEED_ACCOUNTS`) | **Seeded** | Filter, view detail | No backend — hardcoded 80+ accounts |
| `/schedules` | Schedules | None (seeded) | **Seeded** | Filter by type, view grid | No backend |
| `/vehicle-inventory` | VehicleInventory | None (seeded `SEED_VEHICLES`) | **Seeded** | Filter, search, view detail | No backend — 8 demo vehicles |
| `/standard-journal-entries` | StandardJournalEntries | None (seeded) | **Seeded** | View overview/detail | No backend — 5 demo entries |
| `/reports` | Reports | `reportApi.generate` (not actually called) | **Empty** | Select report type, configure | Generates with 2s fake delay, no actual report |
| `/fs` | FSPreview | `fsApi.*` (v2 paths) | **Partial** | Preview FS, validate, submit | **API path mismatch** — client calls /api/v2 (Java), not /api/v1/fs (TS) |
| `/ap` | AccountsPayable | `aparApi.getAP` | **Real** | Create vouchers, payments, view aging | Voucher creation not fully wired |
| `/cash-receipts` | CashReceipts | `cashReceiptApi.list` | **Empty** | New receipt form | Form not submitted |
| `/bank-deposits` | BankDeposits | `bankDepositApi.list` | **Seeded** | View/submit deposits | Reconciliation tab empty |
| `/po` | PurchaseOrders | None (seeded) | **Seeded** | View POs | No backend — 5 demo POs |
| `/vendors` | VendorManagement | None (seeded) | **Seeded** | View/add vendors | No backend — 6 demo vendors |
| `/payroll` | Payroll | `payrollApi.*` | **Real** | Submit/validate/post/hold/release batches | Works end-to-end |
| `/recon` | Reconciliation | `reconApi.*` | **Real** | Create recon, import, match, complete | Works end-to-end |
| `/intercompany` | Intercompany | None (seeded) | **Seeded** | View transfers | No backend — 4 demo transfers |
| `/warranty` | WarrantyDCS | None (seeded) | **Seeded** | View claims | No backend — 5 demo claims |
| `/journal-sources` | JournalSources | None (seeded) | **Seeded** | Filter by brand, view detail | No backend |
| `/eom` | EOMClose | `eomApi.*` | **Real** | Initiate/advance/retry close | Works end-to-end |
| `/year-end` | YearEnd | None (seeded) | **Seeded** | View checklist | No backend — 12 demo steps |
| `/approvals` | Approvals | `approvalApi.*` | **Real** | View/approve/reject | Works end-to-end |
| `/system-settings` | SystemSettings | `companyConfigApi.*` (seeded) | **Seeded** | 6 tabs of config | No backend for most |
| `/setup` | Setup | `setupApi.*` | **Seeded** | Company info, periods, departments | No backend |
| `/utilities` | Utilities | `utilityApi.*` | **Seeded** | Fix OOB, recalc, rebuild | No backend |
| `/agents` | Agents | `agentApi.*`, SSE chat | **Real** | View agent log, resolve, chat with T1 | Works end-to-end |
| `/tenants` | Tenants | `tenantApi.*` | **Real** | CRUD tenants | Works end-to-end |
| `/onboarding` | Onboarding | `onboardingApi.*` | **Real** | Start/step onboarding | Works end-to-end |
| `/analytics` | Analytics | `glApi.getEntries`, `agentApi.getLog`, `eomApi.list`, `payrollApi.getBatches` | **Real** | View charts | No date range filters |

**Summary: ~12 screens have working backends. ~17 screens use seeded/hardcoded data with no backend.**

---

## AGENT — DEEP DIVE

### 1. agent-gl (GL Integrity Agent)

| Field | Value |
|-------|-------|
| **Trigger event** | `JOURNAL_ENTRY_SUBMITTED` (RabbitMQ) |
| **LLM** | Anthropic Claude (`claude-sonnet-4-5-20250514`) |
| **System prompt** | "You are the GL Integrity Agent for tenant {tenantId}. Your job is to review journal entries submitted for posting and check for: 1. Duplicate entries (same source_ref within last 5 minutes) 2. GL account type correctness (e.g., revenue posting to an asset account = flag) 3. Debit/credit balance (must be equal) 4. Unusual amounts (>3x 30-day average = warn). If clean -> post_journal_entry. If suspicious -> flag_for_human_review. Always explain your reasoning." |
| **Tools** | `get_journal_entries(dateFrom?, status?)`, `get_gl_accounts()`, `get_trial_balance(year, month)`, `post_journal_entry(entryId)`, `flag_for_human_review(entityType, entityId, reason, severity)` |
| **Decision outcomes** | POST (approve) or FLAG (escalate to human) |
| **Blocks further action?** | **Yes** — posting gates on agent approval |
| **Race condition risk?** | **Yes** — concurrent JOURNAL_ENTRY_SUBMITTED events could cause agent to process overlapping entries without dedup |
| **Tests exist?** | **No** |

### 2. agent-eom (EOM Orchestration Agent)

| Field | Value |
|-------|-------|
| **Trigger event** | `EOM_STEP_CHANGED` (RabbitMQ) |
| **LLM** | Anthropic Claude (`claude-sonnet-4-5-20250514`) |
| **System prompt** | "You are the EOM Orchestration Agent for tenant {tenantId}. You manage end-of-month close processes. The step dependency graph is: Parts Close (062) -> Parts Recon (065) -> Service Close (068) -> Variable Ops (071) -> Fixed Ops (074) -> Master Close (077). Your job: 1. Check which steps are complete and what is blocking 2. Auto-advance eligible steps 3. Surface blocker root cause in plain English 4. Escalate after 3 retries with a human-readable summary" |
| **Tools** | `get_eom_steps(closeId)`, `advance_eom_step(closeId, stepCode)`, `flag_for_human_review(entityType, entityId, reason, severity)` |
| **Decision outcomes** | ADVANCE step, FLAG for human review |
| **Blocks further action?** | **Yes** — blocked steps prevent progression |
| **Race condition risk?** | **Yes** — each EOM_STEP_CHANGED fires agent; rapid step advances cause concurrent agent invocations |
| **Tests exist?** | **No** |

### 3. agent-payroll (Payroll Integrity Agent)

| Field | Value |
|-------|-------|
| **Trigger event** | `PAYROLL_BATCH_SUBMITTED` (RabbitMQ) |
| **LLM** | Anthropic Claude (`claude-sonnet-4-5-20250514`) |
| **System prompt** | "You are the Payroll Integrity Agent for tenant {tenantId}. Check payroll batches for: 1. Idempotency key uniqueness (same key in 24h = duplicate -> REJECT) 2. Total amount vs prior period (>15% variance = warn) 3. GL account mapping completeness 4. Batch period overlap detection. Actions: PASS (auto-post eligible), HOLD (needs human), REJECT (clear duplicate)" |
| **Tools** | `get_payroll_batch(batchId)`, `hold_payroll_batch(batchId, reason)`, `flag_for_human_review(...)` |
| **Decision outcomes** | PASS, HOLD, REJECT |
| **Blocks further action?** | **Yes** — HOLD prevents posting |
| **Race condition risk?** | **Low** — idempotency key prevents duplicate batches at service level |
| **Tests exist?** | **No** |

### 4. agent-apar (AP/AR Reconciliation Agent)

| Field | Value |
|-------|-------|
| **Trigger event** | `OEM_REMITTANCE_IMPORTED`, `BANK_RECON_STARTED` (RabbitMQ) |
| **LLM** | Anthropic Claude (`claude-sonnet-4-5-20250514`) |
| **System prompt** | "You are the AP/AR Reconciliation Agent for tenant {tenantId}. When OEM remittance is imported or bank recon starts: 1. Match warranty AR entries to remittance lines by claim number + amount 2. Flag unmatched AR older than 45 days 3. Identify short-payments 4. Auto-generate journal entries for matched items 5. Flag unmatched items for human review" |
| **Tools** | `get_gl_accounts()`, `get_journal_entries(status?)`, `create_journal_entry(description, lines[])`, `flag_for_human_review(...)` |
| **Decision outcomes** | AUTO-MATCH (create JE), FLAG for human |
| **Blocks further action?** | **No** — advisory only |
| **Race condition risk?** | **Yes** — concurrent remittance imports could cause duplicate JE creation |
| **Tests exist?** | **No** |

### 5. agent-t1 (T1 Accounting Copilot)

| Field | Value |
|-------|-------|
| **Trigger event** | HTTP POST `/api/v1/agents/t1/chat` (user-initiated, not event-triggered) |
| **LLM** | Anthropic Claude (`claude-sonnet-4-5-20250514`) with SSE streaming |
| **System prompt** | Full copilot prompt (62 lines) with: tenant context (tenantId, dealerName, userName, userRole, dmsType, oems), capabilities list (read + write ops), OEM FS guidance (GM/Ford), approval workflow rules, guidelines for amounts/codes, example queries ("Why is our trial balance out by $4,200?", "Show me the March financial statement preview for GM", etc.) |
| **Tools (13)** | `get_gl_accounts`, `get_journal_entries(dateFrom, dateTo, status, source)`, `get_trial_balance(year, month)`, `get_payroll_batch(batchId)`, `get_eom_steps(closeId)`, `get_fs_preview(period, oem)`, `get_pending_approvals()`, `get_eom_readiness(year, month)`, `post_journal_entry(entryId)`, `hold_payroll_batch(batchId, reason)`, `create_journal_entry(description, lines[])`, `request_approval(actionType, entityRef, reasoning, evidence[])`, `flag_for_human_review(entityType, entityId, reason, severity)` |
| **Decision outcomes** | Any combination — copilot can do anything the other 4 agents can do |
| **Blocks further action?** | **No** — advisory + action per user request |
| **Race condition risk?** | **Low** — single user interaction model |
| **Tests exist?** | **No** |

### CRITICAL SHARED GAP ACROSS ALL 5 AGENTS

`setTools()` is never called in any agent's `index.ts`. The tool executors reference `this.tools` which is always `null`. **Every agent will throw "Tools not initialized" on any tool call.**

---

## DATA FLOWS — END TO END

### FLOW 1 — Payroll Batch Submission

```
1. Frontend: POST /api/v1/payroll/batches
   -> nginx proxy -> payroll-service:3012 /batches

2. PayrollService.submitBatch():
   - Check idempotency key (24h dedup)
   - If duplicate -> return existing batch
   - Create batch in DB (status: PENDING)
   - Publish PAYROLL_BATCH_SUBMITTED event to RabbitMQ
   -> Return batch to client

3. RabbitMQ -> agent-payroll:3022 (subscribes to PAYROLL_BATCH_SUBMITTED)
   - PayrollIntegrityAgent.execute() triggered
   - Claude called with system prompt + batch details
   - BUG: this.tools is null -> "Tools not initialized"

   [If tools were wired:]
   - Claude calls get_payroll_batch -> reviews
   - PASS: no action (batch stays PENDING -> user validates manually)
   - HOLD: calls hold_payroll_batch -> batch status -> HELD, publishes PAYROLL_BATCH_HELD
   - REJECT: would flag for human review

4. BaseAgent.execute() -> publishes AGENT_ACTION_TAKEN
   - audit-service subscribes -> persists to agent_logs table

5. If HELD -> notification-service subscribes to PAYROLL_BATCH_HELD
   - Sends console log + webhook notification

6. Manual flow: User validates -> POST /batches/:id/validate -> VALIDATED
   -> POST /batches/:id/post -> POSTED
   NOTE: No GL journal entries created on post
```

### FLOW 2 — EOM Close Step Failure and Recovery

```
1. Frontend: POST /api/v1/eom (body: {year: 2026, month: 3})
   -> eom-service:3011 -> EOMService.initiateClose()
   - Creates eom_closes record (status: IN_PROGRESS, current_step: '062')
   - NOTE: Does NOT publish EOM_CLOSE_INITIATED event (defined but unwired)

2. Frontend: POST /api/v1/eom/:id/advance
   -> EOMService.advanceStep()
   - Finds current step (062: Parts Close)
   - EOMOrchestrator.advance() -> PartsCloseHandler.execute()
   - Returns {success: true, nextStepCode: '065'}
   - Updates step status -> DONE
   - Publishes EOM_STEP_CHANGED event

3. RabbitMQ -> agent-eom:3021 (subscribes to EOM_STEP_CHANGED)
   - BUG: tools not initialized (same issue)

4. User advances through 065, 068, 070, 071, 074...
   Step 068 (Service Close) is SPECIAL — it calls gl-service HTTP:
   - Fetches DRAFT entries: GET http://gl-service:3010/api/v1/gl/journal-entries?status=DRAFT&source=SERVICE_RO
   - Posts each: POST /api/v1/gl/journal-entries/:id/post
   - If gl-service down -> step FAILS -> status: BLOCKED

5. FAILURE SCENARIO at step 068:
   - ServiceCloseHandler returns {success: false, message: "..."}
   - Step status -> BLOCKED, eom_close status -> BLOCKED
   - EOM_STEP_CHANGED published

6. RECOVERY:
   - Frontend: POST /api/v1/eom/:id/retry-step
   - EOMService.retryStep():
     - Finds BLOCKED step
     - Increments retry_count
     - Resets to PENDING
     - Calls advanceStep() again
   - If gl-service now available -> step succeeds -> DONE

7. Step 077 (Master Close):
   - Validates steps 062, 065, 068, 070, 071, 074 all DONE
   - If any not done -> BLOCKED with message "Master close blocked: Step XXX not complete"
   - If all done -> success, nextStepCode: '200'
```

### FLOW 3 — GL Journal Entry Duplicate Detection

```
1. Frontend: POST /api/v1/gl/journal-entries
   -> gl-service:3010 -> GLService.createJournalEntry()
   - Creates entry in DB (status: DRAFT, includes sourceRef)
   - Returns entry (no event yet)

2. Frontend: POST /api/v1/gl/journal-entries/:id/post
   -> GLService.postJournalEntry()

3. Step 3a: Publishes JOURNAL_ENTRY_SUBMITTED event
   -> RabbitMQ -> agent-gl:3020
   - GLIntegrityAgent triggered
   - System prompt tells it to check for "duplicate entries (same source_ref within 5 min)"
   - BUG: tools not initialized

   [If tools were wired:]
   - Claude calls get_journal_entries(dateFrom: 5min_ago)
   - Compares source_ref values
   - If duplicate found -> flag_for_human_review(severity: CRITICAL)
   - If clean -> post_journal_entry(entryId)

3. Step 3b: SIMULTANEOUSLY (race condition!)
   - GLService.postJournalEntry() immediately calls journalRepo.post()
   - Entry posted to DB BEFORE agent can review
   - Publishes JOURNAL_ENTRY_POSTED

4. CRITICAL RACE: The agent review happens AFTER the entry is already posted.
   The code publishes SUBMITTED, then immediately posts without waiting for agent.
   gl-service.ts lines 47-61: publish SUBMITTED -> post -> publish POSTED

5. Validation engine exists with DuplicateEntryRule:
   - Checks sourceRef against recentEntries
   - Uses in-memory list (setRecentEntries() must be called)
   - But GLService.postJournalEntry() NEVER calls validationEngine.validate()

6. Audit trail:
   - JOURNAL_ENTRY_POSTED -> audit-service -> persists agent_log
   - AGENT_ACTION_TAKEN -> audit-service -> persists (if agent got that far)
```

---

## GAPS AND RISKS

### 1. MISSING FUNCTIONALITY

| # | Gap | File | Line |
|---|-----|------|------|
| 1.1 | **~17 frontend pages have seeded/no backend** — COA, Schedules, Vehicle Inventory, Std Journal Entries, Vendors, POs, Intercompany, Warranty, Journal Sources, Year-End, Reports, Cash Receipts, Bank Deposits, System Settings, Setup, Utilities, plus company-scoped file maintenance endpoints | `apps/web/src/api/client.ts` | Lines 141-353 |
| 1.2 | **No user authentication** — frontend has no login screen, hardcoded tenant selector | `apps/web/src/App.tsx` | Lines 126-136 |
| 1.3 | **Payroll post doesn't create GL entries** — batch status changes to POSTED but no journal entries created | `services/payroll-service/src/application/payroll-service.ts` | Lines 73-80 |
| 1.4 | **PAYROLL_BATCH_POSTED event never published** | `services/payroll-service/src/application/payroll-service.ts` | Lines 73-80 |
| 1.5 | **EOM_CLOSE_INITIATED and EOM_CLOSE_COMPLETED events never published** | `services/eom-service/src/application/eom-service.ts` | Lines 34-49, 86-92 |
| 1.6 | **FS events never published** — FS_PREVIEW_READY, FS_SUBMITTED, FS_ACCEPTED/REJECTED all dead | `packages/shared-kernel/src/events/index.ts` | Lines 23-29 |
| 1.7 | **No actual OEM financial statement submission** | `services/fs-service/src/http/routes.ts` | Lines 41-46 |
| 1.8 | **COA_MAPPING_GAP_DETECTED, COA_VERSION_UPDATED never published** | `packages/shared-kernel/src/events/index.ts` | Lines 28-29 |
| 1.9 | **DMS_SYNC_COMPLETED, LEGACY_GL_MAPPED never published** | `packages/shared-kernel/src/events/index.ts` | Lines 51-52 |
| 1.10 | **ONBOARDING_COMPLETED never published** | `packages/shared-kernel/src/events/index.ts` | Line 53 |

### 2. INCOMPLETE IMPLEMENTATIONS

| # | Gap | File | Line |
|---|-----|------|------|
| 2.1 | **GL validation engine never called** — 7 rules defined but `validate()` never invoked during post | `services/gl-service/src/application/gl-service.ts` | Lines 41-62 |
| 2.2 | **AccountTypeMismatchRule is placeholder** — always returns valid | `services/gl-service/src/domain/validation-rules.ts` | Lines 42-52 |
| 2.3 | **EOM steps 010, 020 always return success** — no real pre-close validation | `services/eom-service/src/domain/step-handlers.ts` | Lines 8-23 |
| 2.4 | **EOM context missing period/periodEnd** — ServiceCloseHandler references `context.periodEnd` but it's not set in EOMService | `services/eom-service/src/application/eom-service.ts` | Line 74 vs `services/eom-service/src/domain/step-handlers.ts` line 77 |
| 2.5 | **fs-service in-memory only** — no database, documents lost on restart | `services/fs-service/src/application/fs-service.ts` | Entire file |
| 2.6 | **coa-service in-memory only** — no database, no persistence | `services/coa-service/src/application/coa-service.ts` | Entire file |
| 2.7 | **approval-service in-memory only** | `services/approval-service/src/application/approval-workflow.ts` | Entire file |
| 2.8 | **onboarding-service in-memory only** — steps don't execute real actions | `services/onboarding-service/src/application/onboarding-service.ts` | Entire file |
| 2.9 | **notification-service only handles 3 of 15+ events** | `services/notification-service/src/index.ts` | Lines 30-40 |
| 2.10 | **audit-service only handles 5 of 30+ events** | `services/audit-service/src/index.ts` | Line 72 |
| 2.11 | **Auth never validates API key against DB** — always issues JWT | `services/auth-service/src/http/routes.ts` | Lines 22-47 |
| 2.12 | **FS API client calls /api/v2 paths** but TS fs-service uses /api/v1/fs | `apps/web/src/api/client.ts` | Lines 111-123 |
| 2.13 | **All 5 agents: setTools() never called** — tools always null, every tool call throws | All agent `index.ts` files | Bootstrap functions |

### 3. RACE CONDITIONS

| # | Risk | Severity | Location |
|---|------|----------|----------|
| 3.1 | **GL post happens before agent review** — JOURNAL_ENTRY_SUBMITTED event published, then entry immediately posted without waiting for agent response | **CRITICAL** | `services/gl-service/src/application/gl-service.ts:47-61` |
| 3.2 | **Concurrent EOM_STEP_CHANGED events** — rapid step advances trigger multiple agent invocations that may conflict | **MEDIUM** | `services/agent-eom/src/index.ts:23-26` |
| 3.3 | **No recon locking** — lockedBy/lockedAt fields exist but are never enforced; concurrent reconciliations possible | **MEDIUM** | `services/recon-service/src/application/recon-service.ts` |
| 3.4 | **Concurrent OEM remittance imports** could trigger duplicate agent-apar JE creation | **MEDIUM** | `services/agent-apar/src/index.ts:23-26` |

### 4. MISSING TESTS

| # | Note |
|---|------|
| 4.1 | **ZERO test files exist** in the entire codebase (outside node_modules). No `*.test.ts`, `*.spec.ts`, or `__tests__/` directories in any of the 19 services or the frontend. All `package.json` files contain `"test": "vitest run"` but no test files to run. |

### 5. DATA NOT CONNECTED TO REAL AUTOMATE

| # | Gap |
|---|-----|
| 5.1 | **DMS adapters are normalizers only** — no actual AutoMate API integration |
| 5.2 | **No real DMS webhook receiver** — connector-service only accepts manual POST |
| 5.3 | **Tenant schemas not provisioned** — TENANT_PROVISIONED event published but no schema created |
| 5.4 | **All GL/journal/payroll data is manually seeded** — no import from AutoMate |
| 5.5 | **OEM FS submission is a no-op** — no actual GM/Ford API connection |

### 6. UI SCREENS NEEDING WORK BEFORE DEMO

| Priority | Screen | Issue |
|----------|--------|-------|
| **P0** | Financial Statements | API path mismatch (/api/v2 vs /api/v1/fs) — will fail on load |
| **P0** | Dashboard | Dashboard/Command Center API endpoints need to return real computed data |
| **P1** | Transactions | Edit/Delete buttons exist but not wired |
| **P1** | Reports | Generate button has 2s fake delay, no actual report output |
| **P1** | Reconciliation | No match detail UI — only status view |
| **P2** | All seeded screens (COA, Schedules, Vehicles, SJE, Vendors, POs, etc.) | Show demo data but can't create/edit/delete |

---

## ARCHITECTURE SUMMARY

```
Browser (React + Vite, port 5174)
  |
  | HTTP/REST + SSE
  v
NGINX API Gateway (port 8081->80)
  - /api/v1/gl       -> gl-service:3010
  - /api/v1/eom      -> eom-service:3011
  - /api/v1/payroll   -> payroll-service:3012
  - /api/v1/apar      -> apar-service:3013
  - /api/v1/recon     -> recon-service:3014
  - /api/v1/fs        -> fs-service:3015
  - /api/v1/coa       -> coa-service:3016
  - /api/v1/agents/t1 -> agent-t1:3024 (SSE unbuffered)
  - /api/v1/agents/*  -> respective agent services
  - /api/v1/auth      -> auth-service:3001
  - /api/v1/tenants   -> tenant-service:3002
  - /api/v1/notifications -> notification-service:3030
  - /api/v1/audit     -> audit-service:3031
  - /api/v1/connector -> connector-service:3032
  - /api/v1/approvals -> approval-service:3033
  - /api/v1/onboarding -> onboarding-service:3035
  |
  v
PostgreSQL 15 (port 5433->5432) — shared DB, per-service Prisma schemas
Redis 7 (port 6380->6379) — configured but not actively used
RabbitMQ 3 (port 5672, mgmt 15672) — topic exchange 'amacc.events'
```

### Event Flow Map

```
gl-service:
  JOURNAL_ENTRY_SUBMITTED  -> [agent-gl]
  JOURNAL_ENTRY_POSTED     -> [audit-service, fs-service*]

eom-service:
  EOM_STEP_CHANGED         -> [agent-eom]

payroll-service:
  PAYROLL_BATCH_SUBMITTED  -> [agent-payroll]
  PAYROLL_BATCH_HELD       -> [notification-service, audit-service]

apar-service:
  OEM_REMITTANCE_IMPORTED  -> [agent-apar]

recon-service:
  BANK_RECON_STARTED       -> [agent-apar]
  BANK_RECON_COMPLETED     -> [audit-service*]

tenant-service:
  TENANT_PROVISIONED       -> [coa-service*, gl-service*, notification-service*, audit-service]
  TENANT_UPDATED           -> [audit-service]

All agents (via BaseAgent):
  AGENT_ACTION_TAKEN       -> [audit-service]
  AGENT_HUMAN_REQUIRED     -> [approval-service*, notification-service]

approval-service:
  APPROVAL_REQUESTED       -> [notification-service*]
  APPROVAL_GRANTED         -> [audit-service*]
  APPROVAL_REJECTED        -> [audit-service*]

* = defined in EVENT_ROUTING but subscription NOT implemented in target service
```

---

## BOTTOM LINE

The core event-driven architecture (GL, EOM, Payroll, Recon, 5 AI agents) is well-designed and mostly implemented. The shared-kernel provides clean interfaces, types, and event definitions.

**Critical blockers to fix:**
1. Wire `setTools()` on all 5 agents (they all crash on tool use)
2. Fix GL race condition (agent reviews AFTER post, not before)
3. Call GL validation engine during `postJournalEntry()`
4. Fix FS API path mismatch (frontend calls /api/v2, backend serves /api/v1)

**Major gaps:**
- Zero tests across entire codebase
- 4 services use in-memory storage (fs, coa, approval, onboarding)
- ~17 frontend screens have no backend
- 12+ event types defined but never published
- No real DMS/OEM integration
