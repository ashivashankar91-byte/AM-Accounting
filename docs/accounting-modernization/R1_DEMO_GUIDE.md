# Accounting R1 — Demo Guide

**Kunes Demo Automotive Group — Prototype Demo Experience**

> This guide covers the complete R1 demo-data experience. All data is
> synthetic. No real customer, dealer, employee, payroll, banking or OEM
> data is used or required.

---

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 18 or 20 |
| Docker + Docker Compose | 24+ |
| PostgreSQL | Running via docker-compose on port 5433 |

---

## Quick Start

```bash
# 1. Start infrastructure (Postgres, Redis, RabbitMQ)
docker compose up -d postgres redis rabbitmq

# 2. Start all services
docker compose up -d

# 3. Seed demo data
yarn seed:r1-demo

# 4. Open the app
open http://localhost:5174
```

---

## Commands

### Seed Demo Data

```bash
# Seed only (idempotent — safe to run repeatedly)
yarn seed:r1-demo

# Reset demo tenant data and re-seed (local database only)
yarn seed:r1-demo --reset

# Verify seeded data without modifying anything
yarn seed:r1-demo --verify
```

Or with the shell script directly:

```bash
./scripts/seed-r1-demo.sh
./scripts/seed-r1-demo.sh --reset
./scripts/seed-r1-demo.sh --verify
./scripts/seed-r1-demo.sh --migrate   # run service migrations then seed
```

### Run Migrations

```bash
bash scripts/migrate-all.sh
```

### Verify Demo Data

```bash
npx tsx scripts/verify-r1-demo.ts
# Machine-readable output:
npx tsx scripts/verify-r1-demo.ts --json
```

### Run Demo Playwright Suite

```bash
# Start app first (must be running at http://localhost:5174)
# Optionally start API gateway at http://localhost:3100
BASE_URL=http://localhost:5174 API_BASE=http://localhost:3100 \
  npx playwright test tests/e2e/r1-demo-journey.spec.ts
```

---

## Login

| URL | `http://localhost:5174` |
|---|---|
| Login path | `/login` |
| Tenant ID | `tenant-kunes` |

---

## Demo Users and Roles

All demo users share the same password: **`KunesDemo2026!`**

> ⚠️ This password is for local prototype demonstration only. Never used in
> production. Never committed as a real secret — the password appears here
> solely to enable demo walkthroughs.

| Role | Email | Description |
|---|---|---|
| System Administrator | `admin@kunes-demo.local` | Full access, user management |
| Group Controller | `controller@kunes-demo.local` | Financial oversight, all accounting |
| Accountant | `accountant@kunes-demo.local` | GL entries, journal review |
| AP Clerk | `ap.clerk@kunes-demo.local` | Accounts payable, vendor invoices |
| AR Clerk | `ar.clerk@kunes-demo.local` | Accounts receivable, customer cash |
| Cashier | `cashier@kunes-demo.local` | Cash receipts, drawer management |
| Payroll Manager | `payroll@kunes-demo.local` | Payroll batches, employee pay |
| Service Manager | `service.mgr@kunes-demo.local` | Fixed ops, repair orders |
| Approver | `approver@kunes-demo.local` | Approval workflows (SoD pair) |
| Read-only Auditor | `auditor@kunes-demo.local` | View-only, audit reports |

> **SoD note**: Accountant (`accountant@kunes-demo.local`) prepares;
> Approver (`approver@kunes-demo.local`) approves. These are distinct users
> for every workflow requiring Separation of Duties.

---

## Demo Organization

**Tenant**: Kunes Demo Automotive Group (`tenant-kunes`)

**Legal Entities (Rooftops):**

| Entity | Code | State | ID |
|---|---|---|---|
| Kunes Ford Madison | `KUNES-FORD-MAD` | WI | `11111111-kune-0000-0000-000000000001` |
| Kunes Chevrolet Milwaukee | `KUNES-CHEV-MKE` | WI | `22222222-kune-0000-0000-000000000002` |
| Kunes Toyota Green Bay | `KUNES-TOY-GB` | WI | `33333333-kune-0000-0000-000000000003` |

**Fiscal Year**: 2026  
**Current period**: March 2026 (OPEN)  
**Prior periods**: January–February 2026 (CLOSED)

---

## Demo Story Walkthrough

