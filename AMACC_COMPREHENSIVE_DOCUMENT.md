# AMACC — Automotive Accounting Cloud Platform
## Comprehensive Technical & Business Document
**Version:** 1.0 | **Date:** March 27, 2026 | **Author:** Shivashankar Angadi, Solera/DealerSocket

---

# SECTION 1 — EXECUTIVE SUMMARY

## What Is AMACC

AMACC (Automotive Accounting Cloud) is an enterprise-grade, AI-powered cloud accounting platform purpose-built for auto dealerships. It replaces the legacy COBOL-based AutoMate accounting module — a 30-year-old monolith that processes $4.2M+ in monthly revenue per rooftop — with a modern microservices architecture backed by five autonomous AI agents (powered by Claude/Anthropic) that automate journal entry validation, month-end close orchestration, payroll integrity checks, AP/AR reconciliation, and conversational accounting copilot capabilities, all with human-in-the-loop escalation for high-risk decisions.

## Who Uses It

| Role | Primary Screens | What They Do |
|------|----------------|-------------|
| **CFO / Dealer Principal** | Dashboard, Financial Statements, Analytics | Monitor P&L, review consolidated financials, approve large journal entries |
| **Controller** | Command Center, EOM Close, Trial Balance, Approvals | Manage month-end close, resolve agent escalations, approve overrides |
| **Accounting Manager** | General Ledger, Payroll, Reconciliation, AP/AR | Daily transaction posting, payroll batch processing, bank reconciliation |
| **Service Manager** | Warranty & DCS, EOM Close | Track warranty claims, review service department close steps |
| **Agent Approver** | Agents, Approvals | Review AI agent escalations, approve/reject agent-proposed actions |

## The Problem It Solves

The legacy COBOL accounting module has 7 confirmed failure modes:
1. **No concurrent user protection** — two users can corrupt the same EOM close simultaneously
2. **No duplicate entry detection** — the same journal entry can be posted twice
3. **No automatic anomaly detection** — a $500K entry posts without any warning
4. **Manual 13-step month-end close** — takes 3–5 days, error-prone, no dependency tracking
5. **No multi-tenant isolation** — data boundaries enforced by application code, not architecture
6. **No versioned chart of accounts** — GL structure locked to one DMS vendor
7. **Financial statements locked to desktop** — SWT-only FS generation, no web access

## The Single Most Impressive Thing

**Five AI agents autonomously process 100% of routine accounting transactions — validating, posting, reconciling, and orchestrating — while escalating edge cases to humans with severity-ranked reasoning and evidence. The controller sees only the exceptions, not the noise.**

---

# SECTION 2 — ARCHITECTURE OVERVIEW

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          BROWSER (React + Vite)                             │
│   Dashboard │ Command Center │ GL │ EOM │ Payroll │ Agents │ Approvals     │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │ HTTP/REST + SSE
                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    NGINX API GATEWAY (port 80/8081)                         │
│   /api/v1/gl → gl:3010    /api/v1/agents/t1 → t1:3024 (SSE unbuffered)   │
│   /api/v1/eom → eom:3011  /api/v1/approvals → approvals:3033             │
│   ... 20 upstream routes with x-tenant-id header injection                 │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
┌──────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│ CORE SERVICES│  │   DOMAIN SERVICES    │  │   AI AGENT SERVICES  │
│              │  │                      │  │                      │
│ auth    :3001│  │ gl-service     :3010 │  │ agent-gl       :3020 │
│ tenant  :3002│  │ eom-service    :3011 │  │ agent-eom      :3021 │
│              │  │ payroll-service:3012 │  │ agent-payroll  :3022 │
│              │  │ apar-service   :3013 │  │ agent-apar     :3023 │
│              │  │ recon-service  :3014 │  │ agent-t1       :3024 │
│              │  │ fs-service     :3015 │  │                      │
│              │  │ coa-service    :3016 │  │                      │
└──────────────┘  └──────────────────────┘  └──────────────────────┘
        │                       │                       │
        ▼                       ▼                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                    INTEGRATION SERVICES                          │
│ notification:3030 │ audit:3031 │ connector:3032 │ approval:3033 │
│ onboarding:3035                                                  │
└──────────────────────────────────────────────────────────────────┘
        │                       │                       │
        ▼                       ▼                       ▼
