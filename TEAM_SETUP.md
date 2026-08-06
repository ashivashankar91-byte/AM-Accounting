# AMACC — Team Setup Guide

> ⚠️ **Do NOT download a zip file from GitHub.** Zip has no Docker images and no database — the app will not run.
> ✅ **Always use `git clone` (below).** This is the only supported way to run the app.

---

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) 4.x+ — **must be running before you start**
- Git (any recent version)
- 16 GB RAM recommended (runs 45 containers)
- Free ports: **5174** (web), 5433 (postgres), 6380 (redis), 3100 (API gateway)

---

## 1. Clone the repo (Mac / Linux / Windows Git Bash)

```bash
git clone https://github.com/ashivashankar91-byte/AM-Accounting.git
cd AM-Accounting
git checkout accounting-all-159-integration
```

> **Already cloned?** Just pull the latest changes:
> ```bash
> cd AM-Accounting
> git checkout accounting-all-159-integration
> git pull origin accounting-all-159-integration
> ```
>
> Then jump to Step 2. **You must run `--build` again after a pull** to get new code into Docker.

---

## 2. Start all services

```bash
docker compose up --build -d
```

> ⚠️ **`--build` is NOT optional.** Without it, Docker uses old cached images and you will see old screens.

- First run: 5–15 minutes (downloads base images + builds 35 services)
- Subsequent runs: 2–5 minutes
- `-d` = runs in background (you get your terminal back)

**Wait for database migrations to finish before seeding:**

```bash
docker compose logs migrator -f
# Press Ctrl+C when you see: "All migrations have been successfully applied"
```

---

## 3. Load demo data

```bash
bash scripts/seed-all-159-demo.sh
```

> On **Windows**: open Git Bash (comes with Git for Windows) and run the same command.
> Or use WSL2 terminal.

This loads:
- 12 demo users
- 90 GL accounts
- 18 journal entries
- AP/AR invoices, employees, and more

---

## 4. Open the app

URL: **http://localhost:5174/amacc/**

### Login credentials

| Email | Password | Role |
|-------|----------|------|
| `solera-admin@solera.demo` | `SOLERA` | Admin |
| `solera-acct@solera.demo` | `SOLERA` | Accountant |
| `controller@kunes-demo.local` | `KunesDemo2026!` | Controller |

**Tenant ID:** `tenant-kunes` (auto-filled on login screen)

---

## 5. Verify it's working

- Dashboard should load with financial summary
- General Ledger → Journal Entries should show a list (not 500 error)
- Financial Statements should render Income Statement

---

## Troubleshooting

### ❌ "I see old screens / old UI"

This is the most common issue. Cause: Docker used a cached image.

**Fix:**
```bash
# Stop everything and rebuild from scratch
docker compose down
docker compose up --build -d
bash scripts/seed-all-159-demo.sh
```

Hard-refresh your browser: **Cmd+Shift+R** (Mac) or **Ctrl+Shift+R** (Windows).

---

### ❌ "Failed to Load — API error 500"
Postgres ran out of connections. Fixed in latest code (`max_connections=300`). Make sure you did `--build`:
```bash
docker compose down
docker compose up --build -d
```

### "API error 404" on Journal Entries
You have old code. Pull latest and rebuild:
```bash
git pull origin accounting-all-159-integration
docker compose up --build -d
```

### Migrator fails on startup
```bash
docker compose logs migrator 2>&1 | tail -20
```
If you see `column does not exist` — the DB has a stuck migration. Contact Shiva.

### Check all services are up
```bash
docker compose ps
```
All 43+ containers should show `Up` or `Up (healthy)`.

### Reset everything (clean slate)
```bash
docker compose down -v   # WARNING: deletes all data
docker compose up --build -d
echo "y" | bash scripts/seed-all-159-demo.sh
```

---

## Key ports

| Service | Port |
|---------|------|
| Web App | http://localhost:5174/amacc/ |
| API Gateway | http://localhost:3100 |
| PostgreSQL | localhost:5433 (user: `amacc`, pass: `amacc_dev`, db: `amacc`) |
| RabbitMQ UI | http://localhost:15673 (guest/guest) |
| Redis | localhost:6380 |
