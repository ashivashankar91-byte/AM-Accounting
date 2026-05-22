# Wave 4 Gap Analysis: 13th Month + Inquiry & Reports

**Date**: Wave 4  
**Programs**: 13thmenu.cbl, addglto13th.cbl, syncglsched13th.cbl, inquiryn.cbl, inqtran.cbl, tranpr.cbl, transumm.cbl  
**Target Services**: gl-service (extensions), eom-service (extensions)

---

## Part 1: 13th Month

### What COBOL Does

- Takes a snapshot of the GL file at the end of the 12th fiscal month
- The snapshot file (`gl13thmonthYYYY`) is the "13th period" data store
- All 13th month programs read/write this snapshot instead of the live GL file
- LINK-RECORD file path overrides make called programs transparent to the difference
- At finalization: archives reports to DocMate, marks as complete, resets for next year

### TypeScript Architecture: `periodMonth = 13`

**Key decision**: No snapshot files. The 13th period is just another row filter: `periodMonth = 13, periodYear = YYYY`.

All existing GL, journal, schedule, and detail tables already have `periodYear` and `periodMonth` columns (or equivalent). The 13th month data lives alongside regular monthly data.

### What NEEDS TO BE BUILT (eom-service)

#### Schema additions (eom-service `prisma/schema.prisma`)

The `EomClose` model (or `PeriodStatus` if that exists) needs a `periodMonth` field supporting 1–13:

```prisma
model PeriodStatus {
  id           String   @id @default(cuid())
  tenantId     String
  periodYear   Int
  periodMonth  Int      // 1-12 for regular months, 13 for 13th month
  isOpen       Boolean  @default(false)
  isClosed     Boolean  @default(false)
  isFinalized  Boolean  @default(false)
  openedAt     DateTime?
  closedAt     DateTime?
  finalizedAt  DateTime?
  lastClosedDate String? // YYYYMMDD — overrides ACSYS-LSTCLOS-DATE for this period
  
  @@unique([tenantId, periodYear, periodMonth])
}
```

#### Service methods

**`EomService.open13thMonth(tenantId, year)`**:
- Validates `periodMonth=12` for that year is closed
- Creates `PeriodStatus` record with `periodMonth=13, isOpen=true`
- Emits `THIRTEENTH_MONTH_OPENED` event

**`EomService.get13thMonthStatus(tenantId, year)`**:
- Returns `PeriodStatus` for `periodMonth=13, periodYear=year`
- Includes: `isOpen`, `isClosed`, `isFinalized`, `lastClosedDate`, `hasTransactions`

**`EomService.close13thMonth(tenantId, year)`**:
- Validates `periodMonth=13` is open
- Validates no pending (unposted) transactions for this period
- Sets `isClosed=true`, `closedAt=now()`
- Emits `THIRTEENTH_MONTH_CLOSED` event

**`EomService.finalize13thMonth(tenantId, year)`**:
- Validates `periodMonth=13` is closed
- Sets `isFinalized=true`, `finalizedAt=now()`
- Emits `THIRTEENTH_MONTH_FINALIZED` event (triggers downstream: archive service, FS submission)

#### API Endpoints

```typescript
GET  /api/v1/eom/thirteenth-month/status?year=YYYY
     → PeriodStatusDto

POST /api/v1/eom/thirteenth-month/open
     Body: { year: number }
     → PeriodStatusDto

POST /api/v1/eom/thirteenth-month/close
     Body: { year: number }
     → PeriodStatusDto

POST /api/v1/eom/thirteenth-month/finalize
     Body: { year: number }
     → PeriodStatusDto
```

### ELIMINATED Logic

| COBOL | TypeScript Replacement |
|-------|----------------------|
| Snapshot files `gl13thmonthYYYY` | `periodMonth=13` in same tables |
| `addglto13th.cbl` | Not needed — new GL accounts auto-included |
| `syncglsched13th.cbl` | Not needed — FK constraints ensure consistency |
| LINK-RECORD file path override | `periodMonth` query parameter in service calls |
| `GLOBAL-13TH-IS-IN-PROGRESS` flag | `PeriodStatus.isOpen` check in middleware |
| `GLOBAL-13TH-LAST-CLOSED-MONTH` | `PeriodStatus.lastClosedDate` |
| DocMate archiving | document-service (future wave) |
| FS submission (CALL-STAR) | fs-submission-service (future wave) |
| Fiscal year month calculation | `FiscalCalendar` utility (already in eom-service) |

---

## Part 2: GL Inquiry & Reports (gl-service extensions)

### What COBOL Does

Five COBOL programs provide inquiry and reporting against the GL data:

| Program | Purpose |
|---------|---------|
| `inquiryn.cbl` | Interactive GL account and schedule inquiry (5 type codes) |
| `inqtran.cbl` | Transaction history lookup by source+refno |
| `tranpr.cbl` | Transaction journal preview/print for unposted batches |
| `transumm.cbl` | Autopost summary report |

### What EXISTS in gl-service

