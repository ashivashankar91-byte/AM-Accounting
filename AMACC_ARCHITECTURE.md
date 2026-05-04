# AMACC — Accounting Cloud Platform Architecture

**Version**: 1.0 | **Date**: April 2, 2026 | **Platform**: Multi-tenant SaaS for automotive dealership accounting

---

## 1. Platform Overview

AMACC (AutoMate Accounting Cloud) is a cloud-native, AI-augmented, multi-tenant accounting platform purpose-built for franchised automotive dealerships. It replaces legacy on-premise dealership accounting systems (CDK, Reynolds, Dealertrack) with a modern microservices architecture featuring autonomous AI agents that validate every financial transaction in real-time.

### 1.1 Key Design Principles
- **Multi-tenant isolation** via tenant schemas (PostgreSQL row-level tenancy with `tenantId` on every table)
- **Event-driven architecture** using RabbitMQ with 40+ domain event types
- **AI agent layer** — 5 specialized Claude-powered agents that validate, audit, and orchestrate accounting workflows
- **OEM Financial Statement compliance** — GM Standard and Ford OWS format generation + submission
- **13th-month period support** — Year-end adjustment period native to the data model
- **NADA-standard Chart of Accounts** — 55+ accounts following National Automobile Dealers Association conventions
- **SOC 2 / SOX audit compliance** — Immutable audit trail with DB-level triggers preventing UPDATE/DELETE

### 1.2 Technology Stack
| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Vite 5.4 + TailwindCSS + React Query |
| API Gateway | NGINX (reverse proxy, CORS, tenant header injection) |
| Microservices | Node.js 20 + Fastify 4.28 + TypeScript |
| ORM / DB | Prisma 5.x + PostgreSQL 15 |
| Messaging | RabbitMQ (AMQP) |
| Caching | Redis 7 |
| AI / LLM | Anthropic Claude (via shared-kernel BaseAgent) |
| DI Container | tsyringe (inversion of control) |
| Validation | Zod schemas |
| Containerization | Docker + docker-compose (35 services) |
| Monorepo | Turborepo-style workspace with shared-kernel package |

---

## 2. System Architecture Diagram (C4 — Container Level)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              EXTERNAL SYSTEMS                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐    │
│  │ AutoMate │  │ CDK      │  │ Reynolds │  │ Dealer-  │  │ OEM Portals   │    │
│  │ DMS      │  │ Drive    │  │ & ERA    │  │ track    │  │ (GM/Ford/etc) │    │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───────┬───────┘    │
│       └──────────────┴──────────────┴──────────────┘               │            │
│                              │ REST/Webhook                        │            │
└──────────────────────────────┼─────────────────────────────────────┼────────────┘
                               ▼                                     ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                              AMACC PLATFORM                                      │