### 1. Logging In

1. Open `http://localhost:5174`
2. Enter Tenant ID: `tenant-kunes`
3. Enter Email: `controller@kunes-demo.local`
4. Enter Password: `KunesDemo2026!`
5. Select entity: **Kunes Ford Madison**

### 2. Chart of Accounts

Navigate to **Golden Path → Chart of Accounts** or `/golden-path/coa`

- Demonstrates the full automotive NADA-style chart (70+ accounts)
- Shows account hierarchy: Assets → Liabilities → Equity → Revenue → COS → Expense
- Account types: Vehicle inventory, AR trade/factory, AP trade, payroll accruals

### 3. Journal Entries

Navigate to **Golden Path → Journal Workflow** or `/golden-path/journal`

- Shows March 2026 POSTED entries (vehicle sales, service ROs, payroll, F&I)
- Shows DRAFT entries pending approval (warranty claim, used vehicle purchase)
- Shows a REVERSAL example (duplicate payroll detection)
- Complete workflow: DRAFT → PENDING_REVIEW → Agent Review → POSTED

### 4. Trial Balance

Navigate to **Golden Path → Trial Balance** or `/golden-path/trial-balance`

- Displays account balances for the selected entity and period
- Debits equal credits across all posted entries
- Prior-period comparative column available

### 5. Balance Sheet / Income Statement

- `/golden-path/balance-sheet` — Assets, Liabilities, Equity
- `/golden-path/income-statement` — Revenue, COS, Expenses, Net Income

### 6. AP Workflow

Navigate to **Accounts Payable** from the navigation menu

**Demo entries by status:**
- `AP-8801` – `AP-8803`: Current — open, due within 30 days
- `AP-8790` – `AP-8775`: 30–60 days overdue
- `AP-8760` – `AP-8740`: 60–90+ days overdue (aging alert)
- `AP-8830`: Approved — pending payment run
- `AP-8831`: Paid (check issued)
- `AP-8832`: Disputed — hold flag set

**AP Approval workflow (SoD)**:
1. AP Clerk (`ap.clerk@kunes-demo.local`) submits invoice
2. Approver (`approver@kunes-demo.local`) approves
3. Controller (`controller@kunes-demo.local`) releases payment

### 7. AR and Cash

Navigate to **Cash Receipts** or **AR Receivables**

**Demo entries by type:**
- `INV-4521`, `INV-4522`: Current trade receivables
- `WC-3301`, `WC-3290`: Warranty claims (OEM)
- `INV-4498`, `INV-4472`, `INV-4401`: Aged receivables (30/60/90 days)
- `NSF-101`: NSF check returned — demonstrates NSF workflow
- `INV-4600`: Unapplied cash — awaiting manual application

### 8. Bank Reconciliation

Navigate to **Bank Reconciliation**

**Demo sessions:**
- `Operating Checking – First Business Bank`: OPEN, $1,250 variance (outstanding checks)
- `Payroll Account – Wells Fargo`: RECONCILED, zero variance
- `Savings Reserve – US Bank`: RECONCILED, zero variance
- `Parts Flooring – Floorplan Corp`: OPEN, $125 variance

### 9. Payroll

Navigate to **Payroll**

**Demo batches:**
- `PR-2026-02-W4`: POSTED — February W4 (posted & paid)
- `PR-2026-03-W1`: POSTED — March W1
- `PR-2026-03-W2`: POSTED — March W2
- `PR-2026-03-W3`: VALIDATED — awaiting approval (SoD: Payroll Mgr prepares, Approver approves)
- `PR-2026-03-CHEV`: DRAFT — Chevrolet entity batch in progress
- `PR-2026-02-W3-REV`: VOIDED — reversal example (duplicate submission)

**Employees**: 10 synthetic employees across all three rooftops

### 10. OEM Accounting

Navigate to **Accounting → OEM → Profiles** (`/accounting/oem/profiles`)

> **Important**: All OEM data operates in `DEMO_FIXTURE` mode.  
> No real OEM connections exist. No simulated OEM acknowledgements are
> presented as real external responses.

**Demo OEM profiles:**
- Ford Motor Credit Statement (profile for Kunes Ford Madison)
- GM Financial Statement (profile for Kunes Chevrolet Milwaukee)
- Toyota Financial Services (profile for Kunes Toyota Green Bay)

