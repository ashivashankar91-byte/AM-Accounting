# COBOL Extraction: 13thmenu.cbl

**Program ID**: 13THMENU  
**Size**: 2580 lines  
**Purpose**: Accounting 13th Month Menu (ACC-1822). Sub-menu invoked after the 12th fiscal month EOM close. Allows review, reporting, and finalization of the 13th period (year-end adjustments).

---

## Preconditions

Before the menu is shown, the program validates:

1. **GL snapshot exists**: `ls /acct/files{co}/gl{basepath}13thmonth????` — must find exactly one match. The year portion of the filename is stored as `LAST-YEAR-CLOSED-ON-AM`.
2. **Year matches**: `ACSYS-LSTCLOS-YEAR` must equal `LAST-YEAR-CLOSED-ON-AM` or `+1`.
3. **13th month source**: Must be configured in gear (`GLOBAL-13TH-MONTH-SOURCE`). Must exist in source file with `RESERVED-FOR-13TH-MONTH` flag.
4. **Year-end source**: Must exist in source file with `RESERVED-FOR-YEAR-END` flag.

If any check fails → error message, go to EOJ (no menu shown).

---

## File Path Override

On successful validation, the LINK-RECORD's file paths are **overridden** with snapshot filenames:

```
GL-FILENAME  →  /acct/files{co}/gl{base}13thmonthYYYY   (snapshot)
SCHED-FILENAME  →  /acct/files{co}/sched{base}13thmoYYYY  (snapshot, if exists)
DETAIL-FILENAME →  /acct/files{co}/detail{base}13thmoYYYY (snapshot, if exists)
```

All programs called from this menu receive these overridden paths via LINK-RECORD. This is how 13th month programs "see" the snapshot data instead of live data.

---

## Fiscal Year Support (ACC-2105)

For non-January fiscal year dealers:
```
GLOBAL-12TH-FISCAL-MONTH = ACSYS-1ST-MONTH - 1  (or 12 if result < 1)
GLOBAL-11TH-FISCAL-MONTH = GLOBAL-12TH-FISCAL-MONTH - 1  (or 12 if result < 1)
```

`GLOBAL-13TH-LAST-CLOSED-MONTH` set to `LAST-YEAR-CLOSED-ON-AMX + GLOBAL-11TH-FISCAL-MONTH + 31` (adjusted to valid month-end date).

This overrides `ACSYS-LSTCLOS-DATE` globally for all called programs.

---

## Menu Options

| Option # | Description | Implementation |
|----------|-------------|----------------|
| 1 | Enter/Edit Transactions | Java UI (ThirteenthMonthPendingTransactionsComposite) |
| 2 | Financial Statement | Java (was COBOL finstmt) |
| 3 | Trial Balance | Java (was COBOL trialpr) |
| 4 | General Ledger Print | Java (was COBOL glprint) |
| 5 | Transaction Journal | Java (was COBOL motranpr) |
| 6 | Print Schedules | COBOL `schedprn` (requires snapshot sched/detail files) |
| 7 | Submit FS to MFG | COBOL `CALL-STAR` (Chrysler/FI/Other manufacturer) |
| 8 | Finalize and Archive | COBOL `FINALIZE-13TH` → archives to DocMate/Warehouse |

---

## Option 6: Print Schedules (ACC-3085)

- Requires `GLOBAL-OK-13TH-MONTH-SCHEDULES = TRUE` (snapshot sched+detail files found)
- Calls `schedprn` with `WS-ANDIS-DETSUM = "S"` (summary mode) and `WS-ANDIS-PRNTARCH = "B"` (print+archive)
- If snapshot not available → error "Not available for this year"

---

## Option 7: Submit FS to MFG (CALL-STAR)

- Reads FSS-TABLE (up to 15 FS setups from `getfssetup.ws`)
- For each FS: determines MFG type (Chrysler=CH, Finance=FI, Other=OTH)
- Calls appropriate FS transmit program for each active MFG type
- Chrysler dealer code: looked up from DB (ACC-3997)

