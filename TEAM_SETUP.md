# AMACC — Team Setup Guide

> **Do NOT use a zip file.** Always clone from Git to get the latest fixes.

---

## Prerequisites

- Docker Desktop 4.x+ (running)
- Git
- 16 GB RAM recommended (45 containers)
- Ports free: 5174 (web), 5433 (postgres), 6380 (redis), 3100 (API gateway), 15673 (RabbitMQ UI)

---

## 1. Clone the repo

```bash
git clone https://github.com/ashivashankar91-byte/AM-Accounting.git
cd AM-Accounting
git checkout accounting-all-159-integration
```

> If you already have it cloned, pull the latest:
> ```bash
> git pull origin accounting-all-159-integration
> ```

---

## 2. Start all services

```bash
docker compose up --build -d
```

- `--build` rebuilds images from source (required on first run or after code changes)
- `-d` runs in background
- Takes 5–10 minutes first time (downloads base images, builds 35+ services)

Wait for the migrator to finish:
```bash
docker compose logs migrator -f
# Wait until you see: "All migrations have been successfully applied"
# Press Ctrl+C to exit
```

---

## 3. Load demo data

```bash
echo "y" | bash scripts/seed-all-159-demo.sh
```

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

### "Failed to Load — API error 500"
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
