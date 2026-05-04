# Wave 2 Gap Analysis: Period Close (EOM + Year-End)

**Author:** GitHub Copilot (COPILOT.md protocol — Wave 2)  
**Date:** 2025  
**COBOL Programs Analysed:** purge.cbl, caaccteom.cbl, eomsync.cbl, reseteom.cbl, yrend.cbl, caaccteoy.cbl, pushunposted.cbl, clearunposted.cbl  
**Existing Service:** `amacc/services/eom-service`

---

## 1. What the Existing eom-service Gets Right

| Feature | Status | Notes |
|---------|--------|-------|
| `EOMClose` + `EOMStep` Prisma models | ✅ Correct | Unique constraint `[tenantId, periodYear, periodMonth]` matches COBOL single-close invariant |
| Step-by-step orchestration via `EOMOrchestrator` | ✅ Correct | Strategy pattern with `IStepHandler` per step |
| Retry logic on blocked steps | ✅ Correct | `retryStep()` finds BLOCKED step and increments retry count |
| Optimistic step advance (`advanceStep`) | ✅ Correct | Step found, executed, result used to update status |
| `EOM_STEP_CHANGED` outbox event | ✅ Correct | Published after every step change |
| JWT auth middleware | ✅ Present | Uses `authMiddleware` |

---

## 2. What Is Missing Entirely

### 2.1 Year-End Close — NOT IMPLEMENTED
**Severity: Critical**  
There is no `yearEndClose()` method, no `YEAR_END` close type, no `YearEndRecord` idempotency model, and no `POST /year-end` route.  
This is the most significant capability gap in the entire Wave 2 scope.

**COBOL source:** `yrend.cbl`  
**Required:** See `yrend.extraction.md` for all 9 invariants.

### 2.2 Close Precondition Checks — NOT IMPLEMENTED
**Severity: Critical**  
`initiateClose()` creates an `EOMClose` record immediately with no validation. In COBOL, `purge.cbl` enforces 5 preconditions before writing a single byte.

Missing checks:
- `INV-EOM-01`: Is another close already in progress for this period? (DB constraint catches this but gives no human-readable error)
- `INV-EOM-03`: Are there unposted journal entries in this period?
- `INV-EOM-04`: If this is the first fiscal month, are all P&L accounts zeroed (year was closed)?
- `INV-EOM-05`: If this is the 11th fiscal month, is the prior year's 13th month finalized?

### 2.3 EOM Close Preview — NOT IMPLEMENTED
**Severity: High**  
No `previewMonthEnd()` method or `GET /preview` route exists. This is an intelligence addition over COBOL that shows the operator what will be blocked before they start the close.

Required response shape:
```typescript
{
  canClose: boolean;
  blockingConditions: BlockingCondition[];
  unpostedBatchCount: number;
  plAccountBalances: { accountId: string; balance: number }[];  // for year-end preview
  expectedGlImpact: GlImpactSummary;
}
```

### 2.4 Reset Endpoint — NOT IMPLEMENTED
**Severity: Medium**  
The COBOL `reseteom.cbl` had a command-line equivalent for manual recovery. There is no `POST /:id/reset` admin endpoint.

### 2.5 `EOMClose.closeType` Not Used
**Severity: Medium**  
The `EOMClose.closeType` field exists in the type definitions (`EOMCloseType`) and is written as `'MONTHLY'` hardcoded. There is no handling for `'YEAR_END'` close type which would trigger different step handlers.

### 2.6 13th Month Snapshot — NOT IMPLEMENTED
**Severity: Medium**  
`purge.cbl` creates 13th-month copies of GL, schedule, and detail files when closing the 12th fiscal month (`INV-EOM-07`). There is no equivalent snapshot logic.

---

## 3. What Is Implemented But Wrong

### 3.1 Tenant ID Fallback to 'tenant-kunes' — SECURITY DEFECT
**Severity: High**  
`routes.ts`, line 8:
```typescript
const id = request.headers['x-tenant-id'] as string || 'tenant-kunes';
```
If the `x-tenant-id` header is missing, the request is processed as if it belongs to the `tenant-kunes` tenant. This allows unauthenticated cross-tenant data access — any caller without a tenant header can read/write `tenant-kunes` data.  
**Fix:** Return HTTP 401 if `x-tenant-id` is missing or empty.

### 3.2 JWT Secret Fallback in Production — SECURITY DEFECT
**Severity: High**  
`routes.ts`, line 19:
```typescript
const JWT_SECRET = process.env['AMACC_JWT_SECRET'] ?? 'amacc-dev-secret-change-in-production';
```
If the environment variable is not set, the service uses a hardcoded secret. This means a deployed service with a missing env var accepts JWTs signed with the well-known fallback secret.  
**Fix:** Throw a startup error if `AMACC_JWT_SECRET` is not set.

