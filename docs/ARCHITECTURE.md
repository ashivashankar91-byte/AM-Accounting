# AutoMate 2.0 — Accounting Module Architecture Reference

> **Audience:** Engineering team, Dallas leadership presentation  
> **Date:** May 2026  
> **Status:** Production-ready. All 6 waves complete.

---

## 1. System Overview

AutoMate 2.0 Accounting Module (`amacc/`) is the AI-native replacement for the COBOL-based
General Ledger system that has run at automotive dealerships since the late 1980s.

**What was replaced:**
- A COBOL monolith of ~205 programs managing GL accounts, journal entries, EOM close,
  schedule tracking, AP/AR, payroll posting, year-end close, and financial statement generation
- ISAM flat-file storage (GL, HISTTRAN, JOURNAL, SOURCE, SCHEDULE, FINSTAT files)
- No transaction wrapper → chronic out-of-balance conditions requiring dedicated repair programs
- Zero AI/advisory capability — accountants discovered errors days to weeks after posting
- Single-tenant (per-company) with no multi-company consolidation without COBOL file merging

**What replaced it:**
- 30 TypeScript microservices, each owning one domain
- PostgreSQL with SERIALIZABLE transactions (eliminates the entire OOB failure class)
- Multi-tenant via `x-tenant-id` header (one database, many dealers)
- RabbitMQ event bus (domain events replace COBOL file sync calls)
- 5 AI agents using Claude Sonnet (`claude-sonnet-4-20250514`) for real-time intelligence
- Prisma ORM with typed schemas per service
- React front-end communicating exclusively through the Fastify API Gateway

---

## 2. Service Map

### 2.1 Infrastructure Services

| Service | Port | Purpose |
|---------|------|---------|
| `api-gateway` | 3000 | Fastify reverse proxy. Single entry point. Rate limiting (300 req/min/tenant). Request logging. `/health/services` fan-out. |
| `auth-service` | 3001 | JWT issuance and validation. Admin key management. Developer bypass routes (dev-only). |
| `user-service` | 3002 | User management. Dealer staff, roles, permissions. |

### 2.2 Core Accounting Services

| Service | Port | COBOL Ancestry | Purpose |
|---------|------|----------------|---------|
| `gl-service` | 3010 | `tranpost.cbl`, `validate.cbl`, `inquiryn.cbl`, `inqtran.cbl`, `tranpr.cbl`, `transumm.cbl`, `consolgl.cbl` (13 more absorbed) | General Ledger. Journal entry lifecycle: DRAFT → PENDING_REVIEW → POSTED. Account management. Period balance tracking. Trial balance. Inquiry API. History. |
| `eom-service` | 3011 | `purge.cbl`, `eomrpt.cbl`, `13thmenu.cbl`, `addglto13th.cbl` (eliminated), `syncglsched13th.cbl` (eliminated), `komsystem.cbl` | End-of-Month Close. 10-step orchestration (ACCT_010…ACCT_300). Year-end close. 13th-month accounting. |
| `payroll-service` | 3012 | `payroll*.cbl` | Payroll batch ingestion, GL integration, earning code mapping. |
| `apar-service` | 3013 | `javsup.cbl`, Java OEM remittance | AP/AR. OEM remittance import. Bank reconciliation. AR aging. |
| `recon-service` | 3014 | — | Bank reconciliation workflows. |
| `schedule-service` | 3030 | `schedinvk.cbl`, `schedpost.cbl` | Schedule (deferred transaction) management. GL account assignments. Purge tracking. |

### 2.3 Intelligence Layer — AI Agents

| Service | Port | Model | Subscribes To | Advisory Capability |
|---------|------|-------|---------------|---------------------|
| `agent-gl` | 3020 | `claude-sonnet-4-20250514` | `JOURNAL_ENTRY_SUBMITTED`, `JOURNAL_ENTRY_POSTED` | Pre-post anomaly detection. Revenue/expense type validation. Module source integrity. Parts margin. |
| `agent-eom` | 3021 | `claude-sonnet-4-20250514` | `EOM_STEP_CHANGED`, `EOM_CLOSE_COMPLETED`, `YEAR_END_COMPLETED` | Close readiness advisory. Step failure diagnosis. Unposted blocking detection. |
| `agent-payroll` | 3022 | `claude-sonnet-4-20250514` | `PAYROLL_BATCH_SUBMITTED` | Double-posting detection. Per-employee variance. Earning code validation. Tech hours cross-check. |
| `agent-apar` | 3023 | `claude-sonnet-4-20250514` | `OEM_REMITTANCE_IMPORTED`, `BANK_RECON_STARTED` | Warranty claim matching. Labor rate verification. Fraud detection (part claimed but not on RO). |
| `agent-t1` | 3024 | `claude-sonnet-4-20250514` | HTTP `POST /api/v1/copilot/t1/chat` (SSE) | Natural language interface to all accounting data. Write actions with approval workflow. |

