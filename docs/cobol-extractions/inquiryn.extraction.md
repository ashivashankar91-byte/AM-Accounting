# COBOL Extraction: inquiryn.cbl

**Program ID**: INQUIRYN  
**Size**: 2729 lines  
**Purpose**: Primary GL/Schedule Inquiry program. Entry points: Program 31 (Options G and S), and Program 1 F4 (GL account from posting screen). Three modes: GL account inquiry, Schedule inquiry, Transaction inquiry (delegates to inqtran).

---

## Entry Modes

Determined by `CHOICE` in LINK-RECORD:
- `G` — GL Account inquiry
- `S` — Schedule inquiry
- `T` — Transaction inquiry (calls `inqtran` directly)

Also called from F&I (`FROM-PROG = "F"`), schedule posting (`FROM-PROG = "S"`), etc.

---

## Mode 1: GL Account Inquiry

### TYPE-CD values

| Code | Description | Source File | Key |
|------|-------------|------------|-----|
| 1 | Current month journals by source (MTD totals, YTD balance, units) | `jrn` | JR-ACCTNO + JR-YEAR-MONTH |
| 2 | Unposted (after last close date) transactions by account | `histtran` | HI-ACCTNO |
| 3 | Prior month journals (history) | `jrn` | JR-ACCTNO + prior months |
| 4 | Transactions on or before last close date | `histtran` | HI-ACCTNO |
| 5 | Filtered transactions: source + contno + date range | `histtran` | HI-ACCTNO |

**Journal display** (Type 1/3):  
Reads `jrn` file by account+month. Shows columns: source, MTD balance, YTD balance, unit count.  
Sorted by source within month. Calls `getgldistr` for GL-TYPE=%.

**Transaction display** (Types 2/4/5):  
Reads `histtran` by HI-ACCTNO. Applies filters:
- Type 2: date > ACSYS-LSTCLOS-DATE
- Type 4: date ≤ ACSYS-LSTCLOS-DATE  
- Type 5: source = FILTER-SOURCE and contno = FILTER-CONTNO and date in [FROM-DATE, TO-DATE]

### GLbyID support
When active (GLOBAL-GL-BY-ID-ACTIVE), translates 5-char ACCTNO to longer ACCTID for display. `glbyid` file keyed by `GL-ACCTNO`.

### Vehicle/Name Cross-Reference
- `GL-REQ-CONTNO` drive: `S`=stock#, `6`=last6VIN, `D`=deal lookup via `nameprog`
- Open RO#: Checks `romf` file for each service company sharing vehicdb. Up to 4 open RO#s displayed.

### Journal Source Security
- `WS-JRSRC-ACCESS` table loaded via `gettable`. Entry per source. `"Y"` = access granted.
- Bypassed for F&I and voidck callers.

---

## Mode 2: Schedule Inquiry

### Schedule loading
Reads all `sched` records into `SCHD-TABLE` (up to 99 entries). Security checked via `WS-SS-ACCESS` table (per schedule: `"Y"` = accessible).

### Display by TYPE-CD

| Schedule Type | Display |
|--------------|---------|
| 1 | Groups detail by controlNumber. Sort file in `/tmp` (ISAM, key=CONTRJST). Numerical sort of control numbers. |
| 2 | Aging buckets: Current / 30 / 60 / 90 / 120+ days. Uses `ageDays(transactionDate, lastCloseDate)`. |
| 3 | Detail lines by order read (general purpose). |
| 4 | Aging buckets (same as type 2, but credits-debits). |
| 5 | Groups by applyNumber. Running balance per group. |

**Drill-down**: User enters line number to call `inqtran` popup for that transaction.

**Change ApplyTo#** (Type 5 only): User can inline-edit `DE-APPLYNO` from inquiry screen. Writes back to `detail` file.

### Aging bucket calculation
Buckets: Current (0 days), 30, 60, 90, 120+.
```
age = julianDays(today) - julianDays(transactionDate)
bucket0 = age <= 0
bucket1 = age 1-30
bucket2 = age 31-60
bucket3 = age 61-90
bucket4 = age > 90
```

---

## LINK-RECORD Inputs

- `LINK-COMPNO` — company number
- `CHOICE` — G/S/T
- `FROM-PROG` — caller identifier
- `SCHD-TABLE` — schedule list (passed in, or built internally)
- `GL-REQ-ACCTNO` — for GL mode
- `GL-REQ-TYPE-CD` — inquiry type (1-5)

---

## TypeScript Equivalents

```
GET /api/v1/gl/accounts/:code/inquiry?typeCode=1-5&source=XX&contno=N&fromDate=YYYYMMDD&toDate=YYYYMMDD
  → JournalSummary[] (types 1,3) or TransactionLine[] (types 2,4,5)

GET /api/v1/gl/schedules/:id/inquiry?contno=N
  → ScheduleDetail[] with aging buckets (types 2,4) or grouped by control/apply (types 1,5)

GET /api/v1/gl/history  (delegates to inqtran)
```

---

## ELIMINATED Logic

- ISAM sort file in `/tmp` for control-number ordering → `ORDER BY CAST(controlNumber AS INTEGER)` in Prisma
- Schedule security via `gettable` file → `SchedulePermission` table in Prisma (already in schedule-service)
- Vehicle/RO# cross-reference → delegated to vehicle-service (future wave)
- `nameprog` call for name lookup → delegated to names endpoint
- Journal source security via file-based table → permission check in middleware