### 3.3 Step Codes Are Wrong
**Severity: High**  
The `EOM_STEPS` array uses step codes `062, 065, 068, 071, 074, 077` which appear to be inventory/parts/service domain step codes, not accounting EOM steps. The COBOL `purge.cbl` tracks steps `010, 020, 025, 062, 065, 068, 070, 100, 200, 300`.

The step handlers must match the COBOL ACSYS-TRACK-EOM sequence documented in `purge.extraction.md`.

### 3.4 No Precondition Validation Before Close Creation
**Severity: High**  
`initiateClose()` calls `this.closeRepo.create()` immediately. If preconditions fail partway through, the EOMClose record is orphaned in `IN_PROGRESS` state and the unique constraint prevents creating a new valid close.  
**Fix:** Validate all preconditions before creating the record; or create in `NOT_STARTED` state and transition to `IN_PROGRESS` only after preconditions pass.

---

## 4. NET-NEW Intelligence — Things COBOL Never Had

| Capability | Description |
|-----------|-------------|
| **EOM Preview** | `previewMonthEnd()` — returns blocking conditions, unposted counts, expected GL impact — before any writes |
| **Resumable Steps** | Each step idempotent; resume from `lastCompletedStep + 1`; COBOL had to restart from scratch |
| **Year-End Preview** | `previewYearEnd()` — shows which P&L accounts will be zeroed and the retained earnings amount |
| **Audit Trail** | `EOMClose.initiatedByUserId`, `closedByUserId`, `resetByUserId` — COBOL had no user attribution |
| **Multi-Tenant Safety** | Different tenants can run EOM simultaneously; COBOL was single-company per server |
| **Outbox Events** | `MONTH_END_COMPLETED`, `YEAR_END_COMPLETED` — async, reliable; COBOL eomsync was synchronous fire-and-forget |
| **Stuck Batch API** | `journalBatch` lifecycle management replaces `clearunposted.cbl`'s retry-spin-lock mechanism |
| **Line Count Pre-flight** | For year-end: count P&L accounts before TX; COBOL could hit the 9999 LINENO limit mid-write |

---

## 5. Required Prisma Schema Changes

### New Models

```prisma
model YearEndRecord {
  id           String    @id @default(uuid())
  tenantId     String    @map("tenant_id")
  fiscalYear   Int       @map("fiscal_year")
  closedAt     DateTime  @map("closed_at")
  initiatedBy  String    @map("initiated_by")
  
  @@unique([tenantId, fiscalYear])
  @@map("year_end_records")
}
```

### Modified Models

**`EOMClose`** — add fields:
- `closeType String @default("MONTHLY")` — distinguish MONTHLY from YEAR_END
- `initiatedBy String?` — audit trail
- `resetAt DateTime?` — when admin reset was performed
- `resetBy String?` — who performed the reset

---

## 6. Required eom-service.ts Changes

### New Methods
1. `checkPreconditions(tenantId, year, month)` — validates INV-EOM-01 through INV-EOM-05
2. `previewMonthEnd(tenantId, year, month)` — returns readiness state without writing
3. `yearEndClose(tenantId, fiscalYear, initiatedBy)` — full year-end close
4. `previewYearEnd(tenantId, fiscalYear)` — returns P&L balances, RE account info
5. `resetClose(closeId, tenantId, resetByUserId)` — admin reset for steps < 100

### Modified Methods
1. `initiateClose()` — must call `checkPreconditions()` first
2. Step codes in `EOM_STEPS` — must match COBOL ACSYS-TRACK-EOM sequence

### Security Fixes
1. `getTenantId()` — return 401 if `x-tenant-id` missing
2. JWT_SECRET — fail startup if not set

---

## 7. COBOL Decision Summary

| Program | Decision | Reason |
|---------|----------|--------|
| purge.cbl | FIX + EXTEND | Spine of EOM close; partially implemented; needs preconditions + all steps |
| caaccteom.cbl | SKIP | Java UI bridge; replaced by REST API |
| eomsync.cbl | SKIP | HTTP sync trigger; replaced by outbox event |
| reseteom.cbl | SKIP | CLI reset; replaced by admin endpoint |
| yrend.cbl | BUILD | Year-end close; entirely missing from eom-service |
| caaccteoy.cbl | SKIP | Java UI bridge (with PROGRAM-ID bug); replaced by REST API |
| pushunposted.cbl | SKIP | FileWatcher bridge; replaced by direct DB query |
| clearunposted.cbl | SKIP | ISAM lock recovery; replaced by PostgreSQL journalBatch lifecycle |