> **Auto-approve timeout:** `gl-service` runs `AgentReviewTimeoutJob` every 10 seconds. If a
> `PENDING_REVIEW` entry has not been reviewed within `AGENT_REVIEW_TIMEOUT_SECONDS` (default: 30s),
> it is auto-approved with `approvedByUserId = 'AUTO_TIMEOUT'`. This prevents Claude API outages
> from blocking GL posting.

### 2.4 Financial Reporting Services

| Service | Port | Purpose |
|---------|------|---------|
| `fs-service` | 3045 | OEM Financial Statement generation. GM/Ford/FCA/Toyota/Honda formats. Preview, validate, submit. |
| `coa-service` | 3044 | Canonical Chart of Accounts. OEM GL code mappings. Tenant override management. |
| `analytics-service` | 3041 | Dealer analytics dashboard. P&L, tech productivity, parts margin. (Data from GL — no mock data.) |
| `cashflow-service` | 3043 | Cash flow forecasting from GL trial balance. |
| `compliance-service` | 3042 | Compliance rule engine. Alert generation from GL patterns. |
| `query-service` | 3047 | Saved query management. Natural language query history. |

### 2.5 Operations Services

| Service | Port | Purpose |
|---------|------|---------|
| `group-service` | 3040 | Multi-company groups. Consolidated GL trial balance via live fan-out. |
| `orchestrator-service` | 3048 | Long-running workflow orchestration. Prisma-backed task tracking. |
| `approval-service` | 3054 | Human approval workflow for agent-initiated actions. |
| `notification-service` | 3046 | Event-driven notifications. Subscribes to all Wave 1-4 domain events. |
| `webhook-service` | 3050 | Outbound webhook delivery to dealer systems. |
| `audit-service` | 3053 | Immutable audit trail. All agent actions, approvals, and postings. |

### 2.6 Identity and Integration Services

| Service | Port | Purpose |
|---------|------|---------|
| `tenant-service` | 3051 | Tenant provisioning and management. |
| `onboarding-service` | 3058 | New dealer onboarding workflow. DMS mapping, legacy GL migration. |
| `connector-service` | 3055 | DMS connector. Ingests SERVICE_RO, PARTS, DEAL, PAYROLL events from dealer DMS. |
| `document-service` | 3057 | Document storage for FS submissions, audit attachments. |

---

## 3. Event Catalog

All domain events are typed in `packages/shared-kernel/src/events/index.ts`.

### GL Events

| Event | Publisher | Consumers | Payload |
|-------|-----------|-----------|---------|
| `JOURNAL_ENTRY_SUBMITTED` | gl-service | agent-gl | `entryId`, `description`, `lineCount`, `totalDebits` |
| `JOURNAL_ENTRY_POSTED` | gl-service | audit-service, fs-service, agent-gl, notification-service (>$100k) | `entryId`, `totalDebits`, `totalCredits`, `lineCount` |
| `JOURNAL_ENTRY_HELD` | gl-service | notification-service, audit-service | `entryId`, `reason` |
| `GL_ANOMALY_DETECTED` | gl-service | agent-t1, notification-service | `entryId`, `anomalyType` |
| `GL_INTEGRITY_ALERT` | agent-gl (via approval-service) | notification-service, audit-service | `tenantId`, `entryId`, `alertType`, `details` |

### EOM Events

