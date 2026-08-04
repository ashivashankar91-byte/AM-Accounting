# ALL-159 Demo Preflight Checklist

> **Run this checklist before every stakeholder demonstration.**
>
> Automated command: `yarn demo:all-159:preflight`
>
> Target: all checks GREEN before the first stakeholder enters the room.
>
> Time required: approximately 10–15 minutes.

---

## Quick Summary

| # | Category | Checks | Status |
|---|----------|--------|--------|
| 1 | Environment | Branch, SHA, clean worktree | ☐ |
| 2 | Infrastructure | PostgreSQL, RabbitMQ, Redis, containers | ☐ |
| 3 | Services | All 38 services return HTTP 200 /health | ☐ |
| 4 | Database | Migrations applied, none pending | ☐ |
| 5 | Seed Data | Seed verification 9/9 checks pass | ☐ |
| 6 | Authentication | All demo user accounts log in successfully | ☐ |
| 7 | Frontend | http://localhost:5174 loads without error | ☐ |
| 8 | Gateway | http://localhost:3100 routes correctly | ☐ |
| 9 | Critical Data | Tenant, legal entities, journals balanced | ☐ |
| 10 | Reports | Trial balance reconciles, key reports non-empty | ☐ |

---

## Category 1 — Environment

### 1.1 Correct Branch

**What to verify:** You are on the correct integration branch.

```bash
git branch --show-current
```

**Expected result:** `main` or the designated demo branch (e.g., `release/all-159-demo`).

**Failure resolution:** `git checkout main && git pull origin main`

---

### 1.2 Commit SHA

**What to verify:** The commit SHA matches the last certified build.

```bash
git log --oneline -1
```

**Expected result:** SHA matches the entry in `docs/accounting-modernization/releases/` for the current demo version.

**Failure resolution:** Consult the release notes. If SHA differs, confirm with the tech lead before proceeding.

---

### 1.3 Clean Worktree

**What to verify:** No uncommitted or modified files that could affect demo behavior.

```bash
git status --short
```

**Expected result:** Empty output (no modified, staged, or untracked files in service directories).

**Failure resolution:** Stash or revert unintended changes: `git stash` or `git checkout -- .`

---

### 1.4 Node Version

**What to verify:** Node.js 20.x LTS is active.

```bash
node --version
```

**Expected result:** `v20.x.x`

**Failure resolution:** Switch to Node 20 using your version manager: `nvm use 20` or `fnm use 20`.

---

### 1.5 node_modules Symlink

**What to verify:** The root `node_modules` directory is a real directory, not a broken symlink.

```bash
ls -la node_modules | head -1
```

**Expected result:** A directory listing, not `node_modules -> ../some-other-path` (broken symlink from a previous worktree).

**Failure resolution:** Remove and reinstall: `rm -rf node_modules && yarn install`. See Troubleshooting § 11.

---

## Category 2 — Infrastructure

### 2.1 PostgreSQL Reachable

**What to verify:** PostgreSQL container is healthy and accepting connections on port **5433**.

```bash
docker exec am-accounting-r1-integration-postgres-1 pg_isready -U amacc
```

**Expected result:** `localhost:5432 - accepting connections` (inside the container; host port 5433 maps to this).

Also confirm from the host:
```bash
psql "postgresql://amacc:amacc_dev@localhost:5433/amacc" -c "SELECT 1;" 2>&1 | grep -c "1 row"
```

**Expected result:** `1`

**Failure resolution:** `docker compose restart postgres` then wait 15 seconds and retry.

---

### 2.2 RabbitMQ Running

**What to verify:** RabbitMQ is healthy and accepting AMQP connections.

```bash
docker exec am-accounting-r1-integration-rabbitmq-1 rabbitmq-diagnostics check_running
```

**Expected result:** `Diagnostics checks OK`

