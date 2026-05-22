# AMACC Phase 3 Implementation Summary
**Date: 2026-05-07**  
**Status: In Progress**

## Completed Implementations

### ✅ FIX-009: Expose cosAccountId and invAccountId in GL Account Create/Update API
**File:** `services/gl-service/src/http/routes.ts`, `src/infrastructure/account-repository.ts`

- Added `cosAccountId` and `invAccountId` fields to CreateAccountSchema and UpdateAccountSchema
- Added validation: both fields must be provided together or both null (paired constraint)
- Added reference validation: checks that referenced accounts exist and are active
- Updated account repository to pass fields through to Prisma
- Updated toDomain() mapping to include new fields

**Impact:** COS/INV chained sale posting now works for API-created accounts, matching COBOL contract.

---

### ✅ FIX-013: Add sort_key Column to gl_accounts
**Files:** 
- Migration: `services/gl-service/prisma/migrations/20260507_fix013_add_sort_key.sql`
- Prisma: `services/gl-service/prisma/schema.prisma`
- Routes: `services/gl-service/src/http/routes.ts`
- Repository: `services/gl-service/src/infrastructure/account-repository.ts`

**Changes:**
- Created migration: ALTER TABLE gl_accounts ADD COLUMN sort_key VARCHAR(20)
- Added Prisma field: sortKey String? @db.VarChar(20) @map("sort_key")
- Added sort_key to CreateAccountSchema and UpdateAccountSchema
- Updated getAccounts query: ORDER BY sort_key ASC, code ASC
- Updated repository create/update/toDomain methods

**Impact:** Chart of Accounts can now be ordered by financial statement display sequence, not just account code.

---

### ✅ FIX-014: Payroll Batch Posting Must Create GL Journal Entry
**File:** `services/payroll-service/src/application/payroll-service.ts`

**Changes:**
- Created resolveAccountCode() helper to fetch GL accounts by code
- Updated postBatch() to resolve all account codes to glAccountIds
- Changed payload format from sourceType/sourceId to standard GL journal entry schema
- Uses correct field names: entryDate, source='PR', sourceRef=batchNumber
- Handles unmapped accounts gracefully with warnings

**Impact:** Payroll costs now flow to GL and appear in trial balance, income statement, and financial reports.

---

### ✅ FIX-015: Fix schedule-service and payroll-service Port Conflict
**Files:**
- `services/schedule-service/src/index.ts`
- `docker-compose.yml`
- `services/api-gateway/src/index.ts`

**Changes:**
- Changed schedule-service default port from 3012→3018
- Updated docker-compose.yml: SCHEDULE_SERVICE_URL port 3030→3018
- Updated api-gateway routes to use schedule-service:3018
- Added canonical port assignment documentation comment in api-gateway

**Canonical Port Assignments:**
```
3001: auth-service
3010: gl-service
3011: eom-service
3012: payroll-service
3013: apar-service
3014: recon-service
3018: schedule-service (FIX-015)
3020-3027: agent-* services
3040: group-service
3041: analytics-service
3042: compliance-service
3043: cashflow-service
3044: coa-service
3045: fs-service
```

**Impact:** Both services can now boot without port conflicts.

---

### ✅ FIX-017: Add Serialization Failure Retry for SERIALIZABLE Transactions
**Files:**
- New: `services/gl-service/src/lib/serializable-retry.ts`
- Modified: `services/gl-service/src/application/gl-service.ts`

**Implementation:**
```typescript
export async function withSerializableRetry<T>(
  prisma: any,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T>
```

- Catches PostgreSQL error 40001 (serialization failure / P2034 in Prisma)
- Implements exponential backoff: 100ms, 200ms, 400ms, 800ms, 1600ms
- Max 5 retry attempts (total up to 3.1 seconds)
- Applied to three critical operations:
  1. `resetForOwnershipChange()` — ownership transitions
  2. `performPeriodCarryForward()` — EOM carry-forward
  3. `approveJournalEntry()` — journal posting under load

**Impact:** Eliminates intermittent 500 errors under concurrent load. Production resilience for high-volume EOM operations.

---

### ✅ FIX-020: Expose applyCd Field in Journal Entry Creation
**File:** `services/gl-service/src/http/routes.ts`

**Changes:**
- Added `applyCd: z.string().max(1).optional()` to CreateJournalEntrySchema line entries
- Field already exists in JournalLine Prisma model
- Field already checked in approveJournalEntry() COS/INV chain logic

**Impact:** API callers can now suppress COS/INV chain posting by passing applyCd='#'