| Event | Publisher | Consumers | Payload |
|-------|-----------|-----------|---------|
| `EOM_CLOSE_INITIATED` | eom-service | agent-eom, audit-service | `closeId`, `periodYear`, `periodMonth` |
| `EOM_STEP_CHANGED` | eom-service | agent-eom | `closeId`, `stepCode`, `status` |
| `EOM_CLOSE_BLOCKED` | eom-service | notification-service, agent-eom, agent-t1 | `closeId`, `reason` |
| `EOM_CLOSE_COMPLETED` | eom-service | fs-service, audit-service, notification-service | `closeId`, `periodYear`, `periodMonth` |
| `TRIAL_BALANCE_READY` | eom-service | fs-service, agent-t1 | `periodYear`, `periodMonth` |
| `YEAR_END_COMPLETED` | eom-service | fs-service, audit-service, notification-service | `tenantId`, `fiscalYear` |
| `THIRTEENTH_MONTH_FINALIZED` | eom-service | fs-service, audit-service, notification-service | `year`, `periodMonth` |

### Schedule Events

| Event | Publisher | Consumers | Payload |
|-------|-----------|-----------|---------|
| `SCHEDULE_PURGED` | eom-service | audit-service, notification-service | `tenantId`, `schedulesPurged` |
| `SCHEDULE_DETAIL_REQUESTED` | schedule-service | gl-service | `journalEntryId`, `scheduleNumber` |
| `SCHEDULE_GL_ACCOUNTS_CHANGED` | schedule-service | gl-service, audit-service | `tenantId`, `scheduleNumber` |
| `SCHEDULE_DELETED` | schedule-service | gl-service, audit-service | `tenantId`, `scheduleNumber` |

### Payroll / AP-AR Events

| Event | Publisher | Consumers | Payload |
|-------|-----------|-----------|---------|
| `PAYROLL_BATCH_SUBMITTED` | payroll-service | agent-payroll | `batchId`, `totalAmount`, `batchRef` |
| `PAYROLL_BATCH_POSTED` | payroll-service | audit-service | `batchId` |
| `OEM_REMITTANCE_IMPORTED` | apar-service | agent-apar | `count`, `totalAmount` |
| `BANK_RECON_STARTED` | apar-service | agent-apar | `reconId` |
| `BANK_RECON_COMPLETED` | apar-service | audit-service | `reconId` |

### Agent Events

| Event | Publisher | Consumers | Payload |
|-------|-----------|-----------|---------|
| `AGENT_HUMAN_REQUIRED` | BaseAgent (all agents) | approval-service, notification-service | `agentName`, details |
| `AGENT_ACTION_TAKEN` | BaseAgent (all agents) | audit-service | `agentName`, `actionTaken`, `outcome` |
| `AGENT_ACTION_APPROVED` | approval-service | — | `actionId` |
| `AGENT_ACTION_REJECTED` | approval-service | — | `actionId` |

### Connector Line-Level Events

| Event | Publisher | Consumers |
|-------|-----------|-----------|
| `SERVICE_RO_CLOSED` | connector-service | agent-gl, gl-service, audit-service |
| `PARTS_INVOICE_CLOSED` | connector-service | agent-gl, gl-service, audit-service |
| `DEAL_PRODUCT_DETAIL_RECEIVED` | connector-service | agent-gl, gl-service, audit-service |
| `VEHICLE_PURCHASED` | connector-service | agent-gl, gl-service, audit-service |
| `VEHICLE_TRANSFERRED` | connector-service | agent-gl, gl-service, audit-service |
| `PAYROLL_LINES_SUBMITTED` | connector-service | agent-payroll, payroll-service, audit-service |
| `FINANCE_CHARGE_POSTED` | connector-service | agent-gl, gl-service, audit-service |
| `CREDIT_CARD_BATCH_SETTLED` | connector-service | agent-gl, gl-service, audit-service |
| `CASH_RECEIPT_DETAILED` | connector-service | agent-gl, gl-service, audit-service |
| `YEAR_END_CLOSE_POSTED` | connector-service | agent-eom, gl-service, audit-service |
| `AMDB_DROPMATE_IMPORTED` | connector-service | agent-gl, gl-service, audit-service |

---

## 4. Data Flow: Journal Entry Lifecycle