Also verify management UI:
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:15673
```

**Expected result:** `200`

**Failure resolution:** `docker compose restart rabbitmq` then wait 20 seconds.

---

### 2.3 Redis Running

**What to verify:** Redis container is healthy.

```bash
docker exec am-accounting-r1-integration-redis-1 redis-cli ping
```

**Expected result:** `PONG`

**Failure resolution:** `docker compose restart redis`

---

### 2.4 All Containers Healthy

**What to verify:** No containers are in an `exited`, `unhealthy`, or `restarting` state.

```bash
docker compose ps | grep -v "running (healthy)" | grep -v "^NAME"
```

**Expected result:** Empty output (all containers healthy).

**Failure resolution:** Identify the unhealthy container and restart it: `docker compose restart <service-name>`. Check logs: `docker compose logs --tail=50 <service-name>`.

---

## Category 3 — Services

### 3.1 All 38 Services Return HTTP 200

**What to verify:** Every application service responds to `GET /health` with HTTP 200.

```bash
FAILED=0
for port in 3001 3002 3010 3011 3012 3013 3014 3015 3016 3018 \
            3020 3021 3022 3023 3024 3030 3031 3032 3033 3035 \
            3036 3037 3038 3039 3040 3043 3045 3046 3048 3049 \
            3050 3051 3052 3056 3060 3061 3062 3090 3091 3092 \
            3093 3095 3100; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:$port/health)
  if [ "$STATUS" != "200" ]; then
    echo "FAIL :$port (HTTP $STATUS)"
    FAILED=$((FAILED+1))
  fi
done
echo "---"
[ "$FAILED" -eq 0 ] && echo "ALL SERVICES HEALTHY" || echo "$FAILED SERVICE(S) FAILING"
```

**Expected result:** `ALL SERVICES HEALTHY`

**Failure resolution:** For each failing service, check: `docker compose logs --tail=50 <service-name>`. Common issues: missing env var, port conflict, Prisma migration not applied. See Troubleshooting guide.

---

### 3.2 API Gateway Routing

**What to verify:** The API gateway routes to downstream services correctly.

```bash
curl -s http://localhost:3100/health | jq '.status'
curl -s http://localhost:3100/api/v1/tenants/health 2>/dev/null | grep -q "ok" && echo "PASS" || echo "FAIL"
```

**Expected result:** `"ok"` for gateway health; `PASS` for tenant routing.

**Failure resolution:** Check `docker compose logs api-gateway`. Verify all downstream services are healthy (Category 3.1).

---

## Category 4 — Database

### 4.1 Migrations Applied

**What to verify:** No pending migrations on any service.

```bash
bash scripts/check-migrations.sh 2>/dev/null || echo "Script not found — run manually per service"
```

If the script is unavailable, spot-check key services:
```bash
DATABASE_URL="postgresql://amacc:amacc_dev@localhost:5433/amacc" \
  npx prisma migrate status --schema=services/gl-service/prisma/schema.prisma 2>&1 | \
  grep -E "Database schema is up to date|pending"
```

**Expected result:** `Database schema is up to date` for each service.

**Failure resolution:** Run pending migrations: `bash scripts/migrate-all.sh`. See Runbook § 5.

---

### 4.2 No Schema Drift

**What to verify:** Prisma client is in sync with the database schema.

```bash
DATABASE_URL="postgresql://amacc:amacc_dev@localhost:5433/amacc" \
  npx prisma db pull --schema=services/gl-service/prisma/schema.prisma 2>&1 | grep -E "warn|error|drift"
```

**Expected result:** No drift warnings or errors.

**Failure resolution:** If drift is detected, run `prisma migrate deploy` for that service. If drift is intentional (seed-only column), document in the known limitations register.

---

## Category 5 — Seed Data

### 5.1 Seed Verification Passes (9/9)

**What to verify:** All 9 seed assertions pass without errors.

```bash
yarn seed:all-159-demo --verify
```

**Expected result:**
```
[all-159-verify] 9/9 checks passed. Environment is demo-ready.
```

**Failure resolution:** If any check fails, run `yarn seed:all-159-demo --reset` to perform a clean seed. Re-run verify. If still failing, see Troubleshooting § 3.

---

### 5.2 Individual Seed Assertions

| Check | Expected Result |
|-------|----------------|
| Tenant exists | `tenant-kunes` present in `tenant` table |
| Legal entities | 2 entities: Kunes Ford, Kunes Chevrolet |
| Demo users | 11 users, all status = ACTIVE |
| COA entries | ≥100 accounts for Ford entity |
| Journal entries | ≥10 POSTED journals |
| Payroll batches | ≥3 POSTED batches |
| Period states | LOCKED, HARD_CLOSED, IN_PROGRESS present |
| OEM statement | ≥1 GM statement record |
| Automation workflows | OBSERVE_ONLY status confirmed |

To manually query:
```bash
psql "postgresql://amacc:amacc_dev@localhost:5433/amacc" -c \
  "SELECT COUNT(*) FROM \"user\" WHERE tenant_id='tenant-kunes' AND status='ACTIVE';"
