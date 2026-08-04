# ALL-159 Demo Runbook — Kunes Demo Automotive Group

> **Audience:** Engineers, QA, and demo operators setting up and running the
> ALL-159 stakeholder demonstration environment.
>
> **Data notice:** All tenant, financial, employee, and vehicle data is
> fully synthetic. No real customer, dealer, employee, payroll, banking, or
> OEM data is used.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Environment Variables](#2-environment-variables)
3. [Infrastructure Startup](#3-infrastructure-startup)
4. [Service Stack Startup](#4-service-stack-startup)
5. [Database Migrations](#5-database-migrations)
6. [Seed Commands](#6-seed-commands)
7. [Service Health Endpoints](#7-service-health-endpoints)
8. [Demo Users](#8-demo-users)
9. [Access URLs](#9-access-urls)
10. [Shutdown Procedures](#10-shutdown-procedures)
11. [Log Locations](#11-log-locations)
12. [Common Restart Procedures](#12-common-restart-procedures)

---

## 1. Prerequisites

Ensure the following tools are installed and at the required versions **before** starting the environment.

| Tool | Required Version | Check Command |
|------|-----------------|---------------|
| Docker Desktop | 24+ | `docker --version` |
| Docker Compose | 2.20+ (plugin) | `docker compose version` |
| Node.js | 20.x LTS | `node --version` |
| npm | 10.x (bundled with Node 20) | `npm --version` |
| PostgreSQL client | 15+ (psql) | `psql --version` |
| Git | 2.40+ | `git --version` |

> **Apple Silicon (M1/M2/M3):** Ensure Docker Desktop Rosetta emulation is enabled for images that lack ARM64 variants.

### Port Availability

The following host ports must be free before startup:

| Port | Service |
|------|---------|
| 5433 | PostgreSQL |
| 5673 | RabbitMQ AMQP |
| 6380 | Redis |
| 3100 | API Gateway |
| 5174 | Web frontend |
| 3001–3095 | Microservices (range) |

Check for conflicts:

```bash
# Verify no process is using critical ports
lsof -iTCP:5433 -sTCP:LISTEN
lsof -iTCP:3100 -sTCP:LISTEN
lsof -iTCP:5174 -sTCP:LISTEN
```

---

## 2. Environment Variables

> **Note:** This repository does not currently ship a `.env.example` template.
> Create `.env` at the repository root manually with the variables below.

```bash
touch .env
```

Required variables (must be non-empty before startup — `docker-compose.yml` will
fail fast with a `variable is required` error if `AMACC_JWT_SECRET`, `JWT_SECRET`,
or `ADMIN_API_KEY` are unset):

```dotenv
# JWT — must match across all services
AMACC_JWT_SECRET=<your-local-dev-secret-min-32-chars>
JWT_SECRET=<your-local-dev-secret-min-32-chars>

# Internal service token
AMACC_INTERNAL_TOKEN=amacc-internal-dev

# Admin API key (used by seed scripts)
ADMIN_API_KEY=<your-local-admin-api-key>

# Database (set automatically by docker-compose; override only if using external PG)
DATABASE_URL=postgresql://amacc_app:amacc_app_dev@localhost:5433/amacc

# RabbitMQ
RABBITMQ_URL=amqp://guest:guest@localhost:5673

# AI agent (optional — set to placeholder if not using AI features)
ANTHROPIC_API_KEY=sk-ant-placeholder
```

> **Security:** Never commit `.env` to source control. The `.gitignore` already excludes it.

---

## 3. Infrastructure Startup

Start only the infrastructure dependencies first and wait for healthy status:

```bash
# Start PostgreSQL, Redis, and RabbitMQ
docker compose up -d postgres redis rabbitmq

# Wait until all three are healthy (poll every 5 s for up to 60 s)
docker compose ps | grep -E 'postgres|redis|rabbitmq'
```

Expected output — all three containers should show `healthy`:

```
NAME                                              STATUS
am-accounting-all-159-integration-postgres-1     running (healthy)
am-accounting-all-159-integration-redis-1        running (healthy)
am-accounting-all-159-integration-rabbitmq-1     running (healthy)
```

> **Container name prefix:** Compose derives the project name from the
> repository directory name (no `name:` override is set in `docker-compose.yml`).
> If you checked this repo out under a different folder name, substitute your
> own prefix — check with `docker compose ps`.

### Infrastructure Health Checks

```bash
# PostgreSQL
docker exec am-accounting-all-159-integration-postgres-1 pg_isready -U amacc

# Redis
docker exec am-accounting-all-159-integration-redis-1 redis-cli ping
# Expected: PONG

# RabbitMQ
docker exec am-accounting-all-159-integration-rabbitmq-1 rabbitmq-diagnostics check_running
# Expected: Diagnostics checks OK
```

---

## 4. Service Stack Startup

After infrastructure is healthy, start the full application stack:

```bash
# Start all services
docker compose up -d

# Watch logs for startup errors (Ctrl+C to stop tailing)
docker compose logs -f --tail=50
```

Wait approximately **60–90 seconds** for all services to initialize. Then verify overall health:

```bash
# Only postgres/redis/rabbitmq define a Docker HEALTHCHECK in docker-compose.yml
# — the 43 application services have no HEALTHCHECK instruction, so they will
# show as "running" (not "running (healthy)"), even once ready. Use this to
# confirm the infra tier plus overall container count instead:
docker compose ps | grep -c "running (healthy)"
# Expected: 3 (postgres, redis, rabbitmq)

docker compose ps --status running | wc -l
# Expected: ~45 (43 app services + web + api-gateway; migrator exits after completion)

# Show any exited/restarting containers
docker compose ps | grep -vE "running|Up"
```

Use the [bulk health-endpoint check](#7-service-health-endpoints) in Section 7
for authoritative per-service readiness — it is the only reliable signal since
application containers have no Docker-level healthcheck.

### Targeted Service Startup (Subset)

For faster iteration during development, start only the services needed for a specific module:

```bash
# GL + EOM + Approval only
docker compose up -d postgres redis rabbitmq gl-service eom-service approval-service api-gateway web

# AP/AR only
docker compose up -d postgres redis rabbitmq apar-service approval-service coa-service api-gateway web
```

---

## 5. Database Migrations

### Run All Migrations (Recommended)

The `migrator` service runs all pending Prisma migrations automatically on startup. Check its exit code:

```bash
docker compose logs migrator | tail -20
# Expected final line: "All migrations applied successfully."
```

To run manually (if migrator container has already exited):

```bash
bash scripts/migrate-all.sh
```

### Per-Service Migrations

Each service uses its own Prisma schema, scoped under the `@amacc/*` npm
workspace name (see each service's `package.json`). The list below matches
[scripts/migrate-all.sh](../../scripts/migrate-all.sh) — only services with a
`prisma/migrations/` directory are included; services with just a
`prisma/schema.prisma` (no migration history) or no `prisma/` at all are
omitted since `prisma migrate deploy` has nothing to apply for them.

To migrate a single service:

```bash
# Format: npm run --workspace=services/<service-name> -- prisma migrate deploy
npx prisma migrate deploy --schema=services/tenant-service/prisma/schema.prisma
npx prisma migrate deploy --schema=services/auth-service/prisma/schema.prisma
npx prisma migrate deploy --schema=services/coa-service/prisma/schema.prisma
npx prisma migrate deploy --schema=services/posting-recovery-service/prisma/schema.prisma
npx prisma migrate deploy --schema=services/tax-service/prisma/schema.prisma
npx prisma migrate deploy --schema=services/audit-service/prisma/schema.prisma
npx prisma migrate deploy --schema=services/gl-service/prisma/schema.prisma
npx prisma migrate deploy --schema=services/apar-service/prisma/schema.prisma
npx prisma migrate deploy --schema=services/cash-service/prisma/schema.prisma
npx prisma migrate deploy --schema=services/schedule-service/prisma/schema.prisma
npx prisma migrate deploy --schema=services/vehicle-accounting-service/prisma/schema.prisma
npx prisma migrate deploy --schema=services/floorplan-service/prisma/schema.prisma
npx prisma migrate deploy --schema=services/deal-accounting-service/prisma/schema.prisma
npx prisma migrate deploy --schema=services/fni-reserve-service/prisma/schema.prisma
npx prisma migrate deploy --schema=services/eom-service/prisma/schema.prisma
npx prisma migrate deploy --schema=services/payroll-service/prisma/schema.prisma
npx prisma migrate deploy --schema=services/fs-service/prisma/schema.prisma
npx prisma migrate deploy --schema=services/recon-service/prisma/schema.prisma
npx prisma migrate deploy --schema=services/cashflow-service/prisma/schema.prisma
npx prisma migrate deploy --schema=services/fixedops-service/prisma/schema.prisma
npx prisma migrate deploy --schema=services/parts-accounting-service/prisma/schema.prisma
npx prisma migrate deploy --schema=services/oem-service/prisma/schema.prisma
npx prisma migrate deploy --schema=services/close-service/prisma/schema.prisma
npx prisma migrate deploy --schema=services/migration-service/prisma/schema.prisma
npx prisma migrate deploy --schema=services/automation-service/prisma/schema.prisma
npx prisma migrate deploy --schema=services/approval-service/prisma/schema.prisma
```

> `user-service`, `compliance-service`, `group-service`, `analytics-service`,
> `document-service`, `query-service`, `webhook-service`, and
> `orchestrator-service` have a `prisma/schema.prisma` but no migration
> history — they are provisioned via `prisma db push`, not `migrate deploy`.
> `onboarding-service`, `notification-service`, and `connector-service` have
> no Prisma schema at all.

### Verify Migration Status

```bash
# Check pending migrations for a specific service
npx prisma migrate status --schema=services/gl-service/prisma/schema.prisma

# Check several services at once (no scripts/check-migrations.sh exists in this repo)
for svc in gl-service eom-service payroll-service apar-service; do
    echo "=== $svc ===" && \
    DATABASE_URL="postgresql://amacc:amacc_dev@localhost:5433/amacc" \
    npx prisma migrate status --schema=services/$svc/prisma/schema.prisma
  done
```

---

## 6. Seed Commands

All seed commands must be run from the **repository root** with the full service stack running.

> **Important:** The seed scripts connect to PostgreSQL on **port 5433** using the `amacc` superuser. They will fail if pointed at the default port 5432.

### Primary Commands

```bash
# ─────────────────────────────────────────────────────────────────────
# DESTRUCTIVE RESET — drops all demo tenant data and re-seeds from scratch
# Use before a demo to ensure a clean, consistent state
# ─────────────────────────────────────────────────────────────────────
npm run seed:all-159-demo:reset

# ─────────────────────────────────────────────────────────────────────
# IDEMPOTENT SEED — safe to run multiple times without data duplication
# Use to refresh data if something was accidentally modified mid-demo
# ─────────────────────────────────────────────────────────────────────
npm run seed:all-159-demo

# ─────────────────────────────────────────────────────────────────────
# VERIFY ONLY — does not modify data; checks all seed assertions pass
# Run as part of preflight to confirm environment is ready
# ─────────────────────────────────────────────────────────────────────
npm run seed:all-159-demo:verify
```

> These map to dedicated `package.json` scripts (`seed:all-159-demo:reset`,
> `seed:all-159-demo`, `seed:all-159-demo:verify`) — there is no single script
> that accepts a `--reset`/`--verify` flag.

### What the Seed Creates

A successful run creates:

| Category | Count | Details |
|----------|-------|---------|
| Tenant | 1 | Kunes Demo Automotive Group (`tenant-kunes`) |
| Legal Entities | 2 | Kunes Ford (`LE_FORD_ID`), Kunes Chevrolet (`LE_CHEV_ID`) |
| Demo Users | 11 | See [Demo Users](#8-demo-users) |
| Chart of Accounts | ~120 | Full automotive COA, 4-digit codes |
| Journal Entries | 14+ | Mix of POSTED, DRAFT, PENDING_APPROVAL |
| Payroll Batches | 4 | 3 POSTED, 1 VOIDED |
| Period Close Status | 6 | Jan LOCKED, Feb HARD_CLOSED, Mar IN_PROGRESS (×2 entities) |
| OEM Statement | 1 | GM Q1 incentive credit |
| Bank Accounts | 2 | One per legal entity |
| Repair Orders | 3 | Customer Pay, Warranty, Body Shop |
| Parts Transactions | 5+ | Purchase, receipt, returns |
| Vehicle Deals | 2 | New Ford F-150, New Silverado |
| Migration Records | 1 | CDK DMS source system registered |
| Automation Workflows | 2 | OBSERVE_ONLY GL automation |

### Seed Verification Output

A passing `--verify` run prints:

```
[all-159-verify] Running 9 verification checks...
  ✓  Tenant exists (tenant-kunes)
  ✓  Legal entities: 2 found
  ✓  Demo users: 11 found, all ACTIVE
  ✓  COA entries: ≥100 accounts in FORD entity
  ✓  Journal entries: ≥10 POSTED
  ✓  Payroll batches: ≥3 POSTED
  ✓  Period states: LOCKED / HARD_CLOSED / IN_PROGRESS present
  ✓  OEM statement: ≥1 record
  ✓  Automation workflows: OBSERVE_ONLY status confirmed
[all-159-verify] 9/9 checks passed. Environment is demo-ready.
```

### Alternative Shell-Script Seed

```bash
./scripts/seed-r1-demo.sh            # idempotent
./scripts/seed-r1-demo.sh --reset    # destructive
./scripts/seed-r1-demo.sh --verify   # verify only
./scripts/seed-r1-demo.sh --migrate  # migrate then seed
```

---

## 7. Service Health Endpoints

All 38 application services expose `GET /health → 200 OK`. The infrastructure containers use native health checks.

### Infrastructure

| Container | Host Connection | Health Check |
|-----------|----------------|--------------|
| postgres | localhost:5433 | `pg_isready -U amacc` |
| redis | localhost:6380 | `redis-cli ping` |
| rabbitmq | localhost:5673 (AMQP), localhost:15673 (UI) | `rabbitmq-diagnostics check_running` |

### Application Services

| # | Service Name | Port | Health URL |
|---|-------------|------|-----------|
| 1 | auth-service | 3001 | http://localhost:3001/health |
| 2 | tenant-service | 3002 | http://localhost:3002/health |
| 3 | gl-service | 3010 | http://localhost:3010/health |
| 4 | eom-service | 3011 | http://localhost:3011/health |
| 5 | payroll-service | 3012 | http://localhost:3012/health |
| 6 | apar-service | 3013 | http://localhost:3013/health |
| 7 | recon-service | 3014 | http://localhost:3014/health |
| 8 | fs-service | 3015 | http://localhost:3015/health |
| 9 | coa-service | 3016 | http://localhost:3016/health |
| 10 | schedule-service | 3018 | http://localhost:3018/health |
| 11 | agent-gl | 3020 | http://localhost:3020/health |
| 12 | agent-eom | 3021 | http://localhost:3021/health |
| 13 | agent-payroll | 3022 | http://localhost:3022/health |
| 14 | agent-apar | 3023 | http://localhost:3023/health |
| 15 | agent-t1 | 3024 | http://localhost:3024/health |
| 16 | notification-service | 3030 | http://localhost:3030/health |
| 17 | audit-service | 3031 | http://localhost:3031/health |
| 18 | connector-service | 3032 | http://localhost:3032/health |
| 19 | approval-service | 3033 | http://localhost:3033/health |
| 20 | onboarding-service | 3035 | http://localhost:3035/health |
| 21 | webhook-service | 3036 | http://localhost:3036/health |
| 22 | cashflow-service | 3037 | http://localhost:3037/health |
| 23 | document-service | 3038 | http://localhost:3038/health |
| 24 | group-service | 3039 | http://localhost:3039/health |
| 25 | user-service | 3040 | http://localhost:3040/health |
| 26 | compliance-service | 3043 | http://localhost:3043/health |
| 27 | query-service | 3045 | http://localhost:3045/health |
| 28 | analytics-service | 3046 | http://localhost:3046/health |
| 29 | orchestrator-service | 3048 | http://localhost:3048/health |
| 30 | posting-recovery-service | 3049 | http://localhost:3049/health |
| 31 | cash-service | 3050 | http://localhost:3050/health |
| 32 | tax-service | 3051 | http://localhost:3051/health |
| 33 | oem-service | 3052 | http://localhost:3052/health |
| 34 | automation-service | 3056 | http://localhost:3056/health |
| 35 | fixedops-service | 3060 | http://localhost:3060/health |
| 36 | parts-accounting-service | 3061 | http://localhost:3061/health |
| 37 | migration-service | 3062 | http://localhost:3062/health |
| 38 | vehicle-accounting-service | 3090 | http://localhost:3090/health |
| 39 | floorplan-service | 3091 | http://localhost:3091/health |
| 40 | deal-accounting-service | 3092 | http://localhost:3092/health |
| 41 | fni-reserve-service | 3093 | http://localhost:3093/health |
| 42 | close-service | 3095 | http://localhost:3095/health |
| 43 | api-gateway | 3100 | http://localhost:3100/health |

### Bulk Health Check

```bash
# Check all services — prints PASS/FAIL per service
for port in 3001 3002 3010 3011 3012 3013 3014 3015 3016 3018 \
            3020 3021 3022 3023 3024 3030 3031 3032 3033 3035 \
            3036 3037 3038 3039 3040 3043 3045 3046 3048 3049 \
            3050 3051 3052 3056 3060 3061 3062 3090 3091 3092 \
            3093 3095 3100; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:$port/health)
  [ "$STATUS" = "200" ] && echo "✓ :$port" || echo "✗ :$port (HTTP $STATUS)"
done
```

---

## 8. Demo Users

All demo accounts are scoped to the `tenant-kunes` tenant. Password applies to all accounts.

> **Demo password:** `KunesDemo2026!`
>
> ⚠️ For local prototype use only. Not production credentials.

| Display Name | Email | Role | Capabilities |
|-------------|-------|------|-------------|
| Alex Admin | `admin@kunes-demo.local` | Administrator | Full system access, tenant config, user management |
| Carol Controller | `controller@kunes-demo.local` | Controller | Period close, financial statements, approvals |
| Ann Accountant | `accountant@kunes-demo.local` | Accountant | Journal entry, COA, reconciliation |
| Andrew Approver | `approver@kunes-demo.local` | Approver | Approve journals, payroll, AP invoices |
| Aria Auditor | `auditor@kunes-demo.local` | Auditor | Read-only; SOX evidence, audit trail |
| Pete AP | `ap.clerk@kunes-demo.local` | AP Clerk | Vendor invoices, payments, PO matching |
| Rachel AR | `ar.clerk@kunes-demo.local` | AR Clerk | Receipts, unapplied cash, NSF, write-offs |
| Casey Cashier | `cashier@kunes-demo.local` | Cashier | Bank recon, cash import, deposits |
| Pat Payroll | `payroll@kunes-demo.local` | Payroll Manager | Payroll batch, validate, post |
| Sam Service | `service.mgr@kunes-demo.local` | Service Manager | Repair orders, warranty, parts |
| Bob (HR provisioned) | `bob@kunes-demo.local` | (S005 demo) | HR provisioning demonstration only |

### Legal Entities / Rooftops

| Rooftop | ID | OEM Brand | CDK Store Code |
|---------|-----|-----------|---------------|
| Kunes Ford | `11111111-kune-0000-0000-000000000001` | Ford | CDK-001-FORD |
| Kunes Chevrolet | `22222222-kune-0000-0000-000000000002` | GM/Chevrolet | CDK-002-CHEV |

---

## 9. Access URLs

| System | URL | Notes |
|--------|-----|-------|
| Web Frontend | http://localhost:5174 | Vite dev server; proxies API calls to gateway |
| API Gateway | http://localhost:3100 | All client API traffic routes here |
| PostgreSQL | localhost:5433 | Container: `am-accounting-all-159-integration-postgres-1` (prefix depends on checkout folder name) |
| RabbitMQ Management UI | http://localhost:15673 | guest / guest |
| Redis | localhost:6380 | No auth in dev |

---

## 10. Shutdown Procedures

### Graceful Shutdown (preserves data)

```bash
# Stop all containers; data volumes are preserved
docker compose down
```

### Full Teardown (destroys data)

```bash
# Stop containers AND remove volumes — data will be lost
docker compose down -v
```

### Stop a Single Service

```bash
docker compose stop gl-service
docker compose start gl-service
```

---

## 11. Log Locations

### Docker Container Logs

```bash
# Tail all service logs
docker compose logs -f

# Tail a specific service
docker compose logs -f gl-service

# Last 200 lines for a service
docker compose logs --tail=200 api-gateway

# All logs since a time (ISO format)
docker compose logs --since="2026-08-04T10:00:00" automation-service
```

### Application Log Files

Services that write structured JSON logs to disk:

```
logs/
  gl-service/         # General Ledger logs
  payroll-service/    # Payroll processing
  audit-service/      # Audit events
  compliance-service/ # Compliance events, MFA attempts
  migration-service/  # Migration run logs
```

### Seed Script Logs

```bash
# Redirect seed output for review
npm run seed:all-159-demo:reset 2>&1 | tee seed-output.log
```

---

## 12. Common Restart Procedures

### Restart a Crashed Service

```bash
# Restart one service, waiting for health
docker compose restart gl-service
sleep 5
curl -s http://localhost:3010/health | jq '.status'
# Expected: "ok"
```

### Restart All Services (Keep Infrastructure)

```bash
# Stops and restarts all app services without touching postgres/redis/rabbitmq
docker compose stop $(docker compose ps --services | grep -v -E "^postgres$|^redis$|^rabbitmq$")
docker compose start $(docker compose ps --services | grep -v -E "^postgres$|^redis$|^rabbitmq$")
```

### Re-run Migrations After Code Change

```bash
# Run migrator container as a one-off job
docker compose run --rm migrator
```

### Hard Reset for a Clean Demo Slot

```bash
# Full environment reset — use before a fresh stakeholder demo
docker compose down -v
docker compose up -d postgres redis rabbitmq
# Wait 15 s for infra health
sleep 15
docker compose up -d
# Wait 60 s for all services
sleep 60
npm run seed:all-159-demo:reset
npm run seed:all-159-demo:verify
echo "Environment is demo-ready."
```

### Recover from OOM / Port Conflict

```bash
# Find and kill process on a conflicting port (example: 5433)
lsof -ti:5433 | xargs kill -9 2>/dev/null || true
docker compose up -d postgres
```

---

*Last updated: 2026-08-04 | ALL-159 stakeholder demonstration*