- `GlTransaction` table: unposted and posted transactions
- `JournalEntry` / `JournalSummary` table: per-account monthly totals (from Wave 1 gl-service build)
- `GlAccount` table: account master data
- `POST /api/v1/gl/transactions/post` — posts a batch (Wave 1)

### What NEEDS TO BE BUILT (gl-service)

#### GL Account Inquiry (inquiryn modes 1-5)

```typescript
GET /api/v1/gl/accounts/:code/inquiry
  Query: typeCode=1|2|3|4|5, source?, contno?, fromDate?, toDate?, periodMonth?, periodYear?
```

| typeCode | Data Source | Filter |
|----------|------------|--------|
| 1 | `JournalSummary` | Current period (year+month from lastCloseDate+1) |
| 2 | `GlTransaction` | postedAt IS NOT NULL AND transactionDate > lastCloseDate |
| 3 | `JournalSummary` | Prior periods |
| 4 | `GlTransaction` | postedAt IS NOT NULL AND transactionDate ≤ lastCloseDate |
| 5 | `GlTransaction` | source=? AND controlNumber=? AND transactionDate BETWEEN ? AND ? |

Response type: `JournalSummaryLine[]` (types 1,3) or `TransactionLine[]` (types 2,4,5)

#### Transaction History (inqtran)

```typescript
GET /api/v1/gl/history
  Query: source, refno, fromDate?, toDate?, accountCode?
```

Searches `GlTransaction` by `(source, referenceNumber)`. Returns `HistoricalTransaction[]`.

#### Schedule Inquiry (inquiryn schedule mode)

```typescript
GET /api/v1/gl/schedules/:scheduleId/inquiry
  Query: contno?, groupBy=control|apply|none, periodMonth?, periodYear?
```

Returns `ScheduleDetailLine[]` with aging buckets calculated from `transactionDate` vs current date.

Aging bucket calculation:
```typescript
function getAgingBucket(transactionDate: Date, referenceDate: Date): 0|1|2|3|4 {
  const age = differenceInDays(referenceDate, transactionDate);
  if (age <= 0) return 0;     // Current
  if (age <= 30) return 1;    // 30 days
  if (age <= 60) return 2;    // 60 days
  if (age <= 90) return 3;    // 90 days
  return 4;                   // 120+ days
}
```

#### Transaction Journal (tranpr)

```typescript
GET /api/v1/gl/transaction-batches
  Returns: UnpostedBatch[] — list of all batches with (source, date, status, documentCount)

GET /api/v1/gl/transaction-batches/:source/:date/journal
  Returns: TransactionJournalLine[] (detail)
  Query: ?format=detail|summary

GET /api/v1/gl/transaction-batches/:source/:date/totals
  Returns: { totalDebits, totalCredits, balance, grossProfit, grossProfitPct, documentCount }
```

#### Autopost Summary (transumm)

```typescript
GET /api/v1/gl/reports/autopost-summary
  Query: ?choice=1|2  (1=prior dates, 2=today)
  Returns: AutopostSummaryReport

POST /api/v1/gl/reports/autopost-summary/acknowledge
  Body: { date: string }  // marks prior-day records as summarized
```

---

## Schema Additions Required (gl-service)

### `GlTransaction` additions

Check if these fields exist; add if not:

```prisma
autopostSource        String?    // "**" for auto-posted records
autopostDate          DateTime?  // date of auto-post batch
autopostSummarizedAt  DateTime?  // set when Choice 1 summary is run
```

### `JournalSummary` model (verify structure)

Should have:
```prisma
tenantId     String
accountCode  String
periodYear   Int
periodMonth  Int    // 1-13
source       String
balance      Decimal @db.Decimal(15,2)
unitCount    Int
```

---

## COBOL vs TypeScript Capability Comparison

| Feature | COBOL | TypeScript |
|---------|-------|-----------|
| Aging buckets | Julian day arithmetic | `date-fns differenceInDays` |
| Control# sort | ISAM sort file in /tmp | `ORDER BY CAST(controlNumber AS INT)` |
| GLbyID translation | File lookup | Prisma JOIN on `GlAccount.accountId` |
| Vehicle cross-ref | `romf` file + `vehicdb` | vehicle-service (future wave) |
| Journal source security | File-based `gettable` | JWT role + `JournalSourcePermission` table |
| 5000-entry GL table | In-memory array | Prisma GROUP BY |
| Print formatting (132-char) | COBOL print lines | Deferred to report service (future wave) |

---

## Risk Flags

- **Journal source security**: `inquiryn.cbl` and `inqtran.cbl` check `WS-JRSRC-ACCESS` per source. Need `JournalSourcePermission` table or role-based check in gl-service.
- **`periodMonth=13` support**: gl-service schema must support `periodMonth` 1–13 for all relevant models.
- **Schedule aging**: The `ScheduleDetail.transactionDate` field must be available for aging calculation. Verify it exists in schedule-service schema.
- **Autopost soft-delete**: Choice 1 of transumm "deletes" records — use `autopostSummarizedAt` soft delete, never hard delete.