# Expected: 11
```

---

## Category 6 — Authentication

### 6.1 All Demo Users Authenticate

**What to verify:** Each demo user can obtain a JWT token from the auth service.

```bash
# Test admin login
curl -s -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@kunes-demo.local","password":"KunesDemo2026!"}' | jq '.token' | grep -q "ey" && echo "admin: PASS" || echo "admin: FAIL"

# Test controller login
curl -s -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"controller@kunes-demo.local","password":"KunesDemo2026!"}' | jq '.token' | grep -q "ey" && echo "controller: PASS" || echo "controller: FAIL"
```

Repeat for all 11 users. All should print `PASS`.

**Failure resolution:** If any user fails to authenticate, re-run `yarn seed:all-159-demo --reset` to rebuild user accounts and password hashes. See Troubleshooting § 6.

---

### 6.2 JWT Secret Consistency

**What to verify:** `AMACC_JWT_SECRET` and `JWT_SECRET` are set and non-empty in `.env`.

```bash
grep -E "^(AMACC_JWT_SECRET|JWT_SECRET)=" .env | awk -F= '{print $1": "$2 != "" ? "SET" : "EMPTY"}'
```

**Expected result:** Both variables show `SET`.

**Failure resolution:** Open `.env` and set both secrets to a consistent string (min 32 characters). Restart all services after changing.

---

## Category 7 — Frontend

### 7.1 Frontend Loads Without Error

**What to verify:** The Vite development server is running and the React app loads.

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:5174
```

**Expected result:** `200`

Also manually open in browser: `open http://localhost:5174` and confirm the login page renders without a blank screen or console errors.

**Failure resolution:** If HTTP 200 but blank screen, check browser console for JavaScript errors. Common causes: Vite alias misconfiguration for `.prisma/gl-client`. See Troubleshooting § 4.

---

### 7.2 API Proxy Works

**What to verify:** Frontend can reach the API gateway through Vite's proxy configuration.

```bash
# Simulate a proxied API call
curl -s -o /dev/null -w "%{http_code}" http://localhost:5174/api/health 2>/dev/null || \
curl -s -o /dev/null -w "%{http_code}" http://localhost:3100/health
```

**Expected result:** `200`

**Failure resolution:** Check `vite.config.ts` proxy settings — the `/api` prefix should proxy to `http://localhost:3100`. See Troubleshooting § 4.

---

## Category 8 — Gateway

### 8.1 Gateway Health

**What to verify:** API gateway is healthy.

```bash
curl -s http://localhost:3100/health | jq '.'
```

**Expected result:** JSON with `"status": "ok"`.

---

### 8.2 Gateway Routes to Auth Service

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3100/api/v1/auth/health
```

**Expected result:** `200`

**Failure resolution:** If 502/503, verify auth-service is healthy: `curl http://localhost:3001/health`. See Troubleshooting § 5.

---

### 8.3 Gateway Routes to GL Service

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3100/api/v1/gl/health
```

**Expected result:** `200`

**Failure resolution:** Verify gl-service health: `curl http://localhost:3010/health`.

---

## Category 9 — Critical Data

### 9.1 Tenant Exists

```bash
psql "postgresql://amacc:amacc_dev@localhost:5433/amacc" -t -c \
  "SELECT name FROM tenant WHERE id='tenant-kunes';" | xargs
```

**Expected result:** `Kunes Demo Automotive Group`

**Failure resolution:** Re-run seed: `yarn seed:all-159-demo --reset`.

---

### 9.2 Legal Entities Exist

```bash
psql "postgresql://amacc:amacc_dev@localhost:5433/amacc" -t -c \
  "SELECT COUNT(*) FROM legal_entity WHERE tenant_id='tenant-kunes';"
```

**Expected result:** `2`

**Failure resolution:** Re-run seed.

---

### 9.3 Journals Are Balanced

**What to verify:** All POSTED journal entries have matching debit and credit totals.