```
Dealer DMS                connector-service
     │                         │
     │  SERVICE_RO_CLOSED       │
     │ ──────────────────────► │
     │                         │  JOURNAL_ENTRY_SUBMITTED event
     │                         │  POST /api/v1/gl/journal-entries/:id/submit
     │                         ▼
                          gl-service
                         (status: DRAFT → PENDING_REVIEW)
                               │
                               │  publishes JOURNAL_ENTRY_SUBMITTED
                               ▼
                         RabbitMQ
                               │
                         ┌─────┴──────────────────────┐
                         ▼                            ▼
                    agent-gl                    (30s timeout)
                    (Claude review)         AgentReviewTimeoutJob
                         │                            │
                    ┌────┴────┐                       │
                    ▼         ▼                       │
                 APPROVE    FLAG                      │
                    │         │                       │
                    │    approval-service              │
                    │    (human review queue)          │
                    │         │                       │
                    └────┬────┘                       │
                         ▼                            │
                    gl-service                        │
           (status: PENDING_REVIEW → POSTED)◄─────────┘
                               │
                               │  SERIALIZABLE $transaction:
                               │  1. status → POSTED
                               │  2. GLAccountPeriodBalance upsert (debit/credit)
                               │  3. HistoryTransaction insert
                               │  4. outboxEvent → JOURNAL_ENTRY_POSTED
                               ▼
                         RabbitMQ
                  ┌────────────┬───────────────┐
                  ▼            ▼               ▼
            audit-service  fs-service   notification-service
                                        (if totalDebits > $100k)
```

**Key invariant:** Steps 1-4 are a single `$transaction({ isolationLevel: 'Serializable' })`.
If any step fails, all four roll back. This is the single change that eliminates the entire
out-of-balance failure class from COBOL (`fixoobtran.cbl`, `fixorphan.cbl`, `dumpoobtran.cbl`
are now permanently obsolete).

---

## 5. Intelligence Layer

### 5.1 Why Agents?

COBOL enforced rules (invariants). Rules catch violations that have already happened.
Agents catch patterns that rules cannot — trends, anomalies, and context requiring judgment.

| Capability | COBOL Rules | AI Agents |
|------------|-------------|-----------|
| "This entry is unbalanced" | ✅ Catches it | ✅ Catches it |
| "This amount is 3x the 90-day average" | ❌ No concept of history | ✅ Flags it |
| "This RO has revenue but no tech pay" | ❌ No cross-line check | ✅ Flags it |
| "This payroll batch is a duplicate" | ❌ No idempotency | ✅ Detects same-period repost |
| "Step ACCT_100 failed — here is why" | ❌ Error code only | ✅ Root cause analysis |
| "Are we ready to close?" | ❌ No readiness check | ✅ Full context report |
| "Show me RO 12345 journal entries" | ❌ Screen only | ✅ Natural language |

### 5.2 Agent Failure Modes

All agents are designed for graceful degradation:

| Failure | Behavior |
|---------|----------|
| Claude API unavailable | `runWithTools` throws → consumer nacks → RabbitMQ requeues |
| Anthropic key missing | Service fails to start (fail-fast at startup) |
| Agent-gl down | `AgentReviewTimeoutJob` auto-approves after 30s |
| Agent result unclear | `humanRequired = true` → approval-service queue |
| Tool call fails | Exception surfaces to Claude → Claude explains limitation |

### 5.3 T1 Copilot Tools

The T1 natural language interface (`POST /api/v1/copilot/t1/chat`) provides SSE streaming
responses. Claude has access to 18 tools covering the full accounting API:

| Tool | Purpose |
|------|---------|
| `get_gl_accounts` | All GL accounts for tenant |
| `get_journal_entries` | Journal entries with date/status/source filters |
| `get_trial_balance` | Period trial balance |
| `get_payroll_batch` | Payroll batch details |
| `get_eom_steps` | EOM close step list with blockers |
| `get_fs_preview` | OEM financial statement preview |
| `get_pending_approvals` | Open approval requests |
| `get_eom_readiness` | Close readiness report |
| `get_tech_productivity` | Technician flat-rate vs clock hours |
| `get_parts_profitability` | Parts gross profit by part number |
| `get_payroll_by_earning_code` | Payroll breakdown by code |
| `get_department_pl` | Department-level P&L from journal line codes |
| `get_deal_product_profitability` | F&I product profitability from DealProductLine |
| `post_journal_entry` | Post an entry (requires approval if large) |
| `hold_payroll_batch` | Hold for review |
| `create_journal_entry` | Create correcting entry |
| `request_approval` | Escalate action to human approver |
| `flag_for_human_review` | Flag item for human review |

---

## 6. COBOL Migration Summary