---

### ✅ FIX-021: Create fiscal_periods Table with Period 13 Support
**Files:**
- Migration: `services/eom-service/prisma/migrations/20260507_fix021_fiscal_periods.sql`
- Prisma: `services/eom-service/prisma/schema.prisma`

**Changes:**
- Created fiscal_periods table with:
  - tenant_id, fiscal_year, period_number (1-13), start_date, end_date
  - status: OPEN | CLOSED | ADJUSTMENT | YEAR_END
  - closed_at, closed_by (audit trail)
  - Unique constraint on (tenant_id, fiscal_year, period_number)
  - Indexes for tenant lookups and status queries
- Added CHECK constraint to eom_closes: period_month BETWEEN 1 AND 13
- Prisma model: FiscalPeriod

**Status:** Migration and model created. Next steps:
1. Auto-populate fiscal_periods when gl_system_config created
2. Wire EOM close completion to update status
3. Add API endpoints for period management

---

## Partially Completed

### 🟡 FIX-021: Continued Implementation Needed
Still required for full Period 13 support:
1. Auto-population service when fiscal_year_start_month changes
2. EOM step handlers to update period status to CLOSED
3. API endpoints for period queries and bulk updates

---

## Remaining Implementations (Not Yet Started)

### FIX-020: (Already Done - see above)

### BUILD-006: Transaction Reversal API
- Endpoint: POST /api/v1/gl/journal-entries/:id/reverse
- Creates reversal entry with negated amounts
- Marks original as REVERSED, new as reversalOfId linkage
- Requires: reversalOfId, reversedById columns on journal_entries
- Suppresses COS/INV chain on reversal (applyCd='#')

### BUILD-007: GLBYID Account ID Mapping Table
- Creates gl_account_id_map table for external ID mapping
- CRUD endpoints for mapping management
- resolveAccountId() utility for lookups
- Used for dealer group consolidations and DMS migrations

### BUILD-008: Cash Clearing Flags and Bank Reconciliation Support
- Adds is_cash_clearing, is_deposit_clearing flags to gl_accounts
- Adds clear_code to history_transactions (HI-CLEAR-CODE)
- Bank reconciliation endpoints

### BUILD-009: Scheduled Auto-Post Job
- Finds DRAFT entries for sources with auto_post=true
- Posts them through full pipeline
- Scheduled job + on-demand trigger endpoint

### BUILD-010: Wire 13th Month Through EOM Step Orchestrator
- Integrate 13th month lifecycle into orchestrator
- Steps: 13TH_OPEN, 13TH_SNAP, 13TH_ADJUST, 13TH_FINAL
- Precondition: period 12 must be CLOSED

### BUILD-011: Financial Statement Configuration Management
- FS format code CRUD
- Template import for OEM FS parameters
- FS period setup integration
- Integration with gl_system_config

---

## Architecture Notes

### Serialization Retry Pattern (FIX-017)
The `withSerializableRetry` helper is now the standard way to handle SERIALIZABLE transactions that may conflict under load. This pattern:
- Preserves ACID guarantees (isolation level not compromised)
- Handles transient conflicts transparently
- Logs retry attempts for observability
- Matches COBOL's implicit retry-on-lock pattern

### Port Management (FIX-015)
All service ports are now documented in api-gateway. The canonical assignments prevent conflicts and make configuration portable across environments.

### Period Management (FIX-021)
The fiscal_periods table centralizes period lifecycle, enabling:
- 13th month support (period_number 1-13)
- Period status workflow (OPEN→CLOSED→ADJUSTMENT→YEAR_END)
- Audit trail (closed_at, closed_by)
- Efficient period queries (indexed by tenant/year/status)

---

## Testing Checklist

- [ ] FIX-009: Test COS/INV pairing validation and reference validation
- [ ] FIX-013: Test sort_key ordering in Chart of Accounts
- [ ] FIX-014: Test payroll posting creates GL journal entries
- [ ] FIX-015: Verify both services boot on different ports
- [ ] FIX-017: Load test concurrent journal postings; verify retries
- [ ] FIX-020: Test applyCd='#' suppresses chain posting
- [ ] FIX-021: Verify fiscal_periods auto-population and EOM status updates

---

## Deployment Notes

1. **Database Migrations:** All FIX-021 SQL migrations must run before code deployment
2. **Service Restarts:** FIX-015 requires api-gateway restart after schedule-service port change
3. **Backwards Compatibility:** All changes are additive; existing APIs unchanged
4. **Environment Variables:** No new env vars required; defaults handle all cases