---

## Option 8: Finalize (FINALIZE-13TH)

- Sets `GLOBAL-13TH-FINAL-IS-IN-PROGRESS = TRUE`
- For each FS in FSS-TABLE:
  - Archives FS report to DocMate/Warehouse (via `ftp.archam` shell script or Java warehouse path)
  - Archives other 13th month reports (trial balance, GL, transaction journal, schedules)
- SEL-ARCH-* flags default "Y" (always archive, ACC-3676)
- SEL-PRNT-* flags default "N" (no print unless user requests, ACC-11957 removed direct print option)
- After archiving: marks 13th month as finalized in DB

---

## Global Flags

| Flag | Set By | Effect |
|------|--------|--------|
| `GLOBAL-13TH-IS-IN-PROGRESS` | Set TRUE on entry | All called programs know 13th month context |
| `GLOBAL-13TH-FINAL-IS-IN-PROGRESS` | Set TRUE on option 8 | Triggers archive mode in finstmt/fssupp calls |
| `GLOBAL-13TH-LAST-CLOSED-MONTH` | Set in GET-LASTCLOSE-DATE | Overrides last-closed for all called programs |
| `GLOBAL-OK-13TH-MONTH-SCHEDULES` | Set if snapshot sched files found | Enables option 6 |
| `GLOBAL-NO-13TH-MONTH-SCHEDULES` | Set if snapshot sched files NOT found | Disables option 6 |

---

## addglto13th.cbl Integration (ACC-2466)

After finding the GL snapshot file, calls `addglto13th` to copy any GLs that were added to the live GL file after the snapshot was taken:

```
runcobol85.ori ../../acct/prog/addglto13th K A="{ADDGLTO13TH-DATA}"
```

Where `ADDGLTO13TH-DATA` contains:
- `ADDGLTO13TH-GL-FILENAME` — path to 13th month snapshot GL file
- `ADDGLTO13TH-2ND-GL-FILENAME` — path to live GL file

---

## TypeScript Architecture Decision

**13th month = `periodMonth = 13` in same Postgres tables.** No separate snapshot files.

- All GL, journal, schedule, and detail data stored with `periodMonth` column
- 13th month entries: `periodMonth = 13`, `periodYear = YYYY`
- Standard GL entries: `periodMonth = 1-12`
- `GLOBAL-13TH-IS-IN-PROGRESS` = query filter `periodMonth = 13`
- Snapshot file lookup → eliminated
- `addglto13th.cbl` → eliminated (no separate files to sync)
- `syncglsched13th.cbl` → eliminated (same tables, FK constraints handle it)

### API Equivalents

```
GET  /api/v1/eom/thirteenth-month/status
     → { year, isFinalized, hasTransactions, schedulesAvailable, lastClosedDate }

POST /api/v1/eom/thirteenth-month/close
     Body: { year: number }
     → Opens 13th period (sets canPost=true for periodMonth=13)

POST /api/v1/eom/thirteenth-month/finalize
     Body: { year: number }
     → Closes 13th period, archives reports, sets isFinalized=true

GET  /api/v1/gl/accounts/:code/inquiry?periodMonth=13&periodYear=YYYY
     → Existing GL inquiry endpoint, filtered to 13th month data

POST /api/v1/gl/transaction-batches/:source/:date/post?periodMonth=13
     → Existing post endpoint, allowed when 13th period is open
```

---

## ELIMINATED Logic

- Snapshot file management (`gl13thmonthYYYY`, `sched13thmoYYYY`, `detail13thmoYYYY`) → eliminated
- Global flag overrides for file paths → replaced by `periodMonth=13` query param
- FS submission (CALL-STAR) → handled by separate FS service (future wave)
- DocMate archiving (ftp.archam) → handled by document-service (future wave)
- Fiscal month calculations → `FiscalCalendar` utility from eom-service