| Category | Count | Notes |
|----------|-------|-------|
| **Total programs in `acct/src/`** | 205 | Production programs |
| **BUILD decisions** | 36 | Core business logic extracted and rebuilt |
| **ABSORB decisions** | 28 | Logic absorbed into Prisma/Zod patterns (Komodo, file sync) |
| **SKIP — screens** | 45 | COBOL screen programs (`tranup*.cbl`, `*vw.cbl`) — replaced by React UI |
| **SKIP — print utilities** | 22 | `print*.cbl`, `rpt*.cbl` — replaced by report endpoints |
| **SKIP — repair programs** | 9 | `fixoobtran.cbl`, `fixorphan.cbl`, etc. — obsolete (SERIALIZABLE TX) |
| **SKIP — data conversion** | 18 | One-time ETL, `cnv*.cbl` — handled by migration scripts |
| **SKIP — eliminated** | 47 | Year-specific FS (`finstm01…99`), snapshot syncs (`addglto13th`, `syncglsched13th`), DB rebuild calls |

### COBOL Programs Extracted (Wave by Wave)

| Wave | Programs | Key Extraction |
|------|----------|---------------|
| 1 — GL Core | `tranpost.cbl`, `validate.cbl`, 12 Komodo/query programs | Atomic posting, Serializable TX |
| 2 — Journal/Source | `autopost.cbl`, `revadjt.cbl`, sync programs | Outbox event pattern |
| 3 — EOM Close | `purge.cbl` (ACCT_100…ACCT_300), schedule programs | 10-step orchestration |
| 4 — Inquiry/Reports/FS | `inquiryn.cbl`, `inqtran.cbl`, `tranpr.cbl`, `transumm.cbl`, `consolgl.cbl`, `consolexpgl.cbl`, `13thmenu.cbl` | Live fan-out consolidation, 13th month |
| 5 — Stabilization | (no COBOL) | Security, mock cleanup |
| 6 — Intelligence | (no COBOL) | AI agents, net-new capability |

---

## 7. Business Invariants Catalog

These invariants were extracted from COBOL and are now enforced in TypeScript. All are tested.

### GL Posting Invariants (INV-01 → INV-08)

| ID | Invariant | COBOL Source | TypeScript Location |
|----|-----------|-------------|---------------------|
| INV-01 | Journal/Detail/HistTran writes are atomic | `tranpost.cbl` (manual file I/O) | `$transaction({ isolationLevel: 'Serializable' })` in `gl-service` |
| INV-02 | Inactive/header accounts rejected before any writes | `tranpost.cbl` PRE-EDIT-GL-ROUTINE | `validateAccountsPreEdit()` in GLService |
| INV-03 | Monetary overflow protection (`Decimal(15,2)`) | `tranpost.cbl` JOURNAL-BALANCE overflow | Prisma `@db.Decimal(15,2)` |
| INV-04 | Year-end posting: skip journal/detail updates | `tranpost.cbl` `GLOBAL-YE-IS-IN-PROGRESS` | `priorPeriodAdjustment` flag in JournalEntry |
| INV-05 | COS/INV chained posting: 3 sub-entries | `tranpost.cbl` "If chained sale" | `postCOSINVChain()` |
| INV-06 | Duplicate histtran key: handled (no infinite loop) | `tranpost.cbl` HIST-ERROR-RTN | `upsert` replaces `create` |
| INV-07 | Closed period rejects entries (except adj with reason) | COBOL had no period check | `PostingPeriodClosedError`, `adjustmentReason` required |
| INV-08 | Unit count sign rules per account type and reversal | `tranpost.cbl` CALC-SIGNS | Sign logic in `postLineToLedger()` |

### EOM Invariants (INV-EOM-01 → INV-EOM-10)

| ID | Invariant | COBOL Source | TypeScript Location |
|----|-----------|-------------|---------------------|
| INV-EOM-01 | All transactions must be posted before close | `purge.cbl` step pre-check | EOM step ACCT_010 pre-condition |
| INV-EOM-02 | Step ordering: ACCT_010 < ACCT_020 < … < ACCT_300 | Implicit in purge.cbl | `StepDependencyGraph` in eom-service |
| INV-EOM-03 | Steps ≤ ACCT_070 are safe to retry | `purge.cbl` retry logic | Retry policy in step orchestration |
| INV-EOM-04 | Steps ≥ ACCT_100 are destructive (no undo) | `purge.cbl` purge section | `IRREVERSIBLE` flag on step definitions |
| INV-EOM-05 | No concurrent close sessions | COBOL single-process | `EOMClose.status = ACTIVE` lock |
| INV-EOM-06 | Year-end must precede first fiscal month of new year | COBOL calendar check | Precondition on `EOM_CLOSE_INITIATED` |
| INV-EOM-07 | 13th month must be finalized before 11th fiscal month | `13thmenu.cbl` timing | Precondition in eom-service |
| INV-EOM-08 | Schedules purged in 7 distinct type categories | `purge.cbl` ACCT_100 7-pass | Schedule purge types enum |
| INV-EOM-09 | Missing document purge (ACCT_300) requires prior steps | `purge.cbl` ACCT_300 | Dependency on ACCT_200 complete |
| INV-EOM-10 | EOM report generation (ACCT_062) before archive steps | `eomrpt.cbl` | Step dependency |

