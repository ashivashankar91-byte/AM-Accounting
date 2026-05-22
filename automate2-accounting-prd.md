# AutoMate 2.0 Accounting Module — Product Requirements Document (PRD)

**Version:** 1.0  
**Date:** May 9, 2026  
**Owner:** Shiva Angadi, Product Owner  
**Status:** In Review  

---

## TABLE OF CONTENTS

1. [Feature 1: Sales Tax Accrual](#feature-1-sales-tax-accrual-by-jurisdiction)
2. [Feature 2: 1099 Contractor Reports](#feature-2-1099-contractor-report-generator)
3. [Feature 3: Commission Tracking](#feature-3-commission-tracking--reporting)
4. [Feature 4: Floor Plan Financing](#feature-4-floor-plan-financing-module)
5. [Feature 5–8: Phase 2 Features](#phase-2-features)
6. [Redesign Features](#redesign-features)
7. [Data Schemas](#data-schemas)
8. [API Contracts](#api-contracts)
9. [Acceptance Criteria Summary](#acceptance-criteria-summary)

---

## FEATURE 1: SALES TAX ACCRUAL BY JURISDICTION

### Overview
Automates sales tax accrual for each jurisdiction (state, county, city, district) on a per-deal basis, eliminating manual tax tracking and enabling automated monthly tax compliance reporting.

### API Contracts

#### POST /api/v1/gl/tax/configure
**Purpose:** Create or update tax jurisdiction configuration  
**Headers:** `x-tenant-id` (required)

**Request Body:**
```json
{
  "jurisdiction_code": "CA_ALAMEDA_OAKLAND",
  "jurisdiction_name": "Oakland, Alameda County, California",
  "jurisdiction_level": "CITY",
  "tax_rate": 0.08625,
  "gl_payable_account_id": "uuid-2530",
  "gl_receivable_account_id": "uuid-1150",
  "effective_date": "2026-06-01",
  "is_active": true
}
```

**Response:** 
```json
{
  "id": "tax-jurisdiction-001",
  "tenant_id": "tenant-kunes",
  "jurisdiction_code": "CA_ALAMEDA_OAKLAND",
  "jurisdiction_name": "Oakland, Alameda County, California",
  "jurisdiction_level": "CITY",
  "tax_rate": 0.08625,
  "gl_payable_account_id": "uuid-2530",
  "gl_receivable_account_id": "uuid-1150",
  "effective_date": "2026-06-01",
  "is_active": true,
  "created_at": "2026-05-09T10:30:00Z"
}
```

**Status Codes:**
- `201 Created` — jurisdiction created
- `400 Bad Request` — GL account IDs not found
- `409 Conflict` — jurisdiction code already exists for tenant/date

---

#### GET /api/v1/gl/tax/rates
**Purpose:** List all tax jurisdictions for tenant  
**Query Params:**
- `jurisdiction_code` (optional) — filter by code
- `is_active` (optional, default=true) — filter by active status
- `effective_date` (optional, ISO date) — filter by effective date

**Response:**
```json
{
  "jurisdictions": [
    {
      "id": "tax-jurisdiction-001",
      "jurisdiction_code": "CA_ALAMEDA_OAKLAND",
      "jurisdiction_name": "Oakland, Alameda County, California",
      "jurisdiction_level": "CITY",
      "tax_rate": 0.08625,
      "gl_payable_account_id": "uuid-2530",
      "gl_receivable_account_id": "uuid-1150",
      "effective_date": "2026-06-01",
      "is_active": true
    }
  ],
  "count": 1
}
```

---

#### POST /api/v1/gl/tax/accrue
**Purpose:** Trigger tax accrual for a deal (called post-deal-posting)  
**Headers:** `x-tenant-id` (required)

**Request Body:**
```json
{
  "deal_id": "deal-ABC123",
  "deal_date": "2026-05-15",
  "jurisdictions": [
    {
      "jurisdiction_code": "CA_ALAMEDA_OAKLAND",
      "taxable_amount": 3000.00
    }
  ],
  "tax_exempt_reason": null
}
```

**Response:**
```json
{
  "status": "SUCCESS",
  "journal_entries_created": [
    {
      "entry_id": "je-tx-001",
      "jurisdiction": "CA_ALAMEDA_OAKLAND",
      "tax_amount": 258.75,
      "debit_account": "Tax Receivable",
      "credit_account": "Sales Tax Payable - CA",
      "entry_date": "2026-05-15"
    }
  ],
  "total_tax_accrued": 258.75
}
```

---

#### GET /api/v1/gl/tax/liability-report
**Purpose:** Generate tax liability summary for a period  
**Query Params:**
- `period` (required, YYYY-MM)
- `jurisdiction_code` (optional)

**Response:**
```json
{
  "period": "2026-05",
  "tenant_id": "tenant-kunes",
  "jurisdictions": [
    {
      "jurisdiction_code": "CA_ALAMEDA_OAKLAND",
      "jurisdiction_name": "Oakland, Alameda County, California",
      "tax_rate": 0.08625,
      "month_accruals": 2847.50,
      "prior_unpaid": 0,
      "total_due": 2847.50,
      "tax_payable_account": "GL-2530",
      "tax_payable_balance": 2847.50
    }
  ],
  "grand_total": 2847.50,
  "generated_at": "2026-05-31T23:59:59Z"
}
```

---

### Data Schemas

#### tax_jurisdictions
```sql
CREATE TABLE tax_jurisdictions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  jurisdiction_code VARCHAR(50) NOT NULL,
  jurisdiction_name TEXT NOT NULL,
  jurisdiction_level VARCHAR(20) NOT NULL CHECK (jurisdiction_level IN ('STATE','COUNTY','CITY','DISTRICT')),
  tax_rate NUMERIC(6,4) NOT NULL,
  gl_payable_account_id TEXT NOT NULL REFERENCES gl_accounts(id),
  gl_receivable_account_id TEXT NOT NULL REFERENCES gl_accounts(id),
  is_active BOOLEAN DEFAULT true,
  effective_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, jurisdiction_code, effective_date)
);
```

#### tax_exemptions
```sql
CREATE TABLE tax_exemptions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  customer_id TEXT NOT NULL,
  jurisdiction_code VARCHAR(50),
  certificate_number TEXT NOT NULL,
  certificate_doc_url TEXT,
  expiration_date DATE NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, customer_id, jurisdiction_code)
);
```

#### tax_accrual_entries
```sql
CREATE TABLE tax_accrual_entries (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  deal_id TEXT NOT NULL,
  jurisdiction_code VARCHAR(50) NOT NULL,
  taxable_amount NUMERIC(15,2) NOT NULL,
  tax_rate NUMERIC(6,4) NOT NULL,
  tax_amount NUMERIC(15,2) NOT NULL,
  journal_entry_id TEXT REFERENCES journal_entries(id),
  accrual_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## FEATURE 2: 1099 CONTRACTOR REPORT GENERATOR

### API Contracts

#### POST /api/v1/ap/1099/generate
**Purpose:** Generate 1099s for a tax year  
**Headers:** `x-tenant-id` (required)

**Request Body:**
```json
{
  "tax_year": 2026,
  "form_types": ["1099-MISC", "1099-NEC"],
  "minimum_threshold": 600.00
}
```

**Response:**
```json
{
  "status": "SUCCESS",
  "tax_year": 2026,
  "forms_generated": 12,
  "vendors": [
    {
      "vendor_id": "vendor-001",
      "vendor_name": "ABC Hydraulics Inc.",
      "tin": "12-3456789",
      "form_type": "1099-MISC",
      "total_payments": 8500.00,
      "status": "DRAFT",
      "id": "1099-record-001"
    }
  ],
  "total_1099_amount": 125600.00
}
```

---

#### GET /api/v1/ap/1099/review
**Purpose:** List generated 1099s for review  
**Query Params:**
- `taxYear` (required)
- `status` (optional: DRAFT, REVIEWED, FILED, CORRECTED, VOID)

**Response:**
```json
{
  "tax_year": 2026,
  "forms": [
    {
      "id": "1099-record-001",
      "vendor_id": "vendor-001",
      "vendor_name": "ABC Hydraulics Inc.",
      "tin": "12-3456789",
      "form_type": "1099-MISC",
      "total_payments": 8500.00,
      "box_amounts": {
        "box_1": 8500.00
      },
      "status": "DRAFT",
      "created_at": "2026-05-09T10:30:00Z"
    }
  ],
  "count": 12
}
```

---

#### PATCH /api/v1/ap/1099/:id
**Purpose:** Adjust 1099 amounts or metadata  
**Headers:** `x-tenant-id` (required)

**Request Body:**
```json
{
  "total_payments": 8200.00,
  "box_amounts": {
    "box_1": 8200.00
  },
  "adjustment_reason": "Voided check on 2026-05-20"
}
```

**Response:**
```json
{
  "id": "1099-record-001",
  "total_payments": 8200.00,
  "box_amounts": {"box_1": 8200.00},
  "status": "DRAFT",
  "updated_at": "2026-05-09T11:00:00Z"
}
```

---

#### POST /api/v1/ap/1099/export
**Purpose:** Export 1099s to IRS FIRE format  
**Headers:** `x-tenant-id` (required)

**Request Body:**
```json
{
  "tax_year": 2026,
  "form_status": "FILED",
  "export_format": "FIRE"
}
```

**Response:**
```
IRS FIRE format file (binary stream)
Content-Disposition: attachment; filename="1099-FIRE-2026.txt"
```

---

#### GET /api/v1/ap/1099/:id/pdf
**Purpose:** Download individual 1099 as PDF  
**Headers:** `x-tenant-id` (required)

**Response:**
```
PDF binary stream
Content-Disposition: attachment; filename="1099-NEC-12-3456789-2026.pdf"
```

---

### Data Schemas

#### vendor_1099_records
```sql
CREATE TABLE vendor_1099_records (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  vendor_id TEXT NOT NULL,
  tax_year INTEGER NOT NULL,
  form_type VARCHAR(10) NOT NULL CHECK (form_type IN ('1099-MISC','1099-NEC','1099-X')),
  tin TEXT NOT NULL,
  total_payments NUMERIC(15,2) NOT NULL,
  box_amounts JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','REVIEWED','FILED','CORRECTED','VOID')),
  filed_date DATE,
  adjustment_reason TEXT,
  corrected_from_id TEXT REFERENCES vendor_1099_records(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by TEXT,
  updated_by TEXT,
  UNIQUE(tenant_id, vendor_id, tax_year, form_type)
);
```

---

## FEATURE 3: COMMISSION TRACKING & REPORTING

### API Contracts

#### POST /api/v1/payroll/commission-plans
**Purpose:** Create or update commission plan  
**Headers:** `x-tenant-id` (required)

**Request Body:**
```json
{
  "employee_id": "emp-001",
  "plan_type": "PERCENTAGE",
  "department": "SALES",
  "percentage_rate": 0.02,
  "effective_date": "2026-06-01",
  "is_active": true
}
```

**Response:**
```json
{
  "id": "plan-001",
  "employee_id": "emp-001",
  "plan_type": "PERCENTAGE",
  "department": "SALES",
  "percentage_rate": 0.02,
  "effective_date": "2026-06-01",
  "is_active": true,
  "created_at": "2026-05-09T10:30:00Z"
}
```

---

#### POST /api/v1/payroll/commissions/calculate
**Purpose:** Calculate and accrue commission for a deal  
**Headers:** `x-tenant-id` (required)

**Request Body:**
```json
{
  "deal_id": "deal-ABC123",
  "employee_id": "emp-001",
  "deal_type": "NEW_VEHICLE",
  "gross_profit": 5000.00,
  "deal_date": "2026-05-15"
}
```

**Response:**
```json
{
  "commission_record_id": "comm-001",
  "employee_id": "emp-001",
  "deal_id": "deal-ABC123",
  "commission_amount": 100.00,
  "plan_id": "plan-001",
  "status": "ACCRUED",
  "journal_entry_id": "je-comm-001",
  "journal_entry_status": "POSTED"
}
```

---

#### GET /api/v1/payroll/commissions
**Purpose:** List commissions for employee/period  
**Query Params:**
- `employeeId` (required)
- `period` (optional, YYYY-MM)
- `status` (optional)

**Response:**
```json
{
  "employee_id": "emp-001",
  "period": "2026-05",
  "commissions": [
    {
      "id": "comm-001",
      "deal_id": "deal-ABC123",
      "deal_type": "NEW_VEHICLE",
      "gross_profit": 5000.00,
      "commission_amount": 100.00,
      "status": "ACCRUED",
      "plan_rate": 0.02
    }
  ],
  "month_total": 100.00,
  "ytd_total": 5000.00
}
```

---

#### GET /api/v1/payroll/commissions/report
**Purpose:** Generate commission summary report  
**Query Params:**
- `period` (required, YYYY-MM)
- `department` (optional)

**Response:**
```json
{
  "period": "2026-05",
  "report_date": "2026-05-31T23:59:59Z",
  "by_employee": [
    {
      "employee_id": "emp-001",
      "employee_name": "John Smith",
      "department": "SALES",
      "deal_count": 3,
      "gross_profit": 15000.00,
      "commission_accrued": 300.00,
      "commission_paid": 0,
      "commission_ytd": 1200.00,
      "plan_rate": "2%"
    }
  ],
  "by_department": {
    "SALES": {"total_commission": 3200.00, "deal_count": 45},
    "F&I": {"total_commission": 1500.00, "deal_count": 25}
  },
  "grand_total": 4700.00
}
```

---

### Data Schemas

#### commission_plans
```sql
CREATE TABLE commission_plans (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  employee_id TEXT NOT NULL,
  plan_type VARCHAR(20) NOT NULL CHECK (plan_type IN ('FLAT','PERCENTAGE','TIERED')),
  department VARCHAR(20),
  flat_amount NUMERIC(15,2),
  percentage_rate NUMERIC(5,2),
  tiers JSONB,
  effective_date DATE NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

#### commission_records
```sql
CREATE TABLE commission_records (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  employee_id TEXT NOT NULL,
  deal_id TEXT,
  deal_type VARCHAR(20),
  gross_profit NUMERIC(15,2) NOT NULL,
  commission_amount NUMERIC(15,2) NOT NULL,
  plan_id TEXT REFERENCES commission_plans(id),
  status VARCHAR(20) NOT NULL DEFAULT 'ACCRUED' CHECK (status IN ('ACCRUED','PAID','ADJUSTED','CHARGED_BACK')),
  journal_entry_id TEXT REFERENCES journal_entries(id),
  period_year INTEGER,
  period_month SMALLINT,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by TEXT
);
```

---

## FEATURE 4: FLOOR PLAN FINANCING MODULE

### API Contracts

#### POST /api/v1/gl/floor-plan/units
**Purpose:** Register a floored vehicle  
**Headers:** `x-tenant-id` (required)

**Request Body:**
```json
{
  "vin": "1HGCV41JXMN109186",
  "lender_id": "lender-wells-fargo",
  "advance_amount": 25000.00,
  "interest_rate": 0.065,
  "floor_date": "2026-05-01",
  "gl_liability_account_id": "uuid-2510",
  "gl_interest_account_id": "uuid-5510",
  "curtailment_schedule": {"monthly": 500.00}
}
```

**Response:**
```json
{
  "id": "floor-plan-unit-001",
  "vin": "1HGCV41JXMN109186",
  "lender_id": "lender-wells-fargo",
  "advance_amount": 25000.00,
  "current_balance": 25000.00,
  "interest_rate": 0.065,
  "floor_date": "2026-05-01",
  "status": "ACTIVE",
  "accrued_interest": 0,
  "created_at": "2026-05-01T10:30:00Z"
}
```

---

#### GET /api/v1/gl/floor-plan/units
**Purpose:** List floored units  
**Query Params:**
- `status` (optional: ACTIVE, PAID_OFF, CURTAILED)
- `lender_id` (optional)

**Response:**
```json
{
  "units": [
    {
      "id": "floor-plan-unit-001",
      "vin": "1HGCV41JXMN109186",
      "lender_id": "lender-wells-fargo",
      "advance_amount": 25000.00,
      "current_balance": 25067.15,
      "accrued_interest": 67.15,
      "days_on_floor": 14,
      "status": "ACTIVE"
    }
  ],
  "total_balance": 125000.00
}
```

---

#### POST /api/v1/gl/floor-plan/accrue-interest
**Purpose:** Run daily interest accrual (scheduled job)  
**Headers:** `x-tenant-id` (required)

**Request Body:**
```json
{
  "as_of_date": "2026-05-02"
}
```

**Response:**
```json
{
  "status": "SUCCESS",
  "units_processed": 50,
  "total_daily_interest": 456.25,
  "journal_entries_created": [
    {
      "entry_id": "je-fp-interest-001",
      "lender": "Wells Fargo",
      "debit_account": "GL-5510",
      "credit_account": "GL-2510",
      "amount": 156.25
    }
  ],
  "job_executed_at": "2026-05-02T06:00:00Z"
}
```

---

#### POST /api/v1/gl/floor-plan/payoff/:unitId
**Purpose:** Trigger floor plan payoff on vehicle sale  
**Headers:** `x-tenant-id` (required)

**Request Body:**
```json
{
  "sale_date": "2026-05-15",
  "sale_amount": 28000.00,
  "deal_id": "deal-DEF456"
}
```

**Response:**
```json
{
  "unit_id": "floor-plan-unit-001",
  "status": "PAID_OFF",
  "payoff_amount": 25067.15,
  "journal_entry_id": "je-fp-payoff-001",
  "payoff_check_scheduled": true,
  "payoff_check_id": "check-12345"
}
```

---

#### GET /api/v1/gl/floor-plan/aging-report
**Purpose:** Generate floor plan aging report  
**Query Params:**
- `as_of_date` (optional, defaults to today)
- `lender_id` (optional)

**Response:**
```json
{
  "as_of_date": "2026-05-31",
  "by_lender": [
    {
      "lender_id": "lender-wells-fargo",
      "lender_name": "Wells Fargo",
      "units": [
        {
          "vin": "1HGCV41JXMN109186",
          "vehicle_make_model": "2024 Honda Accord",
          "advance_amount": 25000.00,
          "accrued_interest": 545.65,
          "days_on_floor": 31,
          "status": "ACTIVE"
        }
      ],
      "subtotal_advance": 125000.00,
      "subtotal_interest": 2890.25
    }
  ],
  "grand_total_advance": 500000.00,
  "grand_total_interest": 12340.75
}
```

---

### Data Schemas

#### floor_plan_units
```sql
CREATE TABLE floor_plan_units (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  vin VARCHAR(17) NOT NULL,
  lender_id TEXT NOT NULL,
  advance_amount NUMERIC(15,2) NOT NULL,
  current_balance NUMERIC(15,2) NOT NULL,
  interest_rate NUMERIC(6,4) NOT NULL,
  floor_date DATE NOT NULL,
  payoff_date DATE,
  curtailment_schedule JSONB,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAID_OFF','CURTAILED','DAMAGED')),
  gl_liability_account_id TEXT REFERENCES gl_accounts(id),
  gl_interest_account_id TEXT REFERENCES gl_accounts(id),
  accrued_interest NUMERIC(15,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, vin)
);
```

---

## PHASE 2 FEATURES

### Feature 5: Inventory Valuation (FIFO, Weighted-Average)

**API Endpoints:**
- `POST /api/v1/gl/inventory/valuation/calculate` — run quarterly valuation
- `GET /api/v1/gl/inventory/valuation/report?period=YYYY-Q#` — get valuation report
- `GET /api/v1/gl/inventory/layers?accountId=X` — get inventory layers for account

**Schemas:**
```sql
CREATE TABLE inventory_layers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  gl_account_id TEXT NOT NULL,
  purchase_date DATE NOT NULL,
  quantity NUMERIC(15,2) NOT NULL,
  unit_cost NUMERIC(15,2) NOT NULL,
  total_cost NUMERIC(15,2) NOT NULL,
  valuation_method VARCHAR(20) CHECK (valuation_method IN ('FIFO','WEIGHTED_AVERAGE','LIFO'))
);

CREATE TABLE inventory_valuations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  gl_account_id TEXT NOT NULL,
  valuation_date DATE NOT NULL,
  prior_cost NUMERIC(15,2),
  current_cost NUMERIC(15,2),
  adjustment_journal_entry_id TEXT,
  valuation_method VARCHAR(20)
);
```

---

### Feature 6: Fixed Asset Management

**API Endpoints:**
- `POST /api/v1/gl/fixed-assets/register` — register new asset
- `GET /api/v1/gl/fixed-assets` — list assets
- `POST /api/v1/gl/fixed-assets/:id/dispose` — dispose of asset

**Schemas:**
```sql
CREATE TABLE fixed_assets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  asset_name TEXT NOT NULL,
  description TEXT,
  purchase_date DATE NOT NULL,
  cost NUMERIC(15,2) NOT NULL,
  useful_life_years INTEGER NOT NULL,
  depreciation_method VARCHAR(20) CHECK (depreciation_method IN ('STRAIGHT_LINE','UNITS_OF_PRODUCTION')),
  gl_asset_account_id TEXT,
  gl_depreciation_account_id TEXT,
  accumulated_depreciation NUMERIC(15,2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'ACTIVE'
);

CREATE TABLE depreciation_schedules (
  id TEXT PRIMARY KEY,
  asset_id TEXT REFERENCES fixed_assets(id),
  month_date DATE NOT NULL,
  depreciation_amount NUMERIC(15,2) NOT NULL,
  journal_entry_id TEXT
);
```

---

### Feature 7: Warranty Accrual Estimator

**API Endpoints:**
- `POST /api/v1/payroll/warranty/accrue` — accrue warranty reserve on sale
- `GET /api/v1/payroll/warranty/reserve-report?period=YYYY-MM` — warranty liability summary
- `POST /api/v1/payroll/warranty/claims` — record warranty claim against reserve

**Schemas:**
```sql
CREATE TABLE warranty_accruals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  deal_id TEXT NOT NULL,
  warranty_amount NUMERIC(15,2) NOT NULL,
  claims_ratio NUMERIC(5,2) NOT NULL,
  reserve_amount NUMERIC(15,2) NOT NULL,
  journal_entry_id TEXT,
  accrual_date DATE NOT NULL
);

CREATE TABLE warranty_claims (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  warranty_id TEXT,
  claim_amount NUMERIC(15,2) NOT NULL,
  claim_date DATE NOT NULL,
  journal_entry_id TEXT
);
```

---

### Feature 8: Manufacturer Reconciliation

**API Endpoints:**
- `POST /api/v1/gl/oem-recon/import` — import OEM claim feed
- `GET /api/v1/gl/oem-recon/unmatched` — list unmatched claims
- `POST /api/v1/gl/oem-recon/match` — manual match AR to OEM claim

**Schemas:**
```sql
CREATE TABLE oem_claims (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  claim_number TEXT NOT NULL,
  oem VARCHAR(20),
  claim_amount NUMERIC(15,2) NOT NULL,
  approval_date DATE,
  ar_entry_id TEXT REFERENCES apar_entries(id),
  match_status VARCHAR(20) CHECK (match_status IN ('MATCHED','UNMATCHED','SHORT_PAYMENT')),
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## REDESIGN FEATURES

### Redesign 1: GL Exception Detection (AI Agent)

**Service:** `agent-gl-exception` (new agent service)  
**Trigger:** `JOURNAL_ENTRY_SUBMITTED` event  
**Tools:**
- `query_gl_accounts()` — get account history and averages
- `query_peer_transactions()` — compare to similar dealerships
- `flag_exception()` — flag entry for human review with reasoning

**Workflow:**
1. Journal entry submitted
2. Agent queries GL history (30-day average for account, peer data)
3. Agent computes anomaly score (0–100)
4. If score > threshold (configurable), agent flags with explanation
5. Human reviews top exceptions daily; provides feedback
6. Agent learns (feedback loop via prompt adjustment)

---

### Redesign 2: Deal Profitability Dashboard (T1 Copilot)

**Service:** `agent-t1` (enhanced with T1 Copilot)  
**Tools:** (new tools for deal analysis)
- `query_deal_gl_lines()` — get GL entries by deal_id
- `query_vehicle_sales_data()` — vehicle type, model, cost
- `query_department_p_l()` — dept-level P&L

**Query Examples:**
- "Which sales rep had the highest margin last month?"
- "Show me the top 5 chargebacks by amount"
- "What's the average profit per vehicle type YTD?"

---

### Redesign 3: Bank Reconciliation Workflow (AP/AR Agent)

**Enhancement:** AP/AR Reconciliation Agent gains new capability  
**New Tool:** `auto_match_bank_transactions()`  
**Workflow:**
1. Bank feed ingested
2. Agent attempts fuzzy matching (amount ±$1, date ±3 days)
3. Agent assigns confidence score per match
4. High-confidence (>95%) matches: auto-approved
5. Low-confidence (<80%) matches: sent to human for review
6. Human provides feedback (marks false positives)
7. Agent learns and improves accuracy

---

## ACCEPTANCE CRITERIA SUMMARY

### Feature 1: Sales Tax Accrual
- ✅ Tax rates configurable by jurisdiction with effective dates
- ✅ Automatic GL accrual on deal posting
- ✅ Tax-exempt customer support with certificate tracking
- ✅ Monthly liability report matching state filing requirements
- ✅ Multi-tenant isolation
- ✅ Full audit trail for rate changes

**Definition of Done:**
- All APIs functional with x-tenant-id header enforcement
- Database schemas created and migrated
- Unit tests ≥80% coverage
- Integration tests with GL Integrity Agent
- Documentation complete
- Ready for Phase 1 deployment

---

### Feature 2: 1099 Contractor Reports
- ✅ Vendor 1099-eligibility flag and TIN validation
- ✅ Automatic generation for $600+ threshold
- ✅ Consolidation across dealer group rooftops by TIN
- ✅ 1099-MISC and 1099-NEC classification support
- ✅ Review/adjustment/correction workflow
- ✅ IRS FIRE export format
- ✅ PDF generation for print/mail

**Definition of Done:**
- All APIs functional
- Tax year 2026 test generation successful
- FIRE export validated against IRS specs
- PDF output matches official IRS form layout
- Audit trail complete
- Ready for January 2027 filing season

---

### Feature 3: Commission Tracking
- ✅ Commission plans (flat, percentage, tiered) configurable per employee
- ✅ Automatic accrual on deal posting with GL entry
- ✅ Multi-department support (Sales, F&I, Service)
- ✅ Chargeback reversal automation
- ✅ Adjustment workflow with audit trail
- ✅ Payroll batch integration
- ✅ Monthly report by employee/department
- ✅ Dashboard with YTD tracking

**Definition of Done:**
- All APIs functional
- Commission accrual through GL Integrity Agent validation
- Payroll integration tested (commission included in bi-weekly batch)
- Dashboard displays correctly
- Report exports to CSV
- Ready for Phase 1 deployment

---

### Feature 4: Floor Plan Financing
- ✅ Unit registration by VIN with lender/rate/advance amount
- ✅ Daily interest accrual (compound interest supported)
- ✅ Automatic payoff on vehicle sale
- ✅ Curtailment tracking and AP reminders
- ✅ Floor plan aging report by lender
- ✅ GL integration (liability, interest, payoff entries)
- ✅ Multi-lender support with account isolation
- ✅ Loss mitigation (damage/total loss writeoff)

**Definition of Done:**
- All APIs functional
- Daily accrual job tested with 50+ units
- Reconciliation to lender statements: 99.5% accuracy
- Aging report matches dealer expectations
- Ready for Phase 1 deployment

---

### Redesign 1: GL Exception Agent
- ✅ Real-time monitoring of all journal entries
- ✅ Pattern analysis (historical, peer, dept)
- ✅ Context-aware severity assignment
- ✅ Natural-language explanation
- ✅ Learning from human feedback

**Definition of Done:**
- Agent deployed and monitoring production entries
- Dashboard shows top exceptions ranked by severity
- Controller can approve/reject with feedback
- False positive rate < 5% after 100 feedback samples
- Ready for Phase 1 deployment

---

### Redesign 2: Deal Profitability (T1 Copilot)
- ✅ Real-time deal P&L querying
- ✅ Multi-dimensional analysis (rep, vehicle type, dept, period)
- ✅ Natural-language query support
- ✅ Drill-down capability
- ✅ Chargeback impact quantification

**Definition of Done:**
- T1 agent enhanced with deal-specific tools
- Queries respond in <5 seconds
- Accuracy validated against manual calculations
- Ready for Phase 1 deployment

---

### Redesign 3: Bank Recon AI Auto-Match
- ✅ Automatic bank feed ingestion
- ✅ Fuzzy matching with confidence scoring
- ✅ High-confidence (>95%) auto-approval
- ✅ Low-confidence escalation to human
- ✅ Learning from feedback

**Definition of Done:**
- Bank feed integration tested with 3 banks (Wells Fargo, Chase, BOA)
- Matching accuracy >95% for high-confidence items
- Human review time reduced from 2–4 hours to 15–20 minutes
- Ready for Phase 1 deployment

---

## DATA GOVERNANCE

**All monetary amounts:** `NUMERIC(15,2)` (currency, 2 decimal places)  
**All dates:** `DATE` or `TIMESTAMPTZ` (ISO 8601 format in JSON)  
**All IDs:** `TEXT PRIMARY KEY` or `UUID` (generated via `gen_random_uuid()`)  
**Tenant isolation:** Every table includes `tenant_id` column; all queries filtered by `x-tenant-id` header  
**Audit trail:** `created_at`, `updated_at`, `created_by`, `updated_by` on all mutable tables  
**Immutable audit log:** `audit_log` table with DB-level trigger (INSERT-only, no UPDATE/DELETE)

---

## DEPLOYMENT CHECKLIST

### Pre-Deployment
- [ ] All APIs tested with unit tests (>80% coverage)
- [ ] Integration tests with existing GL services passed
- [ ] Database migrations tested on staging environment
- [ ] Performance testing (1000 entries/second throughput)
- [ ] Security review (SQL injection, XSS, CSRF, auth)
- [ ] Documentation complete (API contracts, schemas, examples)
- [ ] Training materials prepared for users

### Deployment Day
- [ ] Database migrations executed
- [ ] Services deployed to production
- [ ] Smoke tests passed (create/read/update on each feature)
- [ ] Monitoring configured (error rates, latency, throughput)
- [ ] Rollback plan documented

### Post-Deployment
- [ ] Canary deployment (5% of traffic) for 24 hours
- [ ] Monitor error rates, latency, user feedback
- [ ] If stable, roll out to 100% of traffic
- [ ] On-call engineer on standby for 48 hours

---

## APPENDIX: EXAMPLE WORKFLOWS

### Workflow: Sales Tax Accrual on Deal Posting

1. Deal posted to GL (service labor $1,000, parts $2,000, taxable)
2. GL Integrity Agent validates entry (no duplicates, balance check)
3. Entry status changes to POSTED
4. `deal_posted` event published with deal details
5. Tax Accrual Service subscribes to event
6. Tax Accrual Service queries tax jurisdiction rates (Oakland, CA: 8.625%)
7. Tax Accrual Service calculates tax = $3,000 × 8.625% = $257.50
8. Tax Accrual Service creates GL journal entry:
   - DR: Tax Receivable (GL-1150) $257.50
   - CR: Sales Tax Payable - CA (GL-2530) $257.50
9. Tax journal entry is posted (same GL pipeline validation)
10. Audit entry recorded with timestamp, user, deal ID

### Workflow: 1099 Generation (January 2027)

1. Controller clicks "Generate 1099s for 2026"
2. System queries all 1099-eligible vendors with TIN on file
3. For each vendor, sums AP check payments for tax year 2026
4. For each vendor with >= $600:
   - Creates 1099-MISC or 1099-NEC based on vendor classification
   - Status set to DRAFT
5. Controller reviews list, adjusts amounts if needed
6. Controller clicks "Mark as Reviewed"
7. Controller clicks "Export to FIRE"
8. System generates IRS FIRE-format file
9. Controller uploads to IRS e-Services portal
10. Status updated to FILED with filing timestamp

---

**PRD Version:** 1.0  
**Next Review:** June 2026  
**Owner:** Shiva Angadi (Product Owner)