┌──────────────┐  ┌──────────────────┐  ┌──────────────────────────┐
│ PostgreSQL 15│  │ RabbitMQ 3.x     │  │ Redis 7                  │
│ port 5433    │  │ port 5672/15672  │  │ port 6380                │
│              │  │ Exchange:         │  │ Caching                  │
│ 8 Prisma     │  │ amacc.events     │  │                          │
│ schemas      │  │ (topic, durable) │  │                          │
└──────────────┘  └──────────────────┘  └──────────────────────────┘
```

## All 19 Microservices

| # | Service | Port | Database | Purpose |
|---|---------|------|----------|---------|
| 1 | **auth-service** | 3001 | Prisma (ApiKey, RefreshToken) | JWT authentication, API key exchange, bcrypt-hashed keys |
| 2 | **tenant-service** | 3002 | Prisma (Tenant) | Multi-tenant provisioning, schema isolation, DMS config |
| 3 | **gl-service** | 3010 | Prisma (GLAccount, JournalEntry, JournalLine) | General ledger, journal posting, trial balance, dashboard, command center |
| 4 | **eom-service** | 3011 | Prisma (EOMClose, EOMStep) | 13-step month-end close orchestration with dependency graph |
| 5 | **payroll-service** | 3012 | Prisma (PayrollBatch) | Payroll batch lifecycle with idempotency deduplication |
| 6 | **apar-service** | 3013 | Prisma (AREntry, APEntry) | Accounts payable/receivable, OEM remittance import |
| 7 | **recon-service** | 3014 | Prisma (BankRecon, BankTransaction) | Bank reconciliation with variance analysis |
| 8 | **fs-service** | 3015 | In-memory | OEM financial statement generation (GM, Ford formatters) |
| 9 | **coa-service** | 3016 | In-memory (60+ canonical accounts) | Standard chart of accounts, OEM line mappings, legacy GL migration |
| 10 | **agent-gl** | 3020 | — | GL Integrity Agent (Claude AI) |
| 11 | **agent-eom** | 3021 | — | EOM Orchestration Agent (Claude AI) |
| 12 | **agent-payroll** | 3022 | — | Payroll Integrity Agent (Claude AI) |
| 13 | **agent-apar** | 3023 | — | AP/AR Reconciliation Agent (Claude AI) |
| 14 | **agent-t1** | 3024 | — | T1 Copilot Agent (Claude AI, SSE streaming) |
| 15 | **notification-service** | 3030 | — | Webhook + console notification dispatch |
| 16 | **audit-service** | 3031 | Prisma (AgentLog) | Event-driven audit logging for all agent actions |
| 17 | **connector-service** | 3032 | — | DMS adapter registry (AutoMate, CDK, Reynolds, Dealertrack) |
| 18 | **approval-service** | 3033 | In-memory | Human-in-the-loop approval workflow with auto-expiry |
| 19 | **onboarding-service** | 3035 | In-memory | 5-step tenant onboarding wizard |

## Technology Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18, TypeScript, Vite, TailwindCSS, TanStack Query, React Router v7, Recharts |
| **Backend** | Node.js, Fastify, TypeScript, tsyringe (DI), Zod (validation), Pino (logging) |
| **Database** | PostgreSQL 15 via Prisma ORM (8 separate schemas) |
| **Messaging** | RabbitMQ 3.x — topic exchange `amacc.events` with durable/persistent delivery |
| **Caching** | Redis 7 |
| **AI Engine** | Anthropic Claude (`claude-sonnet-4-5-20250514`), 4096 max tokens, tool-use loop (max 10 iterations) |
| **API Gateway** | Nginx (reverse proxy with 20 upstream routes, SSE support for T1 agent) |
| **Containerization** | Docker + docker-compose (22 containers) |
| **Shared Libraries** | `@amacc/shared-kernel` TypeScript monorepo package |

## How the API Gateway Works

The Nginx gateway at port 80 (mapped to 8081 on host) provides:

1. **20 route rules** — each `/api/v1/{domain}` path proxied to the owning service
2. **Tenant header injection** — `x-tenant-id` header defaults to `tenant-kunes` if not provided by client
3. **SSE streaming support** — `/api/v1/agents/t1` route has `proxy_buffering off`, `proxy_cache off`, HTTP/1.1 with no chunked encoding for real-time streaming
4. **CORS headers** — `Access-Control-Allow-Origin: *` with preflight `OPTIONS` returning `204`
5. **Header forwarding** — `Authorization`, `x-admin-api-key`, `x-user-id` all passed through
6. **Timeout configuration** — 10s connect, 30s read/send

Key routing excerpt:
```nginx
location /api/v1/gl          { proxy_pass http://gl; }
location /api/v1/dashboard   { proxy_pass http://gl; }     # Dashboard served by gl-service
location /api/v1/command-center { proxy_pass http://gl; }   # Command center by gl-service
location /api/v1/eom         { proxy_pass http://eom; }
location /api/v1/agents/t1   { proxy_pass http://agent_t1; proxy_buffering off; }
```

## Multi-Tenancy Design

Tenant isolation is enforced at three layers:

1. **API Gateway** — injects `x-tenant-id` header on every request; defaults to `tenant-kunes`
2. **Service Layer** — every repository query filters by `tenantId`; every database entity includes `tenant_id` column
3. **Database Layer** — `Tenant.schemaName` generated from tenant name (lowercase, alphanumeric + underscore); composite unique indexes like `@@unique([tenantId, code])` on `gl_accounts` prevent cross-tenant data collision

**Branded types** in TypeScript prevent accidental mixing:
```typescript
type TenantId = string & { readonly __brand: 'TenantId' };
// Cannot pass an AccountId where TenantId is expected
```

## Docker Compose Setup

The `docker-compose.yml` defines **22 containers** with health-check dependencies:

```
Infrastructure:  postgres (5433), redis (6380), rabbitmq (5672/15672)
Core:           auth (3001), tenant (3002)
Domain:         gl (3010), eom (3011), payroll (3012), apar (3013), recon (3014)
Agents:         gl (3020), eom (3021), payroll (3022), apar (3023), t1 (3024)
Integration:    notification (3030), audit (3031), connector (3032), approval (3033)
Extended:       coa (3016), fs (3015), onboarding (3035)
Gateway:        nginx (8081→80)
Frontend:       web (5174)
```

All services share environment via YAML anchor `&service-env`:
- `DATABASE_URL: postgresql://amacc:amacc_dev@postgres:5432/amacc`
- `RABBITMQ_URL: amqp://guest:guest@rabbitmq:5672`
- `REDIS_URL: redis://redis:6379`
- `ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}`
- `JWT_SECRET`, `JWT_ISSUER`, `ADMIN_API_KEY`

Infrastructure services use health checks (`pg_isready`, `redis-cli ping`, `rabbitmq-diagnostics check_running`) and domain services depend on healthy infrastructure via `condition: service_healthy`.

---

# SECTION 3 — THE 5 AI AGENTS

## Agent Architecture (Shared Base)

All agents extend `BaseAgent` from `@amacc/shared-kernel`:

```typescript
abstract class BaseAgent {
  constructor(
    protected readonly claudeClient: IClaudeClient,
    protected readonly auditLogger: IAuditLogger,
    protected readonly eventPublisher: IEventPublisher,
  ) {}

  abstract getAgentName(): string;
  abstract getSystemPrompt(context: TenantContext): string;
  abstract buildTools(context: TenantContext): AnthropicTool[];
  abstract buildToolExecutor(context: TenantContext): ToolExecutor;
  protected abstract buildUserMessage(trigger: DomainEvent): string;

  async execute(tenantContext, trigger) → AgentResult {
    // 1. Build system prompt, tools, executor, user message
    // 2. Call claudeClient.runWithTools()
    // 3. Log result via auditLogger
    // 4. Publish AGENT_ACTION_TAKEN or AGENT_HUMAN_REQUIRED event
    // 5. Return AgentResult
  }
}
```

### Claude API Integration (All Agents)

File: `infrastructure/claude-client.ts` (identical in all 5 agents)

```typescript
class AnthropicClaudeClient implements IClaudeClient {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async runWithTools(systemPrompt, userMessage, tools, toolExecutor): Promise<AgentResult> {
    const messages = [{ role: 'user', content: userMessage }];

    // Tool use loop — max 10 iterations
    for (let i = 0; i < 10; i++) {
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-5-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages,
        tools: anthropicTools,
      });

      if (response.stop_reason === 'end_turn') { /* Extract text, break */ }
      if (response.stop_reason === 'tool_use') {
        // Execute each tool_use block via toolExecutor
        // Append tool_result messages
        // If tool is 'flag_for_human_review', set humanRequired = true
      }
    }
    return { agentName, actionTaken, outcome, humanRequired, details };
  }

  // Streaming variant for T1 Copilot (SSE)
  async streamWithTools(..., onChunk: (chunk: string) => void): Promise<AgentResult> {
    // Same loop but uses this.client.messages.stream()
    // Calls onChunk(text) for each content_block_delta
  }
}
```

---

## Agent 1: GL Integrity Agent

| Property | Value |
|----------|-------|
| **Service** | `agent-gl` |
| **Port** | 3020 |
| **Class** | `GLIntegrityAgent` extends `BaseAgent` |
| **Trigger Event** | `JOURNAL_ENTRY_SUBMITTED` |
| **Subscription** | RabbitMQ topic exchange `amacc.events` |

### System Prompt (Verbatim)

```
You are the GL Integrity Agent for tenant ${context.tenantId}.
Your job is to review journal entries submitted for posting and check for:
1. Duplicate entries (same source_ref within the last 5 minutes)
2. GL account type correctness (e.g., revenue posting to an asset account = flag)
3. Debit/credit balance (must be equal)
4. Unusual amounts (>3x the 30-day average = warn)

If the entry looks clean, approve it by calling post_journal_entry.
If suspicious, flag it for human review with a clear reason.
Always explain your reasoning.
```

### Tools (5 Total)

| Tool | Description | Parameters |
|------|------------|-----------|
| `get_journal_entries` | Get recent entries to check for duplicates | `dateFrom` (ISO string), `status` (DRAFT/POSTED/REVERSED) |
| `get_gl_accounts` | Get all GL accounts for this tenant | none |
| `get_trial_balance` | Get trial balance for a period | `year` (number, required), `month` (number, required) |
| `post_journal_entry` | Approve and post a journal entry | `entryId` (string, required) |
| `flag_for_human_review` | Flag an entity for human review | `entityType`, `entityId`, `reason`, `severity` (INFO/WARN/CRITICAL) — all required |

### Step-by-Step Execution Flow

1. `JOURNAL_ENTRY_SUBMITTED` event published by `gl-service` when a new entry is created
2. Agent receives event with payload: `{ entryId, description, lineCount, totalDebits }`
3. Claude receives system prompt + user message:
   ```
   A journal entry has been submitted for posting.
   Entry ID: ${entryId}, Description: ${description}
   Total Lines: ${lineCount}, Total Debits: $${totalDebits}
   Please review this entry for integrity issues before approving it for posting.
   ```
4. Claude calls `get_journal_entries` to check for duplicates (same `source_ref` in last 5 minutes)
5. Claude calls `get_gl_accounts` to validate account types on each line
6. Claude evaluates debit/credit balance
7. Claude checks if amount is anomalous (>3x 30-day average via trial balance)
8. **If clean** → Claude calls `post_journal_entry(entryId)` → entry status changes to POSTED
9. **If suspicious** → Claude calls `flag_for_human_review` with severity and reason → `humanRequired = true`

### What It Escalates and Why

| Condition | Severity | Why It Escalates |
|-----------|----------|-----------------|
| Same `source_ref` posted within 5 minutes | CRITICAL | Prevents duplicate posting (e.g., double-posted RO close) |
| Revenue posted to asset account | WARN | Account type mismatch indicates miscoding |
| Debits ≠ credits (tolerance: $0.01) | CRITICAL | Unbalanced entry would corrupt GL |
| Amount > 3× 30-day average | WARN | Anomalous amount may indicate data entry error |

### Business Impact

**Without this agent:** A $42,000 vehicle sale journal entry could be posted twice if the DMS connector retries. A warranty labor credit could be posted to a parts inventory account. An unbalanced entry could silently corrupt the trial balance — discovered only at month-end, requiring days of forensic reconciliation.

---

## Agent 2: EOM Orchestration Agent

| Property | Value |
|----------|-------|
| **Service** | `agent-eom` |
| **Port** | 3021 |
| **Class** | `EOMOrchestrationAgent` extends `BaseAgent` |
| **Trigger Event** | `EOM_STEP_CHANGED` |

### System Prompt (Verbatim)

```
You are the EOM Orchestration Agent for tenant ${context.tenantId}.
You manage end-of-month close processes. The step dependency graph is:
Parts Close (062) → Parts Recon (065) → Service Close (068) → Variable Ops (071) → Fixed Ops (074) → Master Close (077)

Your job:
1. Check which steps are complete and what is blocking
2. Auto-advance eligible steps
3. Surface blocker root cause in plain English
4. Escalate after 3 retries with a human-readable summary
```

### Tools (3 Total)

| Tool | Description | Parameters |
|------|------------|-----------|
| `get_eom_steps` | Get all steps for an EOM close | `closeId` (required) |
| `advance_eom_step` | Advance to the next step | `closeId` (required), `stepCode` (required) |
| `flag_for_human_review` | Escalate to human | `entityType`, `entityId`, `reason`, `severity` — all required |

### Step-by-Step Execution Flow

1. Any EOM step status change publishes `EOM_STEP_CHANGED` with `{ closeId, stepCode }`
2. Agent calls `get_eom_steps(closeId)` to see current state of all 13 steps
3. Claude evaluates the dependency graph:
   - Pre-Close (010) → Verify Open Items (020) → Parts Close (062) → Parts Recon (065) → Service Close (068) → Body Shop (070) → Variable Ops (071) → Fixed Ops (074) → Master Close (077) → FS Generation (200) → FS Submission (210) → 13th Month Snapshot (300) → 13th Month Final (310)
4. If a step is DONE and the next step's dependencies are met → calls `advance_eom_step`
5. If a step is BLOCKED → checks `retryCount`
   - If `retryCount < 3` → retries the blocked step
   - If `retryCount >= 3` → calls `flag_for_human_review` with CRITICAL severity and root cause explanation
6. Publishes audit entry

### What It Escalates and Why

| Condition | Severity | Why |
|-----------|----------|-----|
| Step blocked after 3 retries | CRITICAL | Automated recovery exhausted; human investigation needed |
| Master Close (077) attempted with incomplete deps | WARN | All departmental closes must complete before master |
| FS Generation (200) fails validation | CRITICAL | Financial statements cannot be submitted to OEM |

### Business Impact

**Without this agent:** Month-end close takes 3–5 days of manual Step→Check→Advance→Wait cycles. The controller must track which department closed, which is blocking, and advance each step manually. With the agent, auto-advanceable steps complete in seconds, and the controller only intervenes on genuine blockers — reducing close from days to hours.

---

## Agent 3: Payroll Integrity Agent

| Property | Value |
|----------|-------|
| **Service** | `agent-payroll` |
| **Port** | 3022 |
| **Class** | `PayrollIntegrityAgent` extends `BaseAgent` |
| **Trigger Event** | `PAYROLL_BATCH_SUBMITTED` |

### System Prompt (Verbatim)

```
You are the Payroll Integrity Agent for tenant ${context.tenantId}.
Check payroll batches for:
1. Idempotency key uniqueness (same key in 24h = duplicate → REJECT)
2. Total amount vs prior period (>15% variance = warn)
3. GL account mapping completeness
4. Batch period overlap detection

Actions: PASS (auto-post eligible), HOLD (needs human), REJECT (clear duplicate)
```

### Tools (3 Total)

| Tool | Description | Parameters |
|------|------------|-----------|
| `get_payroll_batch` | Get payroll batch details | `batchId` (required) |
| `hold_payroll_batch` | Hold batch for human review | `batchId` (required), `reason` (required) |
| `flag_for_human_review` | Flag for human review | `entityType`, `entityId`, `reason`, `severity` — all required |

### Step-by-Step Execution Flow

1. `payroll-service` publishes `PAYROLL_BATCH_SUBMITTED` with `{ batchId, totalAmount, batchRef }`
2. Agent receives user message:
   ```
   Payroll batch submitted for validation. Batch ID: ${batchId},
   Total: $${totalAmount}, Ref: ${batchRef}. Please validate this batch.
   ```
3. Claude calls `get_payroll_batch(batchId)` to retrieve full batch details
4. Claude checks:
   - **Idempotency**: Is `idempotencyKey` unique within 24 hours? If not → REJECT
   - **Variance**: Is `totalAmount` within 15% of prior period? If >15% → HOLD with reason
   - **GL mapping**: Are all payroll categories mapped to GL accounts? If gaps → HOLD
   - **Period overlap**: Does `periodStart–periodEnd` overlap with an existing posted batch? If yes → HOLD
5. **PASS** → No action needed; batch remains in VALIDATED state for posting
6. **HOLD** → Calls `hold_payroll_batch(batchId, reason)` → status changes to HELD
7. **REJECT** → Calls `flag_for_human_review` with CRITICAL severity

### What It Escalates and Why

| Condition | Action | Why |
|-----------|--------|-----|
| Duplicate idempotencyKey within 24h | REJECT | Prevents double-paying employees |
| Total amount >15% variance vs prior period | HOLD | Could indicate missing employees or data error |
| Unmapped GL accounts | HOLD | Payroll entries would post to wrong accounts |
| Overlapping batch periods | HOLD | Same period already processed |

### Business Impact

**Without this agent:** A payroll batch submitted twice (network retry, user double-click) posts twice — employees get paid double, GL is overstated, and reversal requires manual journal entries against 20+ GL accounts. The agent catches this in milliseconds via idempotency key check.

---

## Agent 4: AP/AR Reconciliation Agent

| Property | Value |
|----------|-------|
| **Service** | `agent-apar` |
| **Port** | 3023 |
| **Class** | `APARReconAgent` extends `BaseAgent` |
| **Trigger Events** | `OEM_REMITTANCE_IMPORTED`, `BANK_RECON_STARTED` |

### System Prompt (Verbatim)

```
You are the AP/AR Reconciliation Agent for tenant ${context.tenantId}.
When OEM remittance is imported or bank recon starts:
1. Match warranty AR entries to remittance lines by claim number + amount
2. Flag unmatched AR older than 45 days
3. Identify short-payments
4. Auto-generate journal entries for matched items
5. Flag unmatched items for human review
```

### Tools (4 Total)

| Tool | Description | Parameters |
|------|------------|-----------|
| `get_gl_accounts` | Get GL accounts | none |
| `get_journal_entries` | Get journal entries | `status` |
| `create_journal_entry` | Create a new journal entry | `description` (required), `lines` (array of {glAccountId, debit, credit}, required) |
| `flag_for_human_review` | Flag for review | `entityType`, `entityId`, `reason`, `severity` — all required |

### Step-by-Step Execution Flow

**OEM Remittance Trigger:**
1. `apar-service` bulk-imports OEM remittance entries → publishes `OEM_REMITTANCE_IMPORTED` with `{ count, totalAmount }`
2. Agent receives: `"OEM remittance has been imported with ${count} entries totaling $${totalAmount}. Please match AR entries and create journal entries for matched items."`
3. Claude calls `get_journal_entries(status='POSTED')` to find existing AR entries
4. Claude matches by claim number + amount
5. For matched items → calls `create_journal_entry` to generate offset entries (debit AR clearing, credit cash/remittance)
6. For unmatched AR > 45 days → calls `flag_for_human_review` with WARN severity
7. For short-payments → calls `flag_for_human_review` with details of the shortfall

**Bank Recon Trigger:**
1. `recon-service` creates a new reconciliation → publishes `BANK_RECON_STARTED` with `{ reconId }`
2. Agent processes transaction matching against GL journal lines

### What It Escalates and Why

| Condition | Severity | Why |
|-----------|----------|-----|
| AR open > 45 days with no remittance match | WARN | Potential write-off candidate |
| Short-payment (remittance < AR amount) | WARN | OEM paid less than claimed — needs investigation |
| Unmatched bank transactions | INFO | Could be timing differences or unrecorded entries |

### Business Impact

**Without this agent:** A controller manually matches 50–200 warranty claims per month to OEM remittance lines in a spreadsheet. Claims that fall through the cracks become uncollectable after 90 days. The agent matches automatically, creates clearing entries, and surfaces only the exceptions.

---

## Agent 5: T1 Copilot Agent

| Property | Value |
|----------|-------|
| **Service** | `agent-t1` |
| **Port** | 3024 |
| **Class** | `T1CopilotAgent` extends `BaseAgent` |
| **Trigger** | HTTP POST `/api/v1/agents/t1/chat` (not event-driven) |
| **Response** | Server-Sent Events (SSE) streaming |

### System Prompt (Verbatim — 40 lines)

```
You are the T1 Accounting Copilot for AMACC — the comprehensive AI-powered
Automotive Accounting Cloud platform.

Current Context:
- Tenant: ${context.tenantId}
- Dealer: ${context.dealerName}
- User: ${context.userName} (${context.userRole})
- DMS: ${context.dmsType}
- OEMs: ${context.oems.join(', ')}

Capabilities — Read Operations:
- Query GL accounts, journal entries, trial balances
- Check EOM close progress and identify blockers
- View payroll batch status and details
- Preview OEM Financial Statements (GM/Ford/etc.)
- Check pending approval requests
- Review EOM readiness across departments

Capabilities — Write Operations (Require Approval for High-Impact):
- Post validated journal entries
- Hold/release payroll batches
- Create correcting journal entries
- Request approval for significant actions
- Flag items for human review

Guidelines:
- Always be precise with dollar amounts (cents internally, display as dollars)
- Reference specific account codes (e.g., 4100 Service Labor Sales)
- For large corrections, recommend splitting into smaller entries
- If unsure, flag for human review rather than guessing
```

### Tools (13 Total — Most Capable Agent)

**Read tools (8):** `get_gl_accounts`, `get_journal_entries`, `get_trial_balance`, `get_payroll_batch`, `get_eom_steps`, `get_fs_preview`, `get_pending_approvals`, `get_eom_readiness`

**Write tools (5):** `post_journal_entry`, `hold_payroll_batch`, `create_journal_entry`, `request_approval`, `flag_for_human_review`

### SSE Streaming Architecture

```typescript
app.post('/t1/chat', async (request, reply) => {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  await claudeClient.streamWithTools(
    agent.getSystemPrompt(context),
    message,
    agent.buildTools(context),
    agent.buildToolExecutor(context),
    (chunk) => {
      reply.raw.write(`data: ${JSON.stringify({ type: 'text', content: chunk })}\n\n`);
    },
  );
  reply.raw.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
  reply.raw.end();
});
```

### Business Impact

**T1 is the "Ask Ashley" copilot.** Instead of running 5 reports to answer "why is our trial balance off?", the controller types the question and T1 calls `get_trial_balance`, `get_journal_entries`, and `get_gl_accounts` — then synthesizes the answer in natural language with specific account codes and dollar amounts.

---

# SECTION 4 — FRONTEND PAGES

All pages are in `apps/web/src/pages/`. The frontend uses React 18 + TypeScript + TanStack Query + Recharts + TailwindCSS.

## Core Operations Pages

### 1. Dashboard (`Dashboard.tsx`)
| Property | Value |
|----------|-------|
| **Shows** | Controller/CFO landing page with financial overview |
| **Key Features** | 6 financial KPIs (Revenue, Expenses, Net Income, Assets, Liabilities, Equity), 5 operational KPIs (GL Entries Today, EOM Close Status, Total Cash, Agent Alerts, Recon Variance), 6-month revenue/expense trend LineChart, department gross profit PieChart, AP/AR aging BarCharts, recent GL entries table, floorplan exposure tracking |
| **Target User** | CFO, Controller, Dealer Principal |
| **Auto-refresh** | 30 seconds |
| **Wow Element** | Pulsing amber "Pending Approvals" badge with real-time count |

### 2. Accounting Command Center (`AccountingCommandCenter.tsx`)
| Property | Value |
|----------|-------|
| **Shows** | Real-time operations nerve center |
| **Key Features** | 8 live KPI cards with color-coded borders (green=healthy, red=attention), Accounting Intelligence alert panel (CRITICAL/REVIEW/INFO priority), GL Monitor with account balances and variance detection, KPI trend charts, Revenue by Department PieChart, Cash Flow BarChart, AR/AP Aging BarChart |
| **Target User** | Controller, Accounting Manager |
| **Auto-refresh** | 15 seconds |
| **Wow Element** | **"Ask Ashley" AI Copilot** — natural language Q&A powered by T1 agent with streaming responses |

### 3. General Ledger (`GeneralLedger.tsx`)
| Property | Value |
|----------|-------|
| **Shows** | 3-tab interface: Chart of Accounts, Journal Entries, Trial Balance |
| **Key Features** | COA list with account type badges, JE list with status filters (DRAFT/POSTED/HELD) + source filters, Post button per entry, Create Entry form with dynamic line items, Trial Balance with debit/credit totals |
| **Target User** | Accounting Manager |
| **Wow Element** | `agentReviewed` badge on journal entries — shows which entries were AI-validated |

### 4. EOM Close (`EOMClose.tsx`)
| Property | Value |
|----------|-------|
| **Shows** | Month-end close orchestration dashboard |
| **Key Features** | Visual step pipeline — color-coded boxes (green=DONE, blue pulsing=RUNNING, red=BLOCKED, gray=PENDING), Advance and Retry buttons, blocked reason alert panel, retry count per step, "Initiate Close" button for new months, historical closes list |
| **Target User** | Controller |
| **Wow Element** | Animated blue pulse on RUNNING steps — feels like a live pipeline |

### 5. Payroll (`Payroll.tsx`)
| Property | Value |
|----------|-------|
| **Shows** | Payroll batch management |
| **Key Features** | Batch list with status badges (PENDING/VALIDATED/POSTED/HELD), Submit/Validate/Post/Hold/Release action buttons per batch, "Create Batch" form with period start/end, amount, idempotency key, reason display for held batches |
| **Target User** | Accounting Manager, Payroll Admin |
| **Wow Element** | Hold/Release workflow — shows WHY the AI agent held the batch |

### 6. Reconciliation (`Reconciliation.tsx`)
| Property | Value |
|----------|-------|
| **Shows** | Bank reconciliation sessions |
| **Key Features** | Session list with GL balance vs bank balance + variance, "Create Recon" form, transaction import, unmatched transaction table with manual match button, "Complete" to lock recon |
| **Target User** | Accounting Manager |
| **Wow Element** | Variance calculation auto-updates — red when non-zero, green when matched |

## AI & Approval Pages

### 7. AI Agents (`Agents.tsx`)
| Property | Value |
|----------|-------|
| **Shows** | AI agent dashboard and human-in-the-loop queue |
| **Key Features** | 5 agent cards (GL Integrity, EOM Orchestration, Payroll Integrity, AP/AR Recon, T1 Copilot) with 🤖 icons, "Human Required" queue with severity badges (HIGH/MEDIUM) and agent reasoning, Resolve button per escalation, T1 Copilot chat interface with SSE streaming |
| **Target User** | Agent Approver, Controller |
| **Auto-refresh** | 30 seconds |
| **Wow Element** | Real-time streaming chat with T1 Copilot — responses appear character by character |

### 8. Approvals (`Approvals.tsx`)
| Property | Value |
|----------|-------|
| **Shows** | Pending approval queue + history |
| **Key Features** | Approval cards with amber left border, agent name + action type, evidence bullet points, reasoning text, 24-hour expiration timer, Approve/Reject buttons, approval history table |
| **Target User** | Agent Approver, Controller |
| **Auto-refresh** | 10 seconds |
| **Wow Element** | Evidence-based display — the AI explains WHY it's requesting approval |

## Financial Reporting Pages

### 9. Financial Statements (`FSPreview.tsx`)
| Property | Value |
|----------|-------|
| **Shows** | OEM-formatted financial statement preview |
| **Key Features** | Tenant/Period/OEM selector, department tabs (New/Used/Service/Parts/Body/F&I), FS page display with line numbers and amounts, validation errors panel, Submit button (blocked by CRITICAL validation errors) |
| **Target User** | Controller, CFO |
| **Wow Element** | OEM-specific formatting — GM Standard FS vs Ford OWS layouts |

### 10. Reports (`Reports.tsx`)
| Property | Value |
|----------|-------|
| **Shows** | Accounting report library |
| **Key Features** | 9 report types (Trial Balance, Income Statement, Balance Sheet, Cash Flow, Department P&L, Vehicle Inventory, Sales Tax, 1099 Summary, Custom GL), date range + department filters, mock preview tables |
| **Target User** | Controller, Accounting Manager |
| **Wow Element** | Department P&L breakdown — New/Used/Service/Parts/F&I/Body Shop |

### 11. Transactions (`Transactions.tsx`)
| Property | Value |
|----------|-------|
| **Shows** | Transaction search and journal line detail |
| **Key Features** | Search by GL account, date range, source, reference, amount; detail view with journal lines; transaction source badges (AUTOMATE_DMS, CONNECTOR_CDK, MANUAL, PAYROLL) |
| **Target User** | Accounting Manager |

### 12. Schedules (`Schedules.tsx`)
| Property | Value |
|----------|-------|
| **Shows** | GL schedule management (43 schedules) |
| **Key Features** | Schedule list with GL account count, schedule health dots (green ≥2, amber=1, red=0), detail view with linked accounts and balance totals |
| **Target User** | Controller |

## Operations Pages

### 13. Accounts Payable (`AccountsPayable.tsx`)
| Property | Value |
|----------|-------|
| **Shows** | AP invoice management and aging |
| **Key Features** | Invoice list with due date, vendor, amount, status; aging summary (Current/30/60/90/90+); "New Invoice" form; pay/approve actions |
| **Target User** | Accounting Manager |

### 14. Cash Receipts (`CashReceipts.tsx`)
| Property | Value |
|----------|-------|
| **Shows** | Cash posting interface |
| **Key Features** | Receipt list, apply-to-account interface, batch deposits, source selection (Cash/Check/CC/Wire), unapplied payment tracking |
| **Target User** | Accounting Manager |

### 15. Purchase Orders (`PurchaseOrders.tsx`)
| Property | Value |
|----------|-------|
| **Shows** | PO lifecycle (Create/Receive/Close) |
| **Key Features** | 3 tabs (List/Create/Receiving), PO line items with Part#/Qty/Unit Cost/GL Account, status badges (Open/Partial/Received/Closed) |
| **Target User** | Parts Manager |

### 16. Vendor Management (`VendorManagement.tsx`)
| Property | Value |
|----------|-------|
| **Shows** | Vendor master file |
| **Key Features** | Vendor list with 1099 flag, contact info, payment terms, YTD summary, "Add Vendor" form with tax ID |
| **Target User** | Accounting Manager |

### 17. Warranty & DCS (`WarrantyDCS.tsx`)
| Property | Value |
|----------|-------|
| **Shows** | OEM warranty claim management |
| **Key Features** | Claims list by OEM (GM/Ford/FCA/Honda/Toyota), status tracking (Pending→Submitted→Approved→Paid/Rejected), "New Claim" form with operation codes, factory statement reconciliation |
| **Target User** | Service Manager, Warranty Admin |
| **Wow Element** | Consolidates 5 legacy screens (ACDCSFST, GMDCSFAC, FORDYMNT, HNDCSFST, MBDCSFST) into one |

### 18. Intercompany (`Intercompany.tsx`)
| Property | Value |
|----------|-------|
| **Shows** | Multi-rooftop intercompany transfers |
| **Key Features** | Transfer log with From/To company, "Create Transfer" form with matching entry auto-creation, company list with DMS type/rooftop count |
| **Target User** | Controller (multi-dealership groups) |

## Admin Pages

### 19. Chart of Accounts (`ChartOfAccounts.tsx`)
| Property | Value |
|----------|-------|
| **Shows** | GL account master file for Lee Hyundai Co.03 |
| **Key Features** | 70+ GL accounts with type badges (Asset/Liability/Expense/Income/DIST), OEM prefix flags (HYUNDAI=blue, GENESIS=purple), distribution routing for DIST accounts, schedule health sidebar (43 schedules), control code display (NONE/LOOKUP_CONTROL/APPLY_TO/STOCK_NUMBER) |
| **Target User** | Controller |
| **Wow Element** | Schedule Health sidebar — 43 schedules with red/amber/green dots showing GL coverage |

### 20. System Settings (`SystemSettings.tsx`)
| Property | Value |
|----------|-------|
| **Shows** | Complete system configuration for Lee Hyundai Company 03 |
| **Key Features** | 6 tabs: Company Profile, Fiscal & Period (8-month timeline), Accounting Behavior (5 toggles), OEM Warranty Remittance (12 repair type mappings), Access & Permissions (role-based journal source matrix + 43-schedule access grid), Service EOD (manual/automatic/batch) |
| **Target User** | Controller, System Admin |
| **Wow Element** | Permission matrix — 43 schedules × 5 roles with ✏️/👁️/🚫 access icons |

### 21. Year-End Close (`YearEnd.tsx`)
| Property | Value |
|----------|-------|
| **Shows** | Fiscal year-end orchestration |
| **Key Features** | 12-step checklist with progress tracking, close panel with 5 consequence warnings, validation checklist (5 checks with ✓/✗), retained earnings GL account selection, 3-year history table |
| **Target User** | Controller |

### 22. Tenants (`Tenants.tsx`)
| Property | Value |
|----------|-------|
| **Shows** | Multi-tenant administration |
| **Key Features** | Tenant list with status/OEM/DMS badges, "Create Tenant" form |
| **Target User** | Platform Admin |

### 23. Onboarding (`Onboarding.tsx`)
| Property | Value |
|----------|-------|
| **Shows** | 5-step new tenant setup wizard |
| **Key Features** | Steps: DMS Config → OEM Config → COA Setup → Import History → FS Validation, step-by-step progression with completion tracking |
| **Target User** | Platform Admin |

### 24. Analytics (`Analytics.tsx`)
| Property | Value |
|----------|-------|
| **Shows** | Performance analytics and trend analysis |
| **Target User** | CFO |

### 25. Utilities (`Utilities.tsx`)
| Property | Value |
|----------|-------|
| **Shows** | System maintenance tools |
| **Key Features** | 8 utility cards (Fix OOB, Journal Repair, Reverse Transaction, Recalculate Balances, Purge Old Data, Rebuild Indexes, Export Audit Trail, Validate COA), risk-colored badges (red/amber/green), OOB scan with auto-fix, utility execution log |
| **Target User** | System Admin |

### 26. Setup, Journal Sources, Bank Deposits
| **Setup** | Office initialization (company #, fiscal year start, DMS connection) |
| **Journal Sources** | Source whitelist management (AUTOMATE_DMS, CDK, MANUAL, PAYROLL, etc.) |
| **Bank Deposits** | Deposit slip creation and batch posting |

---

# SECTION 5 — DATA MODEL

## Database Tables Per Service (8 Prisma Schemas)

| Service | Tables | Key Fields |
|---------|--------|-----------|
| **auth-service** | `api_keys`, `refresh_tokens` | `key_hash` (bcrypt), `scopes` (string[]), `tenant_id` |
| **tenant-service** | `tenants` | `schema_name` (unique), `dms_type`, `rooftop_count`, `webhook_url` |
| **gl-service** | `gl_accounts`, `journal_entries`, `journal_lines` | FK: `journal_lines.gl_account_id → gl_accounts.id`, `journal_lines.journal_entry_id → journal_entries.id` |
| **eom-service** | `eom_closes`, `eom_steps` | FK: `eom_steps.eom_close_id → eom_closes.id`; Unique: `[tenantId, periodYear, periodMonth]` |
| **payroll-service** | `payroll_batches` | Unique: `[tenantId, idempotencyKey]` for deduplication |
| **apar-service** | `ar_entries`, `ap_entries` | AR types: WARRANTY/FLOORPLAN/RECEIVABLE; `oem_source` tracking |
| **recon-service** | `bank_recons`, `bank_transactions` | FK: `bank_transactions.bank_recon_id → bank_recons.id`; `matched_journal_line_id` for matching |
| **audit-service** | `agent_logs` | Indexed: `[tenantId, agentName]`, `[humanRequired]` |

**Total: 14 database tables across 8 Prisma schemas**

## How Money Is Handled

```typescript
// shared-kernel/src/types/index.ts
interface Money {
  readonly amount: number;   // Stored as CENTS — integer, never float
  readonly currency: 'USD';
}

function money(amountCents: number): Money {
  return { amount: amountCents, currency: 'USD' };
}
```

- All monetary values are stored as **integer cents** (`245_000_00` = $245,000.00)
- Frontend formats: `$${(cents / 100).toLocaleString()}`
- Database uses `DOUBLE PRECISION` at Prisma level (for cross-DB compatibility) but application code treats as integer cents
- No floating-point arithmetic ever touches monetary calculations

## How TenantId Prevents Cross-Tenant Data Leaks

Three-layer defense:

1. **Branded Type (compile-time)**
   ```typescript
   type TenantId = string & { readonly __brand: 'TenantId' };
   // Cannot accidentally pass a UserId where TenantId is expected
   ```

2. **Database Indexes (storage-level)**
   ```prisma
   @@unique([tenantId, code])           // gl_accounts
   @@unique([tenantId, periodYear, periodMonth])  // eom_closes
   @@unique([tenantId, idempotencyKey])  // payroll_batches
   @@index([tenantId])                   // every table
   ```

3. **API Gateway (request-level)**
   ```nginx
   map $http_x_tenant_id $tenant_id {
       default  $http_x_tenant_id;
       ""       "tenant-kunes";
   }
   proxy_set_header x-tenant-id $tenant_id;
   ```

## Journal Entry Lifecycle

```
┌──────┐   create    ┌─────────┐  agent review   ┌─────────┐   post    ┌────────┐
│      │ ──────────► │         │ ──────────────► │         │ ───────► │        │
│ NEW  │             │  DRAFT  │                 │ PENDING │          │ POSTED │
│      │             │         │ ◄────────────── │         │          │        │
└──────┘             └─────────┘   hold (agent)  └─────────┘          └────────┘
                          │                           │                    │
                          │         flag_for_review   │                    │
                          │ ◄──────────────────────── │                    │
                          ▼                                                ▼
                     ┌─────────┐                                    ┌──────────┐
                     │  HELD   │                                    │ REVERSED │
                     └─────────┘                                    └──────────┘
```

**Status flow:** DRAFT → PENDING → POSTED (or HELD → re-PENDING)
- `source`: AUTOMATE_DMS, CONNECTOR_CDK, CONNECTOR_REYNOLDS, CONNECTOR_DEALERTRACK, MANUAL, PAYROLL, EOM_AGENT
- `sourceRef`: External reference for duplicate detection
- `agentReviewed`: Boolean flag set to `true` after GL Integrity Agent processes it

## EOM Close Step Sequence

| # | Step Code | Step Name | Depends On |
|---|-----------|-----------|-----------|
| 1 | **010** | Pre-Close Checklist | — |
| 2 | **020** | Verify Open Items | 010 |
| 3 | **062** | Parts Close | 020 |
| 4 | **065** | Parts Reconciliation | 062 |
| 5 | **068** | Service Close | 065 |
| 6 | **070** | Body Shop Close | 068 |
| 7 | **071** | Variable Ops | 070 |
| 8 | **074** | Fixed Ops | 071 |
| 9 | **077** | Master Close | 074 (all departmental closes) |
| 10 | **200** | Financial Statement Generation | 077 |
| 11 | **210** | Financial Statement Submission | 200 |
| 12 | **300** | 13th Month Snapshot | 210 |
| 13 | **310** | 13th Month Final | 300 |

Step statuses: `PENDING → RUNNING → DONE` (or `BLOCKED`)
- `retryCount` tracked per step
- After 3 retries → EOM Agent escalates with CRITICAL severity
- Close types: `MONTHLY`, `YEAR_END`, `13TH_MONTH`

---

# SECTION 6 — INTEGRATION WITH FIXED OPS DMS

## How the Invoice Agent Passes Data to AMACC

The `connector-service` (port 3032) acts as the bridge between DMS systems and AMACC's GL. It receives normalized deal/RO data via the `/api/v1/connector/ingest` endpoint.

### API Endpoint for RO Close

```
POST /api/v1/connector/ingest
Content-Type: application/json
x-tenant-id: tenant-kunes

{
  "dmsType": "AUTOMATE",    // or "CDK", "REYNOLDS", "DEALERTRACK"
  "payload": { ... },        // Raw DMS-specific payload
  "autoPost": true,          // If true, immediately posts to GL
  "transactionType": "SERVICE_RO"  // or "INVOICE", "WARRANTY", "VEHICLE_SALE"
}
```

### DMS Adapter Pipeline

1. **Ingest** → connector-service receives raw DMS payload
2. **Normalize** → DMS adapter (AutoMate/CDK/Reynolds/Dealertrack) transforms to `CanonicalDealPost`:
   ```typescript
   interface CanonicalDealPost {
     sourceSystem: DMSType;
     tenantId: TenantId;
     dealNumber: string;
     dealType: 'NEW' | 'USED' | 'LEASE' | 'FLEET' | 'WHOLESALE';
     oem: OEMType;
     vehicleVin: string;
     salePrice: Money;
     costOfSale: Money;
     grossProfit: Money;
     journalLines: CreateJournalLineDTO[];
     // ... trade-in, F&I, addOns
   }
   ```
3. **Map to GL** → `mapDealToGLLines()` generates balanced journal lines per transaction type
4. **Resolve Accounts** → GL account codes resolved to UUIDs via HTTP call to `gl-service`
5. **Create Entry** → Journal entry created in `gl-service` via HTTP POST
6. **Auto-Post** → If `autoPost: true`, entry is immediately posted
7. **Event** → `JOURNAL_ENTRY_SUBMITTED` triggers GL Integrity Agent

### GL Account Mapping by Transaction Type

| Transaction Type | Debit Account | Credit Account |
|-----------------|---------------|----------------|
| `SERVICE_RO` | Cash/AR (1100/1200) | Service Labor Sales (4100), COS (5100) |
| `INVOICE` | Cash/AR | Parts Revenue (4200) |
| `WARRANTY` | AR-Factory (1110) | Warranty Revenue (4420) |
| `INCENTIVE` | Factory Incentive AR (1110) | Incentive Credit (4500) |
| `BODY_SHOP` | Cash/AR | Body Shop Revenue (4300) |
| `VEHICLE_SALE` | Cash/Floorplan | Vehicle Sales (4100), COS (5100), Trade-In, F&I |

### What Happens If GL Account Is Unmapped

1. The `coa-service` endpoint `GET /api/v1/coa/unmapped/:tenantId/:oem` returns all GL accounts without OEM FS line mappings
2. The `connector-service` `mapDealToGLLines()` falls back to a suspense account (9999) if the GL code-to-UUID resolution fails
3. The `GLValidationEngine` in `gl-service` has a `FSLineMappingGapRule` that flags entries with unmapped GL accounts:
   ```typescript
   class FSLineMappingGapRule implements IValidationRule<JournalEntry> {
     // Flags entries where GL accounts are not mapped to any OEM FS line
   }
   ```
4. The GL Integrity Agent detects anomalous account assignments and calls `flag_for_human_review`

---

# SECTION 7 — LEGACY COMPARISON

## What the Old COBOL Accounting Module Did

The legacy AutoMate accounting module is a COBOL-based monolith running on ISAM (Indexed Sequential Access Method) flat files, with a Java/SWT desktop UI layer. It provides:

- General Ledger posting via 45+ DAO classes (Spring JDBC, NOT Hibernate)
- Journal entry management through 22+ REST services in AccountingRestApp
- Financial statement generation locked to SWT desktop forms
- 9+ COBOL writers actively syncing to legacy ISAM files
- Transaction pipeline: Module → `pending_transaction` → `TransactionDBDAO` → `posted_transaction` → `journal_period_balance` → COBOL sync

## The 7 Confirmed Failure Modes in Legacy AMACC

### Failure Mode 1: No Concurrent User Protection (EOM Close)
**Legacy:** EOM close uses a status flag (`IN_PROGRESS`) but two users can initiate close simultaneously — both read the flag as "not in progress," both proceed, and the close data is corrupted.
**AMACC Fix:** `eom_closes` table has `@@unique([tenantId, periodYear, periodMonth])` — only one close can exist per period. The EOM Agent is the single orchestrator; concurrent human attempts are rejected at the database level.

### Failure Mode 2: No Duplicate Entry Detection
**Legacy:** A journal entry with the same source reference can be posted multiple times. The DMS connector retries on timeout, and both the original and retry post to the GL.
**AMACC Fix:** GL Integrity Agent checks `sourceRef` uniqueness within 5 minutes. The `GLValidationEngine.DuplicateEntryRule` flags CRITICAL. Payroll uses `idempotencyKey` with `@@unique([tenantId, idempotencyKey])`.

### Failure Mode 3: No Amount Anomaly Detection
**Legacy:** A $500,000 journal entry posts without any warning — even if the 30-day average for that account is $5,000.
**AMACC Fix:** GL Integrity Agent checks `amount > 3x 30-day average` and flags as WARN. The `AnomalousAmountRule` in `GLValidationEngine` catches this at the service level.

### Failure Mode 4: Manual Month-End Close
**Legacy:** Controller manually executes 13 steps over 3–5 days, tracking progress in a spreadsheet. If Parts Close fails silently, Service Close proceeds on stale data.
**AMACC Fix:** EOM Orchestration Agent manages the 13-step dependency graph automatically. Steps auto-advance when dependencies are met. After 3 retries, the agent escalates with a human-readable root cause.

### Failure Mode 5: No Multi-Tenant Isolation
**Legacy:** Data boundaries enforced by application-level filtering (`WHERE dealer_id = ?`). A bug in any DAO can expose one dealership's data to another.
**AMACC Fix:** Branded `TenantId` type prevents compile-time mixing. Every database table has `tenant_id` with composite indexes. API Gateway injects `x-tenant-id` on every request. Separate Prisma schemas per service.

### Failure Mode 6: No Versioned Chart of Accounts
**Legacy:** GL structure is hardcoded per DMS. Onboarding a CDK dealership to AutoMate requires manual account remapping.
**AMACC Fix:** `coa-service` provides a standard 60+ account CoA (version `2026.1`) with per-OEM FS line mappings. Legacy GL codes are mapped via `StandardLegacyGLMapper` supporting AutoMate→AMACC and CDK→AMACC bulk migration.

### Failure Mode 7: Financial Statements Locked to Desktop
**Legacy:** OEM financial statement generation requires the SWT desktop application. Remote users cannot preview or submit FS.
**AMACC Fix:** `fs-service` generates OEM-formatted FS from trial balance data. `FSPreview.tsx` renders in the browser. On-OEM formatters: `GMFSFormatter` (7 pages), `FordFSFormatter` (OWS format). Validation prevents CRITICAL errors from being submitted.

### Why Migration (COBOL to Java) Would Not Fix These

Simply rewriting COBOL in Java preserves the same architectural flaws:
- Same single-threaded EOM close with no concurrency control
- Same DAO-level data boundaries with no tenant isolation
- Same procedural transaction pipeline with no event-driven agents
- Same desktop-bound FS generation

AMACC doesn't rewrite — it **re-architects**: microservices for isolation, events for decoupling, AI agents for autonomous validation, and web UI for accessibility.

---

# SECTION 8 — KEY METRICS

| Metric | Count |
|--------|-------|
| **Total Microservices** | 19 (5 core + 7 domain + 5 agents + 2 integration) |
| **Total Docker Containers** | 22 (19 services + postgres + redis + rabbitmq) |
| **Total API Endpoints** | 65+ REST endpoints across all services |
| **AI Agents** | 5 (GL Integrity, EOM Orchestration, Payroll Integrity, AP/AR Recon, T1 Copilot) |
| **Agent Tools** | 28 total (5 + 3 + 3 + 4 + 13) |
| **Frontend Pages** | 26 React pages |
| **Database Tables** | 14 Prisma models across 8 schemas |
| **Standard GL Accounts** | 60+ in canonical CoA (version 2026.1) |
| **Domain Event Types** | 48 event types with routing map |
| **Supported OEMs** | 11 (GM, Ford, FCA, Toyota, Honda, Nissan, BMW, Mercedes, Hyundai, Kia, Other) |
| **Supported DMS Platforms** | 4 adapters (AutoMate, CDK, Reynolds, Dealertrack) |
| **FS Formatters** | 2 (GM 7-page, Ford OWS) |
| **Validation Rules** | 8 pluggable GL validation rules |
| **EOM Close Steps** | 13 sequential steps (010→310) |
| **Onboarding Steps** | 5 (DMS Config → OEM Config → COA Setup → Import History → FS Validation) |
| **User Roles** | 4 (DEALER_ACCOUNTANT, GROUP_CONTROLLER, PLATFORM_ADMIN, AGENT_APPROVER) |
| **Legacy Features Modernized** | ~83% (89 of 107 audit items fully implemented) |
| **Tenant Configurations** | 3 pre-configured (Kunes Auto Group, Premier Motors, Sunrise Dealerships) |

---

# SECTION 9 — DEMO SCRIPT

## Best 5 Screens to Show (in Order)

### Screen 1: Dashboard (1 minute)
**What to say:** *"This is the Controller Dashboard — your CFO sees this first thing every morning. Six financial KPIs across the top, operational stats below. Notice the 6-month trend chart auto-updating every 30 seconds. The pulsing 'Pending Approvals' badge means our AI agents have flagged something for review — let's go find out what."*

### Screen 2: Command Center (2 minutes)
**What to say:** *"This is the Accounting Command Center — 8 real-time KPI cards with color-coded health. Green borders mean healthy, red means attention needed. The Accounting Intelligence panel shows prioritized alerts from our AI agents."*
**Demo action:** Type in Ask Ashley: *"What's our current cash position?"*
**What to say:** *"Ashley is our AI copilot — controllers ask natural language questions instead of running reports. She queries the GL in real-time and synthesizes the answer."*

### Screen 3: AI Agents (3 minutes — THE KEY SCREEN)
**What to say:** *"Here are our 5 AI agents. Each subscribes to specific business events via RabbitMQ and acts autonomously. Let me show you the Human Required queue..."*
**Point to:** Severity badges, reasoning text, Resolve button
**What to say:** *"When the GL Integrity Agent finds a suspicious journal entry — say, a $45K entry that's 4x the 30-day average — it flags it here with WARN severity and explains WHY. The controller reviews the reasoning and either resolves it or investigates. AI does the screening; humans make the judgment call."*
**Demo action:** Click Resolve on one item → show streaming T1 Copilot chat

### Screen 4: EOM Close (2 minutes)
**What to say:** *"Month-end close — the most painful process in dealership accounting. 13 steps with dependencies. Our EOM Agent manages this automatically. Green means done, blue pulsing means running right now, red means blocked."*
**Demo action:** Click Advance → watch next step start
**What to say:** *"The agent auto-advances when dependencies are met. After 3 failed retries, it escalates with a plain-English root cause. Close went from 3–5 days to same-day."*

### Screen 5: Approvals (2 minutes)
**What to say:** *"When an agent needs human sign-off — large journal entries, EOM overrides, payroll adjustments — it submits here with evidence and reasoning. Each card shows which agent requested it, why, and the supporting evidence. 24-hour auto-expiry prevents stale approvals."*
**Demo action:** Click Approve on one item

## The Single Best "Wow Moment"

**The AI Agents page → Human Required queue.** Show a CRITICAL-severity escalation where the GL Integrity Agent caught a duplicate journal entry (same `sourceRef` within 5 minutes) and prevented it from posting. The entry would have double-booked a $42,000 vehicle sale. The reasoning text explains exactly what the agent found, why it's suspicious, and what it recommends. Click Resolve.

*"This is what $42,000 of prevented accounting error looks like — caught in milliseconds, zero human effort until this moment."*

## Three Ashley AI Copilot Prompts That Impress Most

1. **"Why is our trial balance out of balance this month?"**
   → T1 calls `get_trial_balance`, compares debits vs credits, identifies the specific unbalanced entries

2. **"What's blocking our March EOM close?"**
   → T1 calls `get_eom_steps`, identifies BLOCKED step, shows retry count and error message, suggests resolution

3. **"Show me all journal entries flagged by AI agents today"**
   → T1 calls `get_journal_entries` with `agentReviewed: true`, lists flagged entries with reasons

---

# SECTION 10 — FUTURE ROADMAP

## What Is Not Yet Built That the Architecture Supports

| Capability | Architecture Ready | Status |
|-----------|-------------------|--------|
| **Cash Receipt Posting REST API** | 50+ RPC methods in legacy Java DAO — needs REST exposure | Gap (CRITICAL) |
| **EOM Distributed Locking** | `@@unique` constraint prevents duplicates but lacks distributed lock for concurrent close attempts across replicas | Gap (CRITICAL) |
| **Transaction Search/Inquiry REST** | DAO capability exists but not exposed via `gl-service` REST endpoints | Gap (HIGH) |
| **1099 Report REST + React UI** | SWT-only; data model supports it but no web UI | Gap (HIGH) |
| **Warranty Remittance REST + React** | `apar-service` has AR/AP but no warranty-specific remittance processing endpoints | Gap (HIGH) |
| **LIFO Valuation Calculation** | Config exists in system settings; no calculation engine | Gap (MEDIUM) |
| **Sales Tax Consolidated Report** | Tax GLs exist; no aggregation report endpoint | Gap (MEDIUM) |
| **Real-time Agent Pushdowns** | WebSocket support for live agent notifications (currently polling at 15–30s intervals) | Enhancement |
| **RAG-Enhanced T1 Copilot** | T1 agent currently queries APIs; could add RAG over historical GL data for trend analysis | Enhancement |
| **Predictive EOM Blocking** | Agent could learn from historical block patterns and pre-warn before close begins | Enhancement |

## How AMACC Connects to Non-AutoMate DMS Platforms

The `connector-service` implements the **Adapter Pattern** with a registry:

```typescript
// DMS Adapter Registry (Open/Closed Principle)
adapters = {
  'AUTOMATE': new AutoMateAdapter(),   // Source: AUTOMATE_DMS
  'CDK':      new CDKAdapter(),        // Source: CONNECTOR_CDK
  'REYNOLDS': new ReynoldsAdapter(),   // Source: CONNECTOR_REYNOLDS
  'DEALERTRACK': new DealertrackAdapter(), // Source: CONNECTOR_DEALERTRACK
}
```

Each adapter implements `IDMSAdapter`:
```typescript
interface IDMSAdapter {
  normalize(rawPayload: unknown): CanonicalDealPost;
}
```

**Adding a new DMS:** Create a new adapter class, register it in the adapter map. No existing code changes required. The `CanonicalDealPost` type ensures all downstream systems (GL, agents, FS) work identically regardless of DMS source.

**GL code migration** for new DMS platforms:
- `coa-service` has `StandardLegacyGLMapper` with lookup tables per DMS:
  - `AUTOMATE_MAP`: `1000 → AMACC_GL_100`, `1100 → AMACC_GL_110`, etc.
  - `CDK_MAP`: `CASH → AMACC_GL_100`, `ARTRDE → AMACC_GL_110`, etc.
- New DMS maps are added to the same mapper

## The Standalone Product Vision

AMACC is architected as a **standalone SaaS accounting platform** that can operate independently of AutoMate:

1. **DMS-Agnostic**: Connector adapters normalize any DMS data to canonical format
2. **OEM-Agnostic**: FS formatters generate any OEM's financial statement format
3. **Multi-Tenant**: Full data isolation with per-tenant schema provisioning
4. **Self-Service Onboarding**: 5-step wizard (DMS Config → OEM Config → COA Setup → Import History → FS Validation)
5. **AI-Native**: Agents automate accounting workflows that traditionally require trained accountants
6. **Cloud-Native**: Docker + PostgreSQL + RabbitMQ + Redis — deployable to AWS/OCI/Azure

The vision: **Any dealership group, running any DMS, selling any OEM brand, can onboard to AMACC in days — not months — and have AI agents handling 100% of routine accounting from day one.**

---

*Document generated from source code analysis of `<workspace>/amacc` — 19 microservices, 26 frontend pages, 14 database tables, 5 AI agents, 48 event types, 65+ API endpoints.*