### Year-End Invariants (YE-INV-01 → YE-INV-09)

| ID | Invariant | Notes |
|----|-----------|-------|
| YE-INV-01 | Retained earnings computed from net income | Income accounts → 3000 |
| YE-INV-02 | Year-end posting bypasses period close check | `priorPeriodAdjustment` flag |
| YE-INV-03 | All schedules must be zeroed before year-end | Schedule reconciliation |
| YE-INV-04 | Autopost reserved sources (09, 88) on year-end | Source code check |
| YE-INV-05 | Year balance snapshot created | `GLAccountYearBalance` |
| YE-INV-06 | Balance sheet accounts carry forward | Type A, L, Equity |
| YE-INV-07 | Income statement accounts zeroed | Type R, C, E |
| YE-INV-08 | 13th month finalization required | `THIRTEENTH_MONTH_FINALIZED` event |
| YE-INV-09 | Post-year-end entries require override | `YEAR_END_COMPLETED` state |

### Security / Multi-Tenancy Invariants

| ID | Invariant | Location |
|----|-----------|----------|
| SEC-01 | Every route returns 401 if `x-tenant-id` missing | All service route handlers |
| SEC-02 | Service startup throws if `AMACC_JWT_SECRET` missing | All service `index.ts` |
| SEC-03 | Service startup throws if `ANTHROPIC_API_KEY` missing | All agent `index.ts` |
| SEC-04 | Creator cannot approve own journal entry (non-DMS sources) | `SegregationOfDutiesError` in gl-service |
| SEC-05 | Developer bypass routes disabled in non-dev environments | `NODE_ENV === 'development'` check |
| SEC-06 | Monetary amounts: `Prisma.Decimal` only (no `number` floats) | All financial fields |

---

## 8. COBOL vs. AutoMate 2.0 Comparison Table

| Function | COBOL | AutoMate 2.0 | Improvement |
|----------|-------|-------------|-------------|
| **Transaction posting** | 3 ISAM file writes, no transaction wrapper | `$transaction({ isolationLevel: 'Serializable' })` | OOB impossible; repair programs obsolete |
| **Data storage** | Flat-file ISAM (GL, HISTTRAN, JOURNAL, SCHED) | PostgreSQL with Prisma ORM | ACID, index performance, SQL queries |
| **Multi-tenancy** | One database per dealer, separate COBOL binaries | Shared schema, `x-tenant-id` header, row-level isolation | 1 deployment serves N dealers |
| **Financial statement** | 99 year-specific programs (`finstm01…finstm99`) | 1 config-driven generator | No "add new year" deployment needed |
| **Consolidated GL** | COBOL file merge (CONSOLEXPGL) with ISAM copy | Live fan-out HTTP to source tenants at query time | No data duplication, real-time consolidation |
| **Error discovery** | At EOM close (15-30 days after posting) | At posting time (agent review, 30s max) | 10-15 day close → 2-3 day close |
| **Month-end close** | Manual sequence, ACCT_010…ACCT_300 | Automated step orchestration with agent diagnostics | Close time reduced dramatically |
| **AP/AR matching** | Manual screen entry | AI-assisted remittance matching via Claude | Fuzzy matching, short-pay detection |
| **Payroll integrity** | No duplicate detection | Idempotency key check + per-employee variance | Prevents costly payroll errors |
| **Anomaly detection** | None | GL Integrity Agent (real-time) | Pre-post flagging, not post-close discovery |
| **Natural language** | None | T1 Copilot (SSE streaming) | Controllers can query in plain English |
| **Secrets management** | Hardcoded in COBOL source | Env vars, fail-fast at startup | Security posture matches modern standards |
| **Testing** | None | vitest unit tests, all invariants tested | Regressions caught before deployment |
| **Observability** | None | Structured pino logging, audit trail, agent logs | Full traceability of all actions |

