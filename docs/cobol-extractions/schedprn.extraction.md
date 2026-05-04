# Extraction: schedprn.cbl

**Decision: BUILD** — Report generator becomes JSON API + optional PDF/text export.

---

## Source

`acct/src/schedprn.cbl` — 222,341 bytes (5,075 lines, procedure division from line 1,073, fully analysed)

---

## Summary

`schedprn` is the Schedule Print Report program. It reads DETAIL-MF, SCHEDULE-FILE, VEHICLE-DATABASE, and NAME-DATABASE to produce formatted schedule reports. It is invoked from:
1. **Menu program 21** — interactive user-initiated print
2. **EOM purge** (`purge.cbl`) — automated end-of-month report before purge (`WS-ANDIS-PGM = "purge   "`)
3. **13th-month menu** — special year-end report with snapshot files
4. **Doc/Mate archival** — called to generate archived schedule reports

The report can cover a **single schedule** or **all schedules** (`SCHEDNO = 00`). It supports detail and summary modes, date cut-off filtering, and four sort sequences.

---

## Report Modes

### Format: Detail vs. Summary

| Value | Meaning |
|-------|---------|
| `TYPE-SUM = "D"` | Detail — show individual transaction lines |
| `TYPE-SUM = "S"` | Summary — show control number totals only |

### Zero-balance filtering

| Value | Meaning |
|-------|---------|
| `TYPE-BAL = "Y"` | Include zero-balance control numbers |
| `TYPE-BAL = "N"` | Exclude zero-balance control numbers (default) |

### Sort sequences (SD-RPT-SEQ)

| Code | Description |
|------|-------------|
| `C` | By control number (default) |
| `N` | By control name (requires name database lookup) |
| `A` | By age (oldest transaction first — for type 3 AR aging only) |

### Date cut-off

`CUT-DATE (YYYYMMDD)`: transactions with dates AFTER this date are excluded. If latest detail date exceeds the cut-off, a warning is printed on the total page.

---

## Report Structure (by schedule type)

### Type 1 — Source/Reference detail
Columns: `CONT#`, `DATE`, `SR` (source), `REF#` (12-char), `DESC` (15-char), then up to 5 GL amount columns.
Total line: control number total per GL column.

### Type 2 / 4 — Date-keyed with aging
Same column structure as Type 1 but keyed by control number + date.
Balance-forward records printed separately with aging bucket amounts: `CUR`, `OVR30`, `OVR60`, `OVR90`.

### Type 3 — AR aging with age calculation
Shows control number, date, amount, and **age in days** (using Julian day calculation).
Age calculated as: `(CUT-JUL-DAYNO - transaction-date-julian)`.
Totals include GL column subtotals + grand total.

### Type 5 — Apply-to detail with subtotals
Lines show: `CONT#`, apply-to number (`APPLYNO`), apply-code, source, description.
Optional subtotals per apply-to group (controlled by `INCL-TYPE5-SUBTOT = "Y"`).
Balance-forward records have `apply-cd = "!"`.

---

## Processing Algorithm

### Housekeeping (1000)
1. Determine call context (EOM purge / 13th month / interactive).
2. Load schedule type table into memory (scan entire SCHEDULE-FILE: `WS-SD-TYPE[schedNo]`).
3. Load GL REQ-CONTNO flags for first GL on each schedule.
4. Scan DETAIL-MF to find latest transaction date per schedule (for out-of-balance warning).
5. Build vehicle info index (GETDBVEHINFO) from DETAIL-MF stock numbers.

### Screen input (1050) — interactive only
User enters:
- Schedule number (00 = all)
- Detail/Summary toggle
- Zero-balance toggle
- Date cut-off (MM/DD/YYYY)
- Sort sequence override (optional)

### Print loop — all schedules (3000)
```
For each schedule (ascending schedule number):
  READ SCHEDULE-FILE next record
  Check security: user has access to this schedule?
  Build TMP-DETAIL-MF temp file (subset of DETAIL-MF for this schedule, up to cut-date)
  Build TMP-DET-TOT totals file
  Print report from temp files
  Delete temp files
```

### Print loop — selected schedules (5000)
Same as above but iterates over user-selected schedule numbers (up to 12).

### Temp detail file build
For each DETAIL-MF record ≤ CUT-DATE:
1. Compute control name via NAME-DATABASE or VEHICLE-DATABASE lookup (if `SD-CONT-NAMES` flag set).
2. Write to TMP-DETAIL-MF with enriched fields: `TDE-CNAME` (25-char name), `TDE-CN-NAME2` (line 2), `TDE-CN-PHONE` (phone).
3. For sort=N: key includes `TDE-CNAMEX = TDE-CNAME + TDE-CNAME-CONTNO` for name-ordered access.

### Totals accumulation
TMP-DET-TOT record per control number holds:
- `TDT-CNTBAL[1..5]`: running balance per GL column (up to 5 accounts on types 1/3)
- `TDT-AGE-DAYS`: age of oldest transaction (for type 3 age sort)
- `TDT-VEH-STATUS`: vehicle status code