**OEM incentives:**
- Ford Fast Lane Bonus Q1 2026 — PENDING
- GM Dealer Growth Incentive Q1 — CONFIRMED
- Toyota National Dealer Award — DISPUTED

### 11. Close

Navigate to **EOM Close** (`/eom/close`)

**March 2026 close state**: IN_PROGRESS  
Steps completed: Pre-Close, Open Items, Parts Close, Parts Reconciliation  
Steps in progress: Service Close (step 068)  
Steps pending: Body Shop, Variable Ops, Fixed Ops, Master Close, FS Generation, FS Submission

**Prior periods:**
- January 2026: LOCKED (Kunes Ford Madison, Kunes Chevrolet Milwaukee)
- February 2026: HARD_CLOSED (Kunes Ford Madison, Kunes Chevrolet Milwaukee); SOFT_CLOSED (Kunes Toyota Green Bay)

### 12. Migration

Navigate to **Migration** (close-service migration screens)

**Demo sources registered:**
- `CDK-LEGACY-KFM` — CDK Legacy, Kunes Ford Madison
- `CDK-LEGACY-KCM` — CDK Legacy, Kunes Chevrolet Milwaukee

### 13. Automation

Navigate to **Automation** or Command Center

**All capabilities in R1 safe mode:**

| Capability | Mode |
|---|---|
| Journal Balance Validation | OBSERVE_ONLY |
| Period Auto-Lock | OBSERVE_ONLY |
| Vendor Duplicate Detection | OBSERVE_ONLY |
| Payroll Pre-Validation | OBSERVE_ONLY |
| Bank Reconciliation Auto-Match | APPROVAL_REQUIRED |
| OEM Statement Auto-Matching | APPROVAL_REQUIRED |
| Close Checklist Automation | OBSERVE_ONLY |

No capability executes without explicit human approval in R1.

---

## Reset Procedure

```bash
# Wipe only the demo tenant data (tenant-kunes) and re-seed
# Only works against localhost databases
yarn seed:r1-demo --reset
```

The `--reset` flag:
1. Deletes all rows for `tenant-kunes` from demo tables
2. Refuses to run against non-localhost database targets
3. Re-seeds fresh data immediately after reset

---

## Fixture-Mode Explanation

OEM integration profiles are seeded with `connection_status = 'DEMO_FIXTURE'` and
notes containing the string `DEMO_FIXTURE:`. This explicitly labels all simulated
external OEM interactions. No OEM portal, real factory API, or external
acknowledgement is contacted or simulated as real in this prototype.

---

## R2–R7 Deferred Capabilities

The following features are deferred to R2 and later. In the R1 prototype UI:
- Hidden controls: feature flags disable them in production builds
- Where controls are visible, they display a clearly labelled **"Available in R2"**
  or **"Future Release"** explanation when clicked

Deferred (not implemented in R1):
- 112 PACKAGE_AUTHORIZED_DEFERRED stories
- Full OEM live connection and acknowledgement
- Multi-currency translation runs (seed only provides USD)
- LIFO/FIFO vehicle costing engine full execution
- Payroll direct deposit integration
- Advanced AI recommendation approvals beyond OBSERVE_ONLY
- Full statutory financial statement rendering

---

## Known Gaps / Partial Implementations

| Area | Status | Notes |
|---|---|---|
| OEM live connection | DEMO_FIXTURE | No real OEM API contacted |
| Bank feed import | Synthetic | Manual bank statement lines only |
| Payroll payment rail | Handoff only | ACH/check issuance not connected |
| Advanced automation execution | OBSERVE_ONLY | Approval workflows in place |

---

## Verification Command

```bash
npx tsx scripts/verify-r1-demo.ts
```

Expected output:
```
✅ ACCOUNTING_R1_DEMO_READY
```

If any checks fail, the output lists exact gaps:
```
❌ ACCOUNTING_R1_DEMO_PARTIAL_WITH_EXACT_GAPS
• [check name]: [detail]
```

---

## Security Notes

- Demo passwords are for **local prototype use only**
- No production credentials are used or committed
- No real customer, dealer, employee, payroll, banking or OEM data is seeded
- JWT secrets and database credentials are never printed by seed scripts
- `--reset` guard prevents accidental data deletion on non-local targets