---

## 9. Technology Stack

| Layer | Technology | Version |
|-------|------------|---------|
| Runtime | Node.js | ≥ 20 |
| Language | TypeScript | ^5.4.5 |
| HTTP Framework | Fastify | ^4.28.1 |
| ORM | Prisma | ^5.17.0 |
| Database | PostgreSQL | 15 |
| Message Broker | RabbitMQ | 3-management |
| Cache | Redis | 7 |
| AI | Anthropic Claude | `claude-sonnet-4-20250514` |
| Validation | Zod | ^3.23.8 |
| Testing | vitest | ^1.6.0 |
| DI Container | tsyringe | ^4.8.0 |
| Gateway | @fastify/http-proxy + @fastify/rate-limit | ^9.x |
| Containerization | Docker Compose | — |
| Monetary | `Prisma.Decimal` / `@db.Decimal(15,2)` | — |

---

## 10. Security Architecture

### Required Environment Variables (all fail-fast at startup)

| Variable | Services | Purpose |
|----------|----------|---------|
| `AMACC_JWT_SECRET` | All services (except auth) | JWT verification |
| `JWT_SECRET` | auth-service | JWT issuance |
| `ADMIN_API_KEY` | auth-service, tenant-service | Admin API authentication |
| `ANTHROPIC_API_KEY` | All 5 agent services | Claude API access |
| `AMACC_INTERNAL_TOKEN` | consolidation-service → gl-service | Service-to-service calls |

### Tenant Isolation

- Every HTTP route handler checks `x-tenant-id` header; missing → 401
- Prisma queries always include `tenantId` in `WHERE` — no cross-tenant data leakage
- RabbitMQ events carry `tenantId` in all payloads
- Agent tool executors scope all GL/payroll queries to the event's `tenantId`

### What Was Removed (Wave 5 Security Sprint)

- `scripts/aws-key.pem` — deleted from repo
- `scripts/cloudflared.exe` — deleted
- `apps/web/amacc_mock_api.py` — deleted (was serving fake financial data)
- `services/auth-service/src/http/developer-routes.ts` — gated to `NODE_ENV=development` only
- All `|| 'tenant-kunes'` tenant fallbacks → 401

---

## 11. Archived Services

Four services were archived to `amacc/archived-services/` during Wave 5. They are not deployed.

| Service | Reason |
|---------|--------|
| `esg-service` | ESG reporting not in Phase 1 scope. No COBOL equivalent. |
| `revenue-service` | Revenue tracking handled by gl-service income statement. Redundant. |
| `ml-service` | ML inference replaced by Claude API in agent services. Had `MOCK_CASHFLOW_HISTORY`. |
| `data-quality-service` | Data quality alerting absorbed into compliance-service rule engine. |

---

## 12. Development Guide

### Running Locally

```bash
# Prerequisites: Docker Desktop, Node.js ≥20

# Create .env from template
cp amacc/.env.example amacc/.env
# Required: AMACC_JWT_SECRET, JWT_SECRET, ADMIN_API_KEY, ANTHROPIC_API_KEY

cd amacc
docker-compose up -d postgres rabbitmq redis
npm install
npx prisma migrate dev          # runs all service migrations
npm run dev                     # starts all services
```

### Required .env Variables

```dotenv
AMACC_JWT_SECRET=<your-32-char-secret>
JWT_SECRET=<your-32-char-secret>
ADMIN_API_KEY=<your-admin-key>
ANTHROPIC_API_KEY=sk-ant-...     # required for agent services
AMACC_INTERNAL_TOKEN=<token>     # used for consolidation fan-out
```

### Adding a New Service

1. Copy `services/recon-service/` as template
2. Add Prisma schema to `services/<new>/prisma/schema.prisma`
3. Register output path: `output = "../node_modules/.prisma/<new>-client"`
4. Add to `docker-compose.yml` with `<<: *service-env`
5. Add proxy entry to `services/api-gateway/src/index.ts`
6. Register event types in `packages/shared-kernel/src/events/index.ts`

### Running Tests

```bash
# All tests (from amacc/ root)
npm run test

# Single service
cd services/gl-service
npx vitest run

# Agent tests
cd services/agent-gl && npx vitest run
cd services/agent-eom && npx vitest run
cd services/agent-t1  && npx vitest run
```