---

## Control Name Lookup Rules (SD-CONT-NAMES flag)

| Flag | Lookup Source |
|------|--------------|
| `Y` / `2` | NAME-DATABASE by control number (`NA-IDNO = contno`) |
| `D` | DEAL file → `DL-NA-IDNO` → NAME-DATABASE for deal owner |
| `V` | VEHICLE-DATABASE by stock number → VIN + Year/Make/Model |
| `S` | VEHICLE-DATABASE last 6 of VIN |
| blank / `N` | No name lookup — print control number only |

For vehicle schedules: if multiple vehicle records exist for same stock#, use the last one with `VH-ACCT-FLAG = "Y"` or `VH-INV-FLAG = "Y"` (most recently added if no flag set).

---

## EOM Context (called from purge.cbl)

When `WS-ANDIS-PGM = "purge   "`:
- SCHEDNO(1) = "00" (all schedules)
- TYPE-SUM = WS-ANDIS-DETSUM (D=detail, S=summary)
- CUT-DATE = EOM close date
- SCH-SEQ = "C" (by control number)
- Report is written to a temp file for Doc/Mate archiving
- Print preview mode (no direct printer output)

---

## Out-of-Balance Warning

If the latest transaction date in DETAIL-MF for a schedule exceeds the CUT-DATE, a disclaimer is printed on the total page:

```
WARNING: Transactions with dates after MM/DD/YYYY have been excluded.
         The schedule total may not agree with the general ledger.
```

---

## Security Check

Before printing each schedule:
- Read user's SS record from TABLES-FILE (same structure as `schedsec.cbl`).
- Check `TB-SS-ACCESS(scheduleNumber) = "Y"`.
- For schedule 00 (all): check access for every schedule being printed.
- MIS password or super-password bypasses security.

---

## TypeScript Replacement

### `ScheduleReportService` (application layer)

```typescript
interface ScheduleReportRequest {
  tenantId: string;
  userId: string;
  scheduleNumber?: string;   // null/undefined = all schedules
  format: 'DETAIL' | 'SUMMARY';
  includeZeroBalance: boolean;
  cutoffDate: Date;
  sortSequence?: 'C' | 'N' | 'A';
  includeApplySubtotals?: boolean;   // type 5 only
}

interface ScheduleReportLine {
  scheduleNumber: string;
  controlNumber: string;
  controlName?: string;
  date?: Date;
  source?: string;
  referenceNumber?: string;
  description?: string;
  amounts: Prisma.Decimal[];   // up to 5 per GL column
  ageDays?: number;
  applyNumber?: string;
  applyCd?: string;
  isBalanceForward: boolean;
  agingBuckets?: {
    current: Prisma.Decimal;
    over30: Prisma.Decimal;
    over60: Prisma.Decimal;
    over90: Prisma.Decimal;
  };
}

interface ScheduleReportTotal {
  scheduleNumber: string;
  controlNumber: string;
  glTotals: Prisma.Decimal[];
  overallTotal: Prisma.Decimal;
  transactionCount: number;
  hasDateWarning: boolean;   // latest date > cutoffDate
}

interface ScheduleReport {
  generatedAt: Date;
  cutoffDate: Date;
  format: 'DETAIL' | 'SUMMARY';
  schedules: {
    schedule: Schedule;
    lines: ScheduleReportLine[];
    totals: ScheduleReportTotal[];
    grandTotal: Prisma.Decimal;
    isOutOfBalance: boolean;
  }[];
}

class ScheduleReportService {
  async generateReport(req: ScheduleReportRequest): Promise<ScheduleReport>
  async generateScheduleSummary(tenantId: string, scheduleNumber: string, cutoffDate: Date): Promise<ScheduleReportTotal>
}
```

### API endpoints

```
GET /api/v1/schedules/:id/report          — detail or summary JSON report
GET /api/v1/schedules/:id/report/summary  — summary totals only
```

Query params: `cutoffDate`, `format=DETAIL|SUMMARY`, `includeZeroBalance=true|false`, `sort=C|N|A`

### Age calculation

```typescript
// COBOL uses julian2.prc for day count
function ageDays(transactionDate: Date, cutoffDate: Date): number {
  const ms = cutoffDate.getTime() - transactionDate.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}
```

### Vehicle / name enrichment
Control name lookup is deferred to a future wave — the report API returns `controlName: null` initially. The flag `SD-CONT-NAMES` is persisted in the Schedule record and will drive lookups via vehicle-service / name-service calls in a follow-on wave.

---

## Traceability

- **COBOL program**: `acct/src/schedprn.cbl`
- **TypeScript location**:
  - Application: `amacc/services/schedule-service/src/application/schedule-report-service.ts`
  - Routes: `amacc/services/schedule-service/src/http/routes.ts`
  - Tests: `amacc/services/schedule-service/src/tests/test-schedule-service.ts`