│                                                                                  │
│  ┌──────────────┐     ┌──────────────────────────────────────────────────┐       │
│  │              │     │              API Gateway (NGINX :8081)           │       │
│  │   React SPA  │────▶│  /api/v1/* → microservice routing               │       │
│  │  (Vite :5174)│     │  /api/v2/* → v2 FS endpoints                    │       │
│  │              │     │  x-tenant-id header injection                    │       │
│  │  38 Pages    │     └──────┬──────────┬──────────┬──────────┬─────────┘       │
│  │  9 Components│            │          │          │          │                  │
│  │  46 API      │            ▼          ▼          ▼          ▼                  │
│  │  client grps │     ┌─────────┐ ┌──────────┐ ┌────────┐ ┌────────────┐       │
│  └──────────────┘     │  CORE   │ │OPERATIONS│ │ AGENTS │ │ PLATFORM   │       │
│                       │SERVICES │ │ SERVICES │ │        │ │ SERVICES   │       │
│                       └────┬────┘ └────┬─────┘ └───┬────┘ └─────┬──────┘       │
│                            │           │           │            │               │
│                            ▼           ▼           ▼            ▼               │
│                       ┌──────────────────────────────────────────────┐           │
│                       │          RabbitMQ (Event Bus :5672)          │           │
│                       │     40+ event types with routing map        │           │
│                       └──────────────────┬──────────────────────────┘           │
│                                          │                                      │
│                            ┌─────────────┼─────────────┐                       │
│                            ▼             ▼             ▼                        │
│                       ┌─────────┐  ┌──────────┐  ┌──────────┐                  │
│                       │PostgreSQL│  │  Redis   │  │ Anthropic│                  │
│                       │  :5433  │  │  :6380   │  │  Claude  │                  │
│                       │ (Prisma)│  │ (Cache)  │  │  (LLM)   │                  │
│                       └─────────┘  └──────────┘  └──────────┘                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Microservice Inventory (35 Services)

### 3.1 Core Accounting Services

| Service | Port | Database | Description |
|---|---|---|---|
| **gl-service** | 3010 | Prisma (GLAccount, JournalEntry, JournalLine, DealProductLine, IntercompanyEntry, OutboxEvent) | General Ledger — chart of accounts, journal entries, trial balance, balance sheet, income statement, cash flow statement, command center, dashboard |
| **eom-service** | 3011 | Prisma (EOMClose, EOMStep) | End-of-Month close orchestration — 13-step close process with dependency graph |
| **payroll-service** | 3012 | Prisma (PayrollBatch, PayrollLine, OutboxEvent) | Payroll processing — batch submit/validate/post with idempotency |
| **apar-service** | 3013 | Prisma (AREntry, APEntry) | Accounts Payable/Receivable — warranty claims, vendor invoices, OEM remittance |
| **recon-service** | 3014 | Prisma (BankRecon, BankTransaction) | Bank reconciliation — import, auto-match, manual match, dispute |
| **fs-service** | 3015 | In-memory | OEM Financial Statement — GM Standard format, Ford OWS format, preview/validate/submit |
| **coa-service** | 3016 | In-memory | Chart of Accounts — standard templates, OEM mapping, unmapped account detection |
| **cashflow-service** | 3037 | Prisma (CashFlowForecast, DailyCashActual) | Cash flow forecasting — reacts to JE posted, payroll posted, cash receipts |

### 3.2 AI Agent Services

| Service | Port | Agent Class | Event Trigger | Description |
|---|---|---|---|---|
| **agent-gl** | 3020 | GLIntegrityAgent | `JOURNAL_ENTRY_SUBMITTED` | 9 validation rules: duplicates, account types, balance check, anomalous amounts, service RO module integrity, parts margin, department consistency, deal product completeness, cross-module contamination |
| **agent-eom** | 3021 | EOMOrchestrationAgent | `EOM_STEP_CHANGED` | Step dependency enforcement, pre-step verification (tech attribution, parts quantities, department codes), failure diagnosis and recovery |
| **agent-payroll** | 3022 | PayrollIntegrityAgent | `PAYROLL_BATCH_SUBMITTED` | 8 checks: idempotency, amount variance, GL mapping, period overlap, earning codes, tech hours cross-check, department allocation, per-employee variance |
| **agent-apar** | 3023 | APARReconAgent | `OEM_REMITTANCE_IMPORTED`, `BANK_RECON_STARTED` | Warranty AR matching, short-payment detection, auto-JE generation, warranty labor rate verification, parts matching |
| **agent-t1** | 3024 | T1CopilotAgent | User chat (SSE) | 18-tool conversational copilot — GL queries, payroll, EOM, FS preview, approvals, tech productivity, parts profitability, department P&L, deal products |

### 3.3 Platform Services

| Service | Port | Database | Description |
|---|---|---|---|
| **auth-service** | 3001 | Prisma (ApiKey, RefreshToken) | JWT authentication (HS256, 8h expiry), API key management |
| **tenant-service** | 3002 | Prisma (Tenant) | Multi-tenant CRUD, DMS type, schema provisioning |
| **audit-service** | 3031 | Prisma (AuditLog — IMMUTABLE) | SOC 2/SOX compliant audit trail — DB trigger prevents UPDATE/DELETE, subscribes to ALL 40+ events |
| **approval-service** | 3033 | In-memory | Human-in-the-loop approval workflow for agent actions |
| **notification-service** | 3030 | In-memory | Webhook + console notifications on agent alerts, payroll holds, EOM blocks |
| **connector-service** | 3032 | In-memory | DMS adapter layer — AutoMate, CDK, Reynolds, Dealertrack. Ingests ROs, parts invoices, deals, payroll, vehicles |
| **onboarding-service** | 3035 | In-memory | Dealer onboarding — DMS config → OEM config → COA setup → import history → FS validation |
| **webhook-service** | 3036 | Prisma (WebhookRegistration, WebhookDelivery) | External webhook dispatch — all 40+ events, delivery tracking, retry |
| **document-service** | 3038 | Prisma (Document) | Document upload + AI extraction (vendor name, invoice #, amount, suggested GL coding) |
| **group-service** | 3039 | Prisma (DealerGroup, DealerGroupTenant) | Multi-rooftop dealer group consolidation |

### 3.4 Extended Services (Gap-Filling)

| Service | Port | Description |
|---|---|---|
| **user-service** | 3040 | User preferences and role management |
| **data-quality-service** | 3041 | Data quality scoring, issue detection |
| **esg-service** | 3042 | ESG reporting and metric tracking |
| **compliance-service** | 3043 | Compliance rule engine and alert management |
| **revenue-service** | 3044 | Revenue recognition contracts and schedules (ASC 606) |
| **query-service** | 3045 | Natural language → SQL query engine |
| **analytics-service** | 3046 | P&L analytics, technician productivity, parts margin |
| **ml-service** | 3047 | Anomaly detection, transaction match confidence scoring |
| **orchestrator-service** | 3048 | Multi-step task orchestration across services |

---

## 4. Data Architecture

### 4.1 Database: PostgreSQL (port 5433)

Single database `amacc` with row-level multi-tenancy (`tenantId` on every table).

#### 4.1.1 GL Domain (gl-service)

```
┌─────────────────────────────────────────────┐
│                 GLAccount                    │
├─────────────────────────────────────────────┤
│ id            UUID PK                        │
│ tenantId      STRING (tenant isolation)      │
│ code          STRING (NADA account code)     │
│ name          STRING                         │
│ type          ENUM: ASSET | LIABILITY |       │
│               EQUITY | REVENUE | EXPENSE |   │
│               COST_OF_SALES                  │
│ subType       STRING                         │
│ normalBalance ENUM: DEBIT | CREDIT           │
│ allowPosting  BOOLEAN                        │
│ scheduleCode  STRING? (schedule linkage)     │
│ glGroup       STRING? (grouping)             │
│ parentId      UUID? (hierarchy)              │
│ isActive      BOOLEAN                        │
│ UNIQUE: [tenantId, code]                     │
└──────────────────┬──────────────────────────┘
                   │ 1:N
                   ▼
┌────────────────────────────────────────────────────────┐
│                    JournalEntry                         │
├────────────────────────────────────────────────────────┤
│ id               UUID PK                                │
│ tenantId         STRING                                 │
│ entryDate        DATETIME                               │
│ description      STRING                                 │
│ source           STRING (AUTOMATE_DMS | CONNECTOR_CDK | │
│                  MANUAL | PAYROLL | EOM_AGENT | RECON)  │
│ sourceRef        STRING (RO#, INV#, JE-ref)             │
│ status           ENUM: DRAFT | POSTED | REVERSED | HELD │
│ agentReviewed    BOOLEAN                                │
│ postedBy         STRING?                                │
│ postedAt         DATETIME?                              │
│ createdByUserId  STRING?                                │
│ approvedByUserId STRING?                                │
│ priorPeriodAdj   BOOLEAN                                │
│ adjustmentReason STRING?                                │
└───────┬────────────────────────┬───────────────────────┘
        │ 1:N                    │ 1:N
        ▼                        ▼
┌───────────────────────────┐  ┌─────────────────────────┐
│       JournalLine         │  │    DealProductLine       │
├───────────────────────────┤  ├─────────────────────────┤
│ id            UUID PK     │  │ id            UUID PK   │
│ journalEntryId FK         │  │ journalEntryId FK       │
│ glAccountId   FK          │  │ dealNumber    STRING    │
│ debit         DECIMAL     │  │ productType   STRING    │
│ credit        DECIMAL     │  │ productName   STRING    │
│ memo          STRING?     │  │ salePrice     DECIMAL   │
│ departmentCode STRING?    │  │ dealerCost    DECIMAL   │
│ technicianId  STRING?     │  │ grossProfit   DECIMAL   │
│ roNumber      STRING?     │  │ providerName  STRING    │
│ roLineNumber  INT?        │  └─────────────────────────┘
│ flatRateHours DECIMAL?    │
│ clockHours    DECIMAL?    │
│ partNumber    STRING?     │
│ partQuantity  INT?        │
│ earningCode   STRING?     │
│ dealProductCode STRING?   │
│ dealNumber    STRING?     │
│ vehicleVin    STRING?     │
│ moduleSource  STRING?     │
│ laborType     STRING?     │
│ costType      STRING?     │
│ agentConfidence FLOAT?    │
└───────────────────────────┘
```

#### 4.1.2 EOM Domain (eom-service)
```
┌──────────────────────────────────┐
│            EOMClose              │
├──────────────────────────────────┤
│ id          UUID PK              │
│ tenantId    STRING               │
│ periodYear  INT                  │
│ periodMonth INT (1-13)           │
│ status      ENUM: NOT_STARTED |  │
│             IN_PROGRESS |        │
│             COMPLETED | BLOCKED  │
│ currentStep STRING               │
│ startedAt   DATETIME?            │
│ completedAt DATETIME?            │
│ blockedReason STRING?            │
│ UNIQUE: [tenantId, periodYear,   │
│          periodMonth]            │
└──────────┬───────────────────────┘
           │ 1:N
           ▼
┌──────────────────────────────────┐
│            EOMStep               │
├──────────────────────────────────┤
│ id          UUID PK              │
│ eomCloseId  FK                   │
│ stepCode    STRING               │
│ stepName    STRING               │
│ status      ENUM: PENDING |      │
│             RUNNING | DONE |     │
│             BLOCKED | SKIPPED    │
│ startedAt   DATETIME?            │
│ completedAt DATETIME?            │
│ errorMessage STRING?             │
│ retryCount  INT                  │
└──────────────────────────────────┘
```

#### 4.1.3 Payroll Domain (payroll-service)
```
┌────────────────────────────────────┐
│          PayrollBatch              │
├────────────────────────────────────┤
│ id              UUID PK            │
│ tenantId        STRING             │
│ batchRef        STRING             │
│ periodStart     DATE               │
│ periodEnd       DATE               │
│ totalAmount     DECIMAL            │
│ status          ENUM: PENDING |    │
│                 VALIDATED | POSTED |│
│                 REJECTED | HELD    │
│ idempotencyKey  STRING             │
│ heldReason      STRING?            │
│ UNIQUE: [tenantId, idempotencyKey] │
└──────────┬─────────────────────────┘
           │ 1:N
           ▼
┌────────────────────────────────────┐
│          PayrollLine               │
├────────────────────────────────────┤
│ id             UUID PK             │
│ payrollBatchId FK                  │
│ employeeId     STRING              │
│ employeeName   STRING              │
│ departmentCode STRING              │
│ earningCode    STRING              │
│ hours          DECIMAL             │
│ rate           DECIMAL             │
│ amount         DECIMAL             │
│ technicianId   STRING?             │
│ flatRateHours  DECIMAL?            │
│ roNumber       STRING?             │
└────────────────────────────────────┘
```

#### 4.1.4 Other Domain Models
```
                    ┌───────────────────────┐
                    │      AuditLog         │
                    │   (IMMUTABLE TABLE)   │
                    ├───────────────────────┤
                    │ id          UUID PK   │
                    │ tenantId    STRING    │
                    │ eventType   STRING    │
                    │ entityType  STRING    │
                    │ entityId    STRING    │
                    │ actorType   STRING    │
                    │ actorId     STRING    │
                    │ actorName   STRING    │
                    │ action      STRING    │
                    │ previousState JSON    │
                    │ newState     JSON     │
                    │ reason      STRING?   │
                    │ confidence  FLOAT?    │
         ┌──────►  │ DB TRIGGER: no UPDATE │
         │          │ DB TRIGGER: no DELETE │
         │          └───────────────────────┘
   ALL 40+
   EVENTS          ┌───────────────────────┐
                   │  WebhookRegistration   │
                   ├───────────────────────┤
                   │ id          UUID PK   │
                   │ tenantId    STRING    │
                   │ targetUrl   STRING    │
                   │ events      STRING[] │
                   │ secret      STRING    │
                   │ isActive    BOOLEAN   │
                   │ failureCount INT      │
                   └───────┬───────────────┘
                           │ 1:N
                           ▼
                   ┌───────────────────────┐
                   │  WebhookDelivery      │
                   ├───────────────────────┤
                   │ eventType   STRING    │
                   │ payload     JSON      │
                   │ responseStatus INT    │
                   │ attemptCount INT      │
                   └───────────────────────┘

┌─────────────────┐  ┌──────────────────┐  ┌─────────────────────┐
│    BankRecon     │  │  CashFlowForecast│  │     Document        │
├─────────────────┤  ├──────────────────┤  ├─────────────────────┤
│ accountName     │  │ forecastDate     │  │ fileName            │
│ glBalance       │  │ predictedBalance │  │ mimeType            │
│ bankBalance     │  │ confidence       │  │ extractedData JSON  │
│ variance        │  │ breakdown JSON   │  │ suggestedCoding JSON│
│ status          │  └──────────────────┘  │ vendorName          │
│ lockedBy        │                        │ invoiceNumber       │
│ transactions[]  │                        │ totalAmount         │
└──────┬──────────┘                        │ journalEntryId?     │
       │ 1:N                               └─────────────────────┘
       ▼
┌──────────────────┐
│ BankTransaction  │
├──────────────────┤
│ description      │
│ amount           │
│ matchedJournalId │
│ status: UNMATCHED│
│   | MATCHED      │
│   | DISPUTED     │
└──────────────────┘
```

---

## 5. Event-Driven Architecture

### 5.1 Message Broker: RabbitMQ

All inter-service communication flows through RabbitMQ using the **Transactional Outbox Pattern** — events are first written to an `OutboxEvent` table in the same DB transaction as the business data, then a background poller publishes them to RabbitMQ (5-second polling interval).

### 5.2 Complete Event Catalog (40+ Events)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        EVENT FLOW DIAGRAM                                    │
│                                                                              │
│  ┌──────────────┐    JOURNAL_ENTRY_SUBMITTED     ┌──────────────────┐       │
│  │  gl-service  │──────────────────────────────▶  │  agent-gl        │       │
│  │              │    JOURNAL_ENTRY_POSTED         │  (9 validation   │       │
│  │              │──────────────────────┬────────▶  │   rules)         │       │
│  └──────────────┘                     │          └────────┬─────────┘       │
│                                       │                   │                  │
│                                       │          AGENT_HUMAN_REQUIRED        │
│                                       │                   │                  │
│                                       ▼                   ▼                  │
│                              ┌──────────────┐    ┌──────────────────┐       │
│                              │ audit-service │    │approval-service  │       │
│                              │ (immutable   │    │(human-in-loop)   │       │
│                              │  audit trail)│    └──────────────────┘       │
│                              └──────────────┘                               │
│                                                                              │
│  ┌──────────────┐    EOM_STEP_CHANGED            ┌──────────────────┐       │
│  │ eom-service  │──────────────────────────────▶  │  agent-eom       │       │
│  │              │    EOM_CLOSE_BLOCKED            │  (step deps,     │       │
│  │              │──────────────────────┬────────▶  │   recovery)      │       │
│  └──────────────┘                     │          └──────────────────┘       │
│                                       ▼                                      │
│                              ┌──────────────────┐                           │
│                              │notification-svc  │                           │
│                              │(webhook/console) │                           │
│                              └──────────────────┘                           │
│                                                                              │
│  ┌──────────────┐    PAYROLL_BATCH_SUBMITTED     ┌──────────────────┐       │
│  │payroll-svc   │──────────────────────────────▶  │  agent-payroll   │       │
│  │              │    PAYROLL_BATCH_POSTED         │  (8 integrity    │       │
│  │              │──────────────────────────────▶  │   checks)        │       │
│  └──────────────┘                                └──────────────────┘       │
│                                                                              │
│  ┌──────────────┐    OEM_REMITTANCE_IMPORTED     ┌──────────────────┐       │
│  │ apar-service │──────────────────────────────▶  │  agent-apar      │       │
│  │              │    BANK_RECON_STARTED           │  (warranty match, │       │
│  │              │──────────────────────────────▶  │   auto-JE)       │       │
│  └──────────────┘                                └──────────────────┘       │
│                                                                              │
│  ┌──────────────┐    SERVICE_RO_CLOSED           ┌──────────────────┐       │
│  │connector-svc │──────────────────────────────▶  │  gl-service      │       │
│  │(DMS adapter) │    DEAL_PRODUCT_DETAIL         │  agent-gl         │       │
│  │              │──────────────────────────────▶  │  audit-service    │       │
│  └──────────────┘                                └──────────────────┘       │
│                                                                              │
│  Global subscribers: audit-service (ALL events), webhook-service (ALL)      │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 5.3 Event Categories

| Category | Events | Publishers | Subscribers |
|---|---|---|---|
| **GL** | `JOURNAL_ENTRY_SUBMITTED`, `JOURNAL_ENTRY_POSTED`, `JOURNAL_ENTRY_HELD`, `GL_ANOMALY_DETECTED` | gl-service | agent-gl, audit-service, fs-service, cashflow-service |
| **EOM** | `EOM_CLOSE_INITIATED`, `EOM_STEP_CHANGED`, `EOM_CLOSE_BLOCKED`, `EOM_CLOSE_COMPLETED`, `TRIAL_BALANCE_READY` | eom-service | agent-eom, notification-service, audit-service |
| **Financial Statement** | `FS_PREVIEW_READY`, `FS_LINE_ANOMALY_DETECTED`, `FS_SUBMITTED`, `FS_ACCEPTED_BY_OEM`, `FS_REJECTED_BY_OEM`, `COA_MAPPING_GAP_DETECTED`, `COA_VERSION_UPDATED` | fs-service, coa-service | agent-gl, audit-service |
| **Payroll** | `PAYROLL_BATCH_SUBMITTED`, `PAYROLL_BATCH_HELD`, `PAYROLL_BATCH_POSTED` | payroll-service | agent-payroll, notification-service, audit-service, cashflow-service |
| **AP/AR** | `OEM_REMITTANCE_IMPORTED`, `BANK_RECON_STARTED`, `BANK_RECON_COMPLETED` | apar-service, recon-service | agent-apar, audit-service |
| **Agent** | `AGENT_HUMAN_REQUIRED`, `AGENT_ACTION_TAKEN`, `AGENT_ACTION_APPROVED`, `AGENT_ACTION_REJECTED` | all agents | approval-service, notification-service, audit-service |
| **Approval** | `APPROVAL_REQUESTED`, `APPROVAL_GRANTED`, `APPROVAL_REJECTED`, `APPROVAL_EXPIRED` | approval-service | notification-service, audit-service |
| **Onboarding** | `TENANT_PROVISIONED`, `TENANT_UPDATED`, `DMS_SYNC_COMPLETED`, `LEGACY_GL_MAPPED`, `ONBOARDING_COMPLETED` | tenant-service, onboarding-service | audit-service |
| **Connector (Line-Level)** | `SERVICE_RO_CLOSED`, `PARTS_INVOICE_CLOSED`, `DEAL_PRODUCT_DETAIL_RECEIVED`, `VEHICLE_PURCHASED`, `VEHICLE_TRANSFERRED`, `PAYROLL_LINES_SUBMITTED`, `FINANCE_CHARGE_POSTED`, `CREDIT_CARD_BATCH_SETTLED`, `CASH_RECEIPT_DETAILED`, `YEAR_END_CLOSE_POSTED`, `AMDB_DROPMATE_IMPORTED` | connector-service | gl-service, agent-gl, audit-service |
| **Cross-Service** | `TECH_HOURS_RECONCILED`, `DEPARTMENT_PL_READY` | analytics-service | agent-eom, agent-t1, fs-service |

---

## 6. AI Agent Architecture

### 6.1 Agent Framework (BaseAgent)

All agents extend `BaseAgent` from `@amacc/shared-kernel`:

```
┌──────────────────────────────────────────────────────────────────┐
│                       BaseAgent (Abstract)                       │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  abstract getAgentName(): string                                 │
│  abstract getSystemPrompt(): string                              │
│  abstract buildTools(): ToolDefinition[]                         │
│  abstract buildToolExecutor(): (name, args) => Promise<result>   │
│  abstract buildUserMessage(event): string                        │
│                                                                  │
│  execute(event):                                                 │
│    1. Build system prompt + user message from event              │
│    2. Call Claude with tools (runWithTools / streamWithTools)     │
│    3. Claude decides which tools to call                         │
│    4. Execute tool calls against real service APIs               │
│    5. If human review needed → emit AGENT_HUMAN_REQUIRED         │
│    6. Log to audit → emit AGENT_ACTION_TAKEN                    │
│                                                                  │
│  Dependencies:                                                   │
│    - IClaudeClient (Anthropic API)                               │
│    - IEventPublisher (RabbitMQ)                                  │
│    - IAuditLogger                                                │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 6.2 Agent Tool Inventory

#### GL Integrity Agent (agent-gl) — 8 Tools
```
┌────────────────────────────────────────────────────────────────────┐
│                  GL Integrity Agent Tools                          │
├─────────────────────────┬──────────────────────────────────────────┤
│ get_journal_entries     │ Query JEs by dateFrom, status            │
│ get_gl_accounts         │ Get chart of accounts                    │
│ get_trial_balance       │ Period trial balance (year, month)       │
│ post_journal_entry      │ Post a draft JE to the ledger           │
│ get_journal_lines_by_tech│ Lines for a technician (flatRate/clock) │
│ get_journal_lines_by_part│ Lines for a part number (margin check)  │
│ get_journal_lines_by_module│ Lines grouped by moduleSource         │
│ flag_for_human_review   │ Flag with severity: INFO/WARN/CRITICAL  │
└─────────────────────────┴──────────────────────────────────────────┘

Validation Rules (checked on every JOURNAL_ENTRY_SUBMITTED):
  1. DuplicateEntryRule     — same sourceRef within 5 min
  2. AccountTypeMismatchRule — debit/credit on wrong account type
  3. UnbalancedEntryRule     — total debits ≠ total credits
  4. AnomalousAmountRule     — >3x 30-day average
  5. WarrantyLaborMisclassificationRule — labor on wrong account
  6. InternalVsCustomerLaborRule — labor type check
  7. NegativeInventoryRule   — inventory going below zero
  8. FSLineMappingGapRule    — unmapped FS lines
  9. Module Source Integrity — cross-module contamination check
```

#### T1 Copilot Agent (agent-t1) — 18 Tools
```
┌──────────────────────────────────────────────────────────────────────┐
│                    T1 Copilot Agent — 18 Tools                      │
├─────────────────────────────┬────────────────────────────────────────┤
│ READ TOOLS                  │ WRITE TOOLS                            │
│ ─────────────               │ ───────────                            │
│ get_gl_accounts             │ post_journal_entry                     │
│ get_journal_entries         │ hold_payroll_batch                     │
│ get_trial_balance           │ create_journal_entry                   │
│ get_payroll_batch           │ request_approval                       │
│ get_eom_steps               │ flag_for_human_review                  │
│ get_fs_preview              │                                        │
│ get_pending_approvals       │ ANALYTICS TOOLS                        │
│ get_eom_readiness           │ ───────────────                        │
│                             │ get_tech_productivity                  │
│                             │ get_parts_profitability                │
│                             │ get_payroll_by_earning_code            │
│                             │ get_department_pl                      │
│                             │ get_deal_product_profitability         │
└─────────────────────────────┴────────────────────────────────────────┘
```

---

## 7. DMS Connector Architecture

### 7.1 Adapter Pattern

```
                    ┌──────────────────────┐
                    │   connector-service   │
                    │   POST /ingest        │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │   DMS Adapter Layer   │
                    │   (Open/Closed)       │
                    ├──────────────────────┤
                    │ ┌──────────────────┐ │
                    │ │ AutoMateAdapter  │ │ ← AutoMate DMS 4.x
                    │ └──────────────────┘ │
                    │ ┌──────────────────┐ │
                    │ │ CDKAdapter       │ │ ← CDK Drive 3.x
                    │ └──────────────────┘ │
                    │ ┌──────────────────┐ │
                    │ │ ReynoldsAdapter  │ │ ← Reynolds & ERA
                    │ └──────────────────┘ │
                    │ ┌──────────────────┐ │
                    │ │DealertrackAdapter│ │ ← Dealertrack
                    │ └──────────────────┘ │
                    └──────────┬───────────┘
                               │ Normalize
                               ▼
                    ┌──────────────────────┐
                    │  Normalized Payload   │
                    │  + GL Account Mapping │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │   gl-service          │
                    │   POST /journal-entry │
                    │   (with CircuitBreaker)│
                    └──────────────────────┘
```

### 7.2 Ingest Types

| Ingest Type | Key Fields | Generated Events |
|---|---|---|
| **Service RO Close** | laborLines[], partsLines[], subletLines[], technicianId, roNumber, flatRateHours, clockHours | `SERVICE_RO_CLOSED` |
| **Parts Invoice Close** | lineItems[], partNumber, quantity, cost, retail | `PARTS_INVOICE_CLOSED` |
| **Deal (Vehicle Sale)** | dealNumber, vehicleVin, salePrice, tradein, finance, F&I products[] | `DEAL_PRODUCT_DETAIL_RECEIVED` |
| **Payroll Batch** | employees[], earningCode, hours, rate, departmentCode | `PAYROLL_LINES_SUBMITTED` |
| **Vehicle Purchase** | stock#, vin, cost, floorPlanLender | `VEHICLE_PURCHASED` |
| **Vehicle Transfer** | fromRooftop, toRooftop, vin, bookValue | `VEHICLE_TRANSFERRED` |
| **Cash Receipt** | receiptType, amount, glAccount, depositSlip | `CASH_RECEIPT_DETAILED` |

---

## 8. EOM Close Process (13 Steps)

```
┌───────┐    ┌───────┐    ┌───────┐    ┌───────┐    ┌───────┐
│  010  │───▶│  020  │───▶│  030  │───▶│  062  │───▶│  065  │
│Pre-   │    │Verify │    │Post   │    │Parts  │    │Parts  │
│Close  │    │Open   │    │Pending│    │Close  │    │Recon  │
│Check  │    │Items  │    │JEs    │    │       │    │       │
└───────┘    └───────┘    └───────┘    └───────┘    └───────┘
                                                         │
┌───────┐    ┌───────┐    ┌───────┐    ┌───────┐         │
│  13TH │◀───│  300  │◀───│  200  │◀───│  100  │         │
│13th   │    │FS     │    │FS     │    │GL     │         │
│Month  │    │Submit │    │Gener- │    │Valid- │         │
│Snap   │    │       │    │ation  │    │ation  │         │
└───────┘    └───────┘    └───────┘    └───────┘         │
                                            ▲             │
┌───────┐    ┌───────┐    ┌───────┐    ┌───────┐         │
│  077  │───▶│  GL   │    │  074  │◀───│  071  │◀───│  068  │
│Master │    │Valid  │    │Fixed  │    │Var    │    │Service│
│Close  │    │       │    │Ops    │    │Ops    │    │Close  │
└───────┘    └───────┘    └───────┘    └───────┘    └───────┘

Step Dependency Graph (enforced by agent-eom):
  Parts Close (062) → Parts Recon (065) → Service Close (068) →
  Variable Ops (071) → Fixed Ops (074) → Master Close (077)

Pre-Step Agent Checks:
  Before 062: Verify partQuantity > 0 on all parts lines
  Before 068: Verify every closed RO has tech attribution
  Before 077: Verify departmentCode on ≥90% of JournalLines
```

---

## 9. Frontend Architecture

### 9.1 Component Hierarchy

```
┌────────────────────────────────────────────────────────────────────┐
│                         App.tsx                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │                    ErrorBoundary                              │ │
│  │  ┌──────────┐  ┌────────────────────────────────────────┐   │ │
│  │  │ Sidebar  │  │          <Routes>                       │   │ │
│  │  │          │  │  ┌────────────────────────────────────┐│   │ │
│  │  │ CORE     │  │  │  38 Page Components                ││   │ │
│  │  │ ────     │  │  │  Each with:                        ││   │ │
│  │  │ Dashboard│  │  │   - useQuery (React Query)         ││   │ │
│  │  │ Command  │  │  │   - PageLoader / PageError         ││   │ │
│  │  │ Center   │  │  │   - HelpButton (screen help)      ││   │ │
│  │  │ GL       │  │  │   - AIInsight (agent summary)     ││   │ │
│  │  │ Trial Bal│  │  │   - DataTable (sortable grids)    ││   │ │
│  │  │ FS       │  │  │   - StatusBadge (color-coded)     ││   │ │
│  │  │ ...      │  │  └────────────────────────────────────┘│   │ │
│  │  │          │  └────────────────────────────────────────┘   │ │
│  │  │ OPS      │                                                │ │
│  │  │ ────     │  ┌────────────────────────────────────────┐   │ │
│  │  │ AP       │  │          T1Sidebar                      │   │ │
│  │  │ Payroll  │  │  Floating copilot chat panel            │   │ │
│  │  │ Recon    │  │  POST /api/v1/agents/t1/chat (SSE)     │   │ │
│  │  │ ...      │  │  POST /api/v1/command-center/ashley     │   │ │
│  │  │          │  └────────────────────────────────────────┘   │ │
│  │  │ ADVANCED │                                                │ │
│  │  │ ────     │  ┌────────────────────────────────────────┐   │ │
│  │  │ EOM      │  │    SidebarServiceStatus                 │   │ │
│  │  │ Year-End │  │    Live health checks (every 30s):      │   │ │
│  │  │ Approvals│  │    GL :3010 | Payroll :3012 |          │   │ │
│  │  │ ...      │  │    EOM :3011 | Auth :3001              │   │ │
│  │  │          │  └────────────────────────────────────────┘   │ │
│  │  │ ADMIN    │                                                │ │
│  │  │ ────     │                                                │ │
│  │  │ Settings │                                                │ │
│  │  │ Onboard  │                                                │ │
│  │  │ Agents   │                                                │ │
│  │  └──────────┘                                                │ │
│  └──────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
```

### 9.2 API Client Layer (46 API Groups)

The frontend communicates through a unified `apiFetch<T>()` function that:
- Injects `x-tenant-id` header from localStorage
- Applies 10-second timeout with AbortController
- Throws structured errors on non-2xx responses
- Groups calls into 46 domain-specific API objects

### 9.3 Page Inventory (38 Pages)

| Section | Pages |
|---|---|
| **Core (10)** | Dashboard, AccountingCommandCenter, GeneralLedger, Transactions, TrialBalance, ManualJournalEntry, ChartOfAccounts, FinancialStatements, FSPreview, Reports |
| **Operations (7)** | AccountsPayable, CashReceipts, BankDeposits, PurchaseOrders, VendorManagement, Payroll, Reconciliation |
| **Advanced (7)** | Intercompany, WarrantyDCS, JournalSources, EOMClose, YearEnd, Approvals, GroupDashboard |
| **Admin (8)** | SystemSettings, Setup, Utilities, Agents, Tenants, Onboarding, Analytics, QueryExplorer |
| **Other (6)** | AMACCSync, Settings, MobileApprovals, Schedules, StandardJournalEntries, VehicleInventory |

---

## 10. Security Architecture

### 10.1 Authentication Flow
```
┌──────────┐     ┌──────────────┐     ┌───────────┐
│  Client   │────▶│  Auth Service │────▶│ PostgreSQL│
│  (React)  │     │  :3001       │     │ (ApiKey,  │
│           │◀────│              │     │  Refresh) │
│  Bearer   │     │ JWT HS256    │     └───────────┘
│  token    │     │ 8h expiry    │
└──────────┘     └──────────────┘

API Key → POST /auth/token → JWT (8h)
JWT includes: tenantId, userId, roles[], scopes[]
Admin ops require: x-admin-api-key header
```

### 10.2 Multi-Tenant Isolation
- Every request carries `x-tenant-id` header (injected by nginx if missing → defaults to `tenant-kunes`)
- Every database table has `tenantId` column
- All queries filtered by `tenantId` at the Prisma/repository layer
- Tenant provisioning creates isolated schema config

### 10.3 Audit Compliance (SOC 2 / SOX)
- `AuditLog` table has **database-level triggers** preventing UPDATE and DELETE
- Every event in the system is logged with: actor, entity, previous/new state, timestamp, IP, session
- All 40+ event types flow through audit-service

---

## 11. OEM Financial Statement Architecture

```
┌────────────────────────────────────────────────────────────┐
│                    FS Generation Pipeline                    │
│                                                              │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │ GL Trial │───▶│ COA → OEM    │───▶│  OEM Formatter   │  │
│  │ Balance  │    │ Mapping      │    │                  │  │
│  │ (period) │    │ (coa-service)│    │ ┌──────────────┐ │  │
│  └──────────┘    └──────────────┘    │ │GMFSFormatter │ │  │
│                                       │ └──────────────┘ │  │
│                                       │ ┌──────────────┐ │  │
│                                       │ │FordFSFormatter│ │  │
│                                       │ └──────────────┘ │  │
│                                       └────────┬─────────┘  │
│                                                │             │
│                                       ┌────────▼─────────┐  │
│                                       │  Validation      │  │
│                                       │  (line mapping,  │  │
│                                       │   balance check)  │  │
│                                       └────────┬─────────┘  │
│                                                │             │
│                                       ┌────────▼─────────┐  │
│                                       │  FS Preview      │  │
│                                       │  sections[],     │  │
│                                       │  lines[],        │  │
│                                       │  validationErrors│  │
│                                       └────────┬─────────┘  │
│                                                │ Submit      │
│                                       ┌────────▼─────────┐  │
│                                       │  OEM Portal      │  │
│                                       │  (GM/Ford/etc)   │  │
│                                       └──────────────────┘  │
└────────────────────────────────────────────────────────────┘

FS Sections (GM Format):
  - New Vehicle Department (lines 1-9)
  - Used Vehicle Department (lines 10-19)
  - Service Department (lines 20-29)
  - Parts Department (lines 30-39)
  Each line: lineNumber, description, currentMonth, ytd
```

---

## 12. Deployment Architecture

### 12.1 Docker Compose Topology

```
┌─────────────────────────────────────────────────────────────────┐
│                    Docker Compose Network                         │
│                                                                   │
│  INFRASTRUCTURE                                                   │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐                │
│  │ PostgreSQL │  │  RabbitMQ  │  │   Redis    │                │
│  │   :5433    │  │ :5672/15672│  │   :6380    │                │
│  │  pgdata vol│  │            │  │            │                │
│  └────────────┘  └────────────┘  └────────────┘                │
│                                                                   │
│  CORE SERVICES (8)           AGENTS (5)                          │
│  ┌──────┐ ┌──────┐          ┌──────┐ ┌──────┐                  │
│  │GL    │ │EOM   │          │Agt-GL│ │Agt-  │                  │
│  │:3010 │ │:3011 │          │:3020 │ │EOM   │                  │
│  ├──────┤ ├──────┤          ├──────┤ │:3021 │                  │
│  │Pay   │ │APAR  │          │Agt-  │ ├──────┤                  │
│  │:3012 │ │:3013 │          │Pay   │ │Agt-  │                  │
│  ├──────┤ ├──────┤          │:3022 │ │APAR  │                  │
│  │Recon │ │FS    │          ├──────┤ │:3023 │                  │
│  │:3014 │ │:3015 │          │Agt-  │ └──────┘                  │
│  ├──────┤ ├──────┤          │T1    │                            │
│  │COA   │ │Cash  │          │:3024 │                            │
│  │:3016 │ │:3037 │          │(SSE) │                            │
│  └──────┘ └──────┘          └──────┘                            │
│                                                                   │
│  PLATFORM SERVICES (10)      EXTENDED (9)                        │
│  ┌──────┐ ┌──────┐          ┌──────┐ ╌╌╌╌╌╌╌                  │
│  │Auth  │ │Tenant│          │User  │ :3040-                    │
│  │:3001 │ │:3002 │          │:3040 │ :3048                     │
│  ├──────┤ ├──────┤          └──────┘                            │
│  │Audit │ │Apprvl│          (analytics,                         │
│  │:3031 │ │:3033 │           ml, query,                         │
│  ├──────┤ ├──────┤           compliance,                        │
│  │Notify│ │Connct│           esg, revenue,                      │
│  │:3030 │ │:3032 │           orchestrator,                      │
│  ├──────┤ ├──────┤           data-quality)                      │
│  │Onbrd │ │Webhk │                                              │
│  │:3035 │ │:3036 │                                              │
│  ├──────┤ ├──────┤          GATEWAY + FRONTEND                  │
│  │Doc   │ │Group │          ┌──────┐ ┌──────┐                  │
│  │:3038 │ │:3039 │          │NGINX │ │Vite  │                  │
│  └──────┘ └──────┘          │:8081 │ │:5174 │                  │
│                             └──────┘ └──────┘                  │
└─────────────────────────────────────────────────────────────────┘

Total: 35 containers
  - 3 infrastructure (postgres, rabbitmq, redis)
  - 8 core accounting services
  - 5 AI agent services
  - 10 platform services
  - 9 extended services
  - 1 API gateway (nginx)
  - 1 frontend (Vite/React)
```

### 12.2 Port Allocation Scheme

| Range | Category |
|---|---|
| 3001-3002 | Platform (auth, tenant) |
| 3010-3016 | Core accounting |
| 3020-3024 | AI agents |
| 3030-3039 | Platform services |
| 3040-3048 | Extended services |
| 5174 | Frontend dev server |
| 5433 | PostgreSQL |
| 5672/15672 | RabbitMQ |
| 6380 | Redis |
| 8002 | Mock API (dev) |
| 8081 | NGINX gateway |

---

## 13. NADA Chart of Accounts Structure

```
0000–0999  PAYROLL ACCOUNTS
  0110  Salaries – Sales
  0120  Salaries – Service
  0130  Salaries – Parts

1000–1999  ASSETS
  1000  Cash – Operating
  1005  Cash – Payroll
  1010  Petty Cash
  1100  AR – Trade
  1150  AR – Factory
  1200  AR – Finance Reserve
  1300  New Vehicle Inventory
  1310  Used Vehicle Inventory
  1320  Demo Vehicles
  1400  Parts Inventory
  1500  Prepaid Expenses
  1520  Land
  1530  Buildings (net)
  1540  Equipment (net)

2000–2999  LIABILITIES
  2000  AP – Trade
  2100  Floor Plan – New
  2110  Floor Plan – Used
  2200  Accrued Payroll
  2210  Payroll Taxes Payable
  2250  Sales Tax Payable
  2300  Customer Deposits
  2470  Service WIP
  2500  Long-Term Debt

3000–3999  EQUITY
  3000  Owner Equity
  3100  Retained Earnings

4000–4999  REVENUE
  4000  New Vehicle Sales
  4010  Used Vehicle Sales
  4100  Service – Customer Labor
  4110  Service – Sublet Revenue
  4200  Parts – Counter Sales
  4210  Parts – Internal Sales
  4300  Body Shop Revenue
  4400  F&I Income
  4500  Warranty Labor Revenue
  4600  Factory Incentive Credit

5000–5999  COST OF SALES
  5000  Cost of New Vehicles
  5010  Cost of Used Vehicles
  5200  Parts Cost of Sales
  5300  Body Shop Cost

6000–6999  EXPENSES
  6000  Management Salaries
  6010  Sales Commissions
  6020  Service Wages
  6100  Payroll Taxes & Benefits
  6200  Advertising & Promotion
  6300  Rent / Lease
  6400  Utilities
  6500  Insurance
  6600  Depreciation
  6700  Floor Plan Interest
  6800  DMS / IT Expense
  6900  Miscellaneous
```

---

## 14. Demo Scenarios (Seeded Data)

### 14.1 Kunes Auto Group (Primary Demo Tenant)
- **Tenant**: `tenant-kunes` | CDK Drive | 5 rooftops
- **12+ journal entries**: Vehicle sales, service ROs, body shop, F&I deals, payroll, floor plan
- **55+ GL accounts**: Full NADA automotive chart of accounts
- **EOM close**: March 2026 in progress, blocked at Service RO Reconciliation (step 068)
- **3 pending approvals**: JE override, EOM bypass, payroll bonus
- **Active RO mismatch alert**: RO2400001 $332.88 vs original $3.00 mispost (auto-reversed by agent)

### 14.2 Lee Hyundai (Demo Scenarios)
- **Scenario A**: Payroll double-post protection (3-layer: app dedup, DB unique constraint, agent CRITICAL flag)
- **Scenario B**: GL duplicate detection (same sourceRef, agent catches via `get_journal_entries`)
- **Scenario C**: EOM failure/recovery (blocked at step 068, agent diagnoses and guides recovery)

---

## 15. Key Integration Patterns

### 15.1 Transactional Outbox
```
Business Service                    Outbox Poller
┌──────────────┐                   ┌──────────────┐
│ 1. Begin TX  │                   │ Poll every 5s│
│ 2. Write biz │                   │ Read unpubld │
│    data      │                   │ outbox events│
│ 3. Write to  │                   │ Publish to   │
│    OutboxEvent│                  │ RabbitMQ     │
│ 4. Commit TX │                   │ Mark as      │
│              │                   │ published    │
└──────────────┘                   └──────────────┘
```

### 15.2 Circuit Breaker (connector → gl-service)
The connector-service wraps GL service HTTP calls in a circuit breaker to handle gl-service downtime gracefully.

### 15.3 Idempotency Keys
Payroll batches use `[tenantId, idempotencyKey]` unique constraint to prevent double-posting at the database level.

### 15.4 Event Routing Map
Each event type has a statically-defined list of consumer services in `shared-kernel/events`, ensuring deterministic routing.

---

## 16. Kubernetes Deployment

### 16.1 K8s Manifest Structure

```
k8s/
├── 00-namespace.yaml          # amacc namespace
├── 01-config.yaml             # ConfigMap (DB/MQ/Redis URLs) + Secrets (JWT, API keys)
├── 02-infrastructure.yaml     # PostgreSQL StatefulSet + Redis + RabbitMQ
├── 03-core-services.yaml      # 8 core accounting Deployments + Services
├── 04-agent-services.yaml     # 5 AI agent Deployments + Services
├── 05-platform-services.yaml  # 10 platform Deployments + Services
├── 06-extended-services.yaml  # 9 extended Deployments + Services
├── 07-gateway-frontend.yaml   # NGINX gateway + React SPA + Ingress
├── kustomization.yaml         # Kustomize orchestrator
└── deploy.ps1                 # One-command build + deploy script
```

### 16.2 Deployment Targets (Free)

| Target | Setup | RAM Needed | Command |
|---|---|---|---|
| **Docker Desktop K8s** | Settings → Kubernetes → Enable | 8-16 GB | `.\deploy.ps1` |
| **minikube** | `minikube start --memory=8192 --cpus=4` | 8 GB | `.\deploy.ps1` |
| **k3s on Oracle Cloud** | Free VM (4 OCPU ARM, 24GB) + `curl -sfL https://get.k3s.io \| sh -` | 24 GB | `.\deploy.ps1 -SkipBuild` |

### 16.3 K8s Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Kubernetes Cluster                                │
│  Namespace: amacc                                                   │
│                                                                     │
│  ┌──────────────────────────────────────────┐                      │
│  │              Ingress Controller           │                      │
│  │  /api/* → api-gateway (NGINX ClusterIP)  │                      │
│  │  /*     → web (React SPA ClusterIP)      │                      │
│  └──────────────────────────────────────────┘                      │
│                                                                     │
│  ┌────────────────────────────────────────────────────┐            │
│  │  ConfigMap: amacc-config     Secret: amacc-secrets │            │
│  │  DATABASE_URL, RABBITMQ_URL  JWT_SECRET            │            │
│  │  REDIS_URL, NODE_ENV         ADMIN_API_KEY         │            │
│  │                              ANTHROPIC_API_KEY     │            │
│  └────────────────────────────────────────────────────┘            │
│                                                                     │
│  INFRASTRUCTURE (StatefulSet + Deployments)                        │
│  ┌────────────────┐ ┌──────────────┐ ┌──────────────┐             │
│  │ PostgreSQL     │ │   RabbitMQ   │ │    Redis     │             │
│  │ StatefulSet    │ │  Deployment  │ │  Deployment  │             │
│  │ + PVC (5Gi)   │ │              │ │              │             │
│  │ readiness:    │ │ readiness:   │ │ readiness:   │             │
│  │  pg_isready   │ │  check_run   │ │  redis ping  │             │
│  └────────────────┘ └──────────────┘ └──────────────┘             │
│                                                                     │
│  35 SERVICE DEPLOYMENTS (each: Deployment + ClusterIP Service)     │
│  ┌──────────────────────────────────────────────────────────┐     │
│  │ initContainer: wait-postgres / wait-rabbitmq             │     │
│  │ envFrom: amacc-config (ConfigMap) + amacc-secrets        │     │
│  │ readinessProbe: GET /health                              │     │
│  │ livenessProbe: GET /health                               │     │
│  │ resources: 64-256Mi request / 256Mi-1Gi limit            │     │
│  └──────────────────────────────────────────────────────────┘     │
│                                                                     │
│  Resource Budget (all 35 svc @ 1 replica):                         │
│    Requests: ~4 GB RAM, ~4 CPU cores                               │
│    Limits:   ~14 GB RAM, ~16 CPU cores                             │
│    Fits on: 16GB laptop or 24GB OCI free VM                       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 16.4 Key K8s Patterns Used
- **InitContainers** — `busybox nc -z` waits for postgres/rabbitmq before service starts
- **ConfigMap + Secret** — Shared env injected via `envFrom` (no env duplication)
- **Kustomize** — `kubectl apply -k k8s/` deploys everything in dependency order
- **ClusterIP Services** — Internal DNS resolution (same names as docker-compose)
- **Ingress** — Single entry point, routes `/api` to NGINX gateway, `/` to React SPA
- **PVC** — PostgreSQL data survives pod restarts
- **Resource Limits** — Prevents any single service from starving the cluster

### 16.5 Commands Cheatsheet

```bash
# Deploy
.\k8s\deploy.ps1                         # Build images + deploy all
.\k8s\deploy.ps1 -SkipBuild              # Deploy only (images exist)

# Monitor
kubectl get pods -n amacc                 # Pod status
kubectl get pods -n amacc -w             # Watch live
kubectl logs -n amacc deploy/gl-service  # Service logs
kubectl top pods -n amacc                # Resource usage

# Access
kubectl port-forward svc/web 5174:5174 -n amacc
kubectl port-forward svc/api-gateway 8081:80 -n amacc
# Then open http://localhost:5174

# Scale
kubectl scale deploy/agent-t1 --replicas=3 -n amacc

# Teardown
.\k8s\deploy.ps1 -Teardown               # Delete namespace + all resources
```

---

*This document describes the AMACC platform as of April 2, 2026. The system runs 35 Docker containers, 40+ event types, 5 AI agents with 50+ tools, 38 frontend pages, and serves multi-tenant automotive dealership accounting with SOC 2/SOX audit compliance. Kubernetes manifests are ready for local (Docker Desktop / minikube) or cloud (k3s on Oracle Cloud free tier) deployment.*