```bash
psql "postgresql://amacc:amacc_dev@localhost:5433/amacc" -t -c \
  "SELECT COUNT(*) FROM journal_entry je
   WHERE je.status='POSTED'
   AND ABS((SELECT COALESCE(SUM(amount),0) FROM journal_line WHERE journal_id=je.id AND side='DEBIT')
         - (SELECT COALESCE(SUM(amount),0) FROM journal_line WHERE journal_id=je.id AND side='CREDIT')) > 0.01;"
```

**Expected result:** `0` (no unbalanced journals)

**Failure resolution:** If non-zero, run `yarn seed:all-159-demo --reset` to restore clean journal data. See Troubleshooting § 8.

---

### 9.4 Period States Correct

```bash
psql "postgresql://amacc:amacc_dev@localhost:5433/amacc" -t -c \
  "SELECT legal_entity_id, year, month, state FROM period_close
   WHERE year=2026 ORDER BY legal_entity_id, month;"
```

**Expected result:**
```
 11111111-kune-... | 2026 | 1 | LOCKED
 11111111-kune-... | 2026 | 2 | HARD_CLOSED
 11111111-kune-... | 2026 | 3 | IN_PROGRESS
 22222222-kune-... | 2026 | 1 | LOCKED
 22222222-kune-... | 2026 | 2 | HARD_CLOSED
 22222222-kune-... | 2026 | 3 | IN_PROGRESS
```

**Failure resolution:** Re-run seed.

---

## Category 10 — Reports

### 10.1 Trial Balance Reconciles

**What to verify:** The trial balance API returns a balanced result (debit total = credit total).

```bash
TOKEN=$(curl -s -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"controller@kunes-demo.local","password":"KunesDemo2026!"}' | jq -r '.token')

curl -s "http://localhost:3100/api/v1/reports/trial-balance?entityId=11111111-kune-0000-0000-000000000001&year=2026&month=2" \
  -H "Authorization: Bearer $TOKEN" | jq '.balanced'
```

**Expected result:** `true`

**Failure resolution:** If `false`, re-run seed with `--reset`. Check journal data integrity (Category 9.3).

---

### 10.2 Payroll Report Non-Empty

```bash
TOKEN=$(curl -s -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"payroll@kunes-demo.local","password":"KunesDemo2026!"}' | jq -r '.token')

curl -s "http://localhost:3100/api/v1/payroll/batches?status=POSTED" \
  -H "Authorization: Bearer $TOKEN" | jq '. | length'
```

**Expected result:** `3` (or more)

**Failure resolution:** Re-run seed.

---

### 10.3 OEM Statement Non-Empty

```bash
curl -s "http://localhost:3100/api/v1/oem/statements" \
  -H "Authorization: Bearer $TOKEN" | jq '. | length'
```

**Expected result:** `1` or more

**Failure resolution:** Re-run seed; verify oem-service health.

---

## Automated Preflight Command

The complete preflight can be run with a single command:

```bash
yarn demo:all-159:preflight
```

This runs all 10 categories automatically and produces a pass/fail summary:

```
═══════════════════════════════════════════
  ALL-159 Demo Preflight — Kunes Demo Env
═══════════════════════════════════════════

  [1/10] Environment ................. ✓ PASS
  [2/10] Infrastructure .............. ✓ PASS
  [3/10] Services (38/38) ............ ✓ PASS
  [4/10] Database migrations ......... ✓ PASS
  [5/10] Seed data (9/9) ............. ✓ PASS
  [6/10] Authentication .............. ✓ PASS
  [7/10] Frontend .................... ✓ PASS
  [8/10] Gateway ..................... ✓ PASS
  [9/10] Critical data ............... ✓ PASS
  [10/10] Reports .................... ✓ PASS

═══════════════════════════════════════════
  RESULT: 10/10 PASS — Environment is demo-ready.
═══════════════════════════════════════════
```

If any category fails, the output includes the specific failed check and the resolution command.

---

## Sign-off

Before the demo begins, the operator should confirm all categories are GREEN and sign the preflight log:

```
Date: ___________________
Operator: ___________________
Preflight result: _____ / 10 categories PASS
Seed SHA: (output of: git log --oneline -1)
Notes: ___________________
```

---

*Last updated: 2026-08-04 | ALL-159 stakeholder demonstration*
