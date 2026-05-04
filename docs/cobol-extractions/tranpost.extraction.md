# COBOL Extraction: tranpost.cbl

**Extracted:** 2025  
**Extracted By:** GitHub Copilot (Wave 1 — COPILOT.md protocol)  
**Status:** Complete

---

## 1. Source

| Field | Value |
|-------|-------|
| File | `acct/src/tranpost.cbl` |
| PROGRAM-ID | `TRANPOST` |
| Lines | 2,751 |
| Last Modified | 2024 (AMMAINT-34350) |
| Copybooks | tran.fc/fd, src.fc/fd, sched.fc/fd, jrn.fc/fd, detail.fc/fd, missdoc.fc/fd, sys.fc/fd, histtran.fc/fd, histtran.rec, gl.rec, getgldesc.ws, getglbyid.lnk, glbyid.rec, getgldistr.lnk, histtransync.lnk |

---

## 2. Purpose

Posts a batch of transaction records to three ISAM files in sequence:

1. **JOURNAL-MF** (`jrn.*`) — Running account balance by GL#/year/month/source
2. **DETAIL-MF** (`detail.*`) — Schedule subsidiary ledger (accounts with a schedule number only)
3. **HISTTRAN-FILE** (`histtran.*`) — Full audit trail, one record per line item

For accounts with a `GL-COS-ACCT` / `GL-INV-ACCT` chain, two additional sets of postings follow (type `C` for cost-of-sale, type `I` for inventory).

If the GL account is a distribution account (`GL-TYPE = "%"`), the amount is split proportionally across multiple GL accounts via `getgldistr`, and each sub-account is posted independently.

---

## 3. Business Invariants

> These are LAWS that the TypeScript replacement must enforce.

### INV-01: Atomic triple-write
**COBOL behavior:** Journal → Detail → Histtran written as three separate ISAM writes with NO transaction wrapper. File I/O errors mid-sequence leave files in an inconsistent state (out-of-balance condition).  
**Known failure:** `fixoobtran.cbl`, `fixorphan.cbl`, `dumpoobtran.cbl`, `sniffbaddetailapplycd.cbl` exist specifically to repair these inconsistencies.  
**TypeScript requirement:** ALL three writes (GL balance update + schedule detail + history record) MUST occur inside a single `$transaction({ isolationLevel: 'Serializable' })`. This eliminates the entire class of OOB failures.

### INV-02: Pre-edit before posting
Before touching any files, validate ALL GL account numbers referenced in the batch:
- Main account must exist
- `GL-COS-ACCT` (if non-blank) must exist and not be inactive
- `GL-INV-ACCT` (if non-blank) must exist and not be inactive
- Distribution accounts (if GL-TYPE = "%") and their COS/INV sub-accounts must all exist
If ANY account fails pre-edit and the batch is source-balanced (`BALMETHOD = "S"`): **abort the entire batch**.  
If document-balanced (`BALMETHOD = "D"`): skip only the failing reference number; batch continues.

### INV-03: Journal balance update must not overflow
`JR-BALANCE` field is `PIC S9(9)V99 COMP-3` — max is 999,999,999.99.  
If `JR-BALANCE + amount` would exceed +999,999,999.99 or fall below -999,999,999.99, **zero out `JR-BALANCE`** (not an error — COBOL deliberately reset the counter).

### INV-04: Year-end bypass
When `GLOBAL-YE-IS-IN-PROGRESS` (KEY-FROM-PROG = "Y"):
- **Skip UPDATE-JOURNAL** entirely (do not touch JRN file)
- **Skip UPDATE-DETAIL** entirely (do not touch DETAIL file)
- Allow posting to inactive accounts
- Skip cutoff date validation
- Allow posting even with reserved journal sources 09/88
- TypeScript: `isYearEnd: boolean` flag on the post context

### INV-05: Chained sale account posting sequence
When `GL-COS-ACCT ≠ SPACE AND GL-INV-ACCT ≠ SPACE AND TR-APPLY-CD ≠ "#" AND TR-COST ≠ 0`:
```
Main account:    amount = TR-AMOUNT, HI-TYPE = " " (normal)
COS account:     amount = TR-COST,   HI-TYPE = "C"
INV account:     amount = -TR-COST,  HI-TYPE = "I"
```
Each sub-account goes through the full Journal → Detail → Histtran sequence.

### INV-06: Histtran duplicate key handling
Key = `HI-SOURCE + HI-DATE + HI-REFNO + HI-DUPEREFNO + HI-LINENO + HI-TYPE`  
- `HI-LINENO` sequences 1..9999 per reference number (NOT using TR-LINENO)
- On duplicate key write: increment `HI-DUPEREFNO` (DUPEREFNO wraps 00→99→00, causing the "101st occurrence" hang documented in MAINT-15701)
- Histtran boundary violation (status 24 = file full): error dialog, not automatic recovery
- TypeScript: Composite unique constraint on `(journalSource, transactionDate, referenceNumber,
  dupeSequence, lineNumber, postType)`. On INSERT conflict:
  1. Increment `dupeSequence` (starting from 0)
  2. Retry INSERT
  3. Cap at `dupeSequence = 999` (not 99 like COBOL)
  4. If 999 exhausted: throw `HisttranSequenceExhaustedError` (hard fail, not silent hang)
  Pattern: retry loop with `MAX_DUPE_SEQUENCE = 999`

### INV-12: Cutoff date enforcement
Transactions dated before `ACSYS-CUTOFF-DATE` (from sys.fd SYS-RECORD) MUST be rejected.
- Exception: Year-end bypass (INV-04) overrides this check.
- TypeScript: `PostingBeforeCutoffError` thrown if `entryDate < tenant.cutoffDate && !isYearEnd`

### INV-13: Reserved journal sources
Journal sources `09` and `88` are system-reserved. Manual postings using these sources
MUST be rejected.
- Exception: Year-end bypass (INV-04) allows source 09/88.
- TypeScript: `ReservedJournalSourceError` thrown if `source in ['09','88'] && !isYearEnd`

### INV-07: Source security
Journal source access is checked per-user via `jrsrcsec.ws` / `9995-CHECK-JRSRC-ACCESS`.  
- From outside accounting: always allow (system-trusted caller)
- Year-end: always allow
- Otherwise: check user's allowed sources
- TypeScript: RBAC check on journal source code per user role

### INV-08: Unit count rules (COUN field)
When `TR-ADDUNITS = "Y" AND GL-ADDUNITS = "Y"`:

| Amount Direction | GL-TYPE | TR-REV-ADJ | COUN |
|---|---|---|---|
| Debit (positive) | S, L | any | -1 |
| Debit | E, A | any | +1 |
| Debit | M, C | " " or "A" | +1 |
| Debit | M, C | "R" | -1 |
| Credit (negative) | S, L | any | +1 |
| Credit | E, A | any | -1 |
| Credit | M, C | " " or "A" | +1 |
| Credit | M, C | "R" | -1 |

COS posting: if amount > 0, COUN = +1; if < 0, COUN = -1  
INV posting: inverse of COS (if cost > 0, COUN = -1; if < 0, COUN = +1)

### INV-09: Distribution account splitting
For `GL-TYPE = "%"` accounts, `getgldistr` returns up to 90 sub-accounts with percentage splits.
- Post each sub-account independently with its proportional amount
- The original transaction cost field is NOT pro-rated (only the amount is)
- Sub-account of 0 amount is skipped entirely

### INV-10: Batch locking (mutex)
COBOL creates a `.BATCH` temp file at `{D-FILENAME}.BATCH` as a POSIX-style exclusive lock.
- If lock file found with status 93 (held by another process): reject with "Access DENIED"
- TypeScript equivalent: Postgres advisory lock or `SELECT FOR UPDATE` on the batch header row

### INV-11: Batch status lifecycle
```
OK TO POST → NOW POSTING  → (deleted after success)
                           → CORRECT ERRORS (if any refno was skipped)
```

---

## 4. State Mutations

### Files Written (COBOL)

| File | Key Structure | Action |
|------|--------------|--------|
| JOURNAL-MF | GL-ACCTNO + YEAR + MM + SOURCE | READ → ADD amount to JR-BALANCE + COUN to JR-COUNT → REWRITE (or WRITE if not found) |
| DETAIL-MF | SCHDNO + TYPE-KEY + SEQNO | WRITE new record (or ADD to existing at SEQNO=9999) |
| HISTTRAN-FILE | SOURCE + DATE + REFNO + DUPEREFNO + LINENO + TYPE | WRITE new record (on dup key: increment DUPEREFNO/LINENO, retry) |
| TRAN-FILE | DATE + SOURCE + REFNO + LINENO | DELETE individual tran records as posted; DELETE or REWRITE batch header at DONE-PROG |
| MISS-DOC-FILE | YEAR + MM + SOURCE + REFNO (numeric) | READ + increment MI-COUNT or WRITE new (counts distinct refnos posted) |

### TypeScript equivalents

| COBOL File | Prisma Table | Notes |
|---|---|---|
| JOURNAL-MF | `glAccountPeriodBalance` | Running balance per account/period/source |
| DETAIL-MF | `scheduleDetail` | Per-account schedule subsidiary entries |
| HISTTRAN-FILE | `historyTransaction` | Full audit trail |
| TRAN-FILE batch | `journalEntry` status update | DRAFT → POSTED |
| MISS-DOC-FILE | (absorbed into historyTransaction count) | Not needed separately |

---

## 5. Preconditions

1. Batch header exists in TRAN-FILE with status "OK TO POST" (or "CORRECT ERRORS" for autopost re-run)
2. Batch not locked (no `.BATCH` temp file)
3. Source code exists in SOURCE-FILE
4. Transaction date is after system ACSYS-CUTOFF-DATE (except year-end)
5. All GL account numbers in the batch pass pre-edit
6. User has journal source access (or caller is outside-accounting system)

---

## 6. Side Effects

- Calls `histtransync` (HSSYNC) after each refno group — syncs to Java DOCMATE system
- Calls `CALL-ACCT-SYNC` at EOJ — calls HTTP invoker at `/accounting/api/{compno}/acct/sync` to update starting balances in the web frontend
- For autopost batches: builds `AUTOPOST-TABLE` and writes autopost summary records to TRAN-FILE (source "**")
- Writes error log to `/tmp/tranpost.{co}.{source}.{date}.ERRORLOG` on GL pre-edit failure

TypeScript equivalents:
- `histtransync` → publish `HISTORY_TRANSACTION_SYNCED` event (or call DOCMATE integration service)
- `CALL-ACCT-SYNC` → publish `GL_BALANCES_UPDATED` event (consumed by reporting services)
- Error log → structured logging with pino

---

## 7. Failure Modes

| COBOL Condition | Effect | TypeScript Handling |
|---|---|---|
| GL account not found during pre-edit | Show error dialog; if source-balanced: abort batch; if doc-balanced and refno in table: skip refno | `GLAccountNotFoundError`, batch validation throws before post begins |
| GL account not found mid-post (READ-GL) | Show error dialog, remove lock file, GO TO EOJ — files left partially updated | Cannot happen if pre-edit passed; add defensive check in TX |
| JOURNAL-MF write fail (status 99 = locked) | Retry in loop | `$transaction` with serializable isolation handles this |
| HISTTRAN boundary violation (status 24) | Error dialog shown | `HisttranBoundaryError`, halt batch |
| HISTTRAN duplicate key | Increment DUPEREFNO, retry write | `onConflict` with composite key increment |
| Batch header missing at DONE-PROG | Re-create batch header (gldist change) | Re-read `journalEntry` after post; if missing, reconstruct |
| histtransync failure | Failure email sent async; posting continues | Outbox processor retries |

---

## 8. Data Structures — Field Mapping

### TRAN-REC (tran.fd) → `JournalEntryLine` DTO

| COBOL Field | Type | TypeScript Field | Notes |
|---|---|---|---|
| TR-DATE (YEAR/MM/DD) | PIC 9(8) | `entryDate` | YYYYMMDD → ISO Date |
| TR-SOURCE | PIC XX | `journalSource` | 2-char source code |
| TR-REFNO | PIC X(12) | `referenceNumber` | was 7 chars, expanded 2019 |
| TR-LINENO | PIC 9999 | `lineNumber` | sequence within batch |
| TR-ACCTNO | PIC X(5) | `glAccountCode` | 5-char GL account |
| TR-AMOUNT | PIC S9(9)V99 COMP-3 | `amount` (decimal) | negative = credit |
| TR-COST | PIC S9(9)V99 COMP-3 | `costAmount` | for COS/INV chain |
| TR-APPLYNO | PIC X(12) | `applyNumber` | apply-to reference |
| TR-CONTNO | PIC X(10) | `controlNumber` | customer/stock number |
| TR-CONTNA | PIC X(30) | `description` | free text |
| TR-APPLY-CD | PIC X | `applyCd` | "#" = use applyno not cost |
| TR-ADDUNITS | PIC X | `addUnits` | "Y" = track unit count |
| TR-REV-ADJ | PIC X | `revAdj` | "R"=reverse, "A"=adjust |
| TR-AUTO-POST | PIC X | `autoPost` | "Y" = system-generated |
| TR-LAST-USER | PIC X(6) | `lastUser` | 6-char user ID |
| TR-TRAN-DATE | PIC 9(6) COMP-6 | `transactionDate` | when entered |
| TR-TRAN-TIME | PIC 9(4) COMP-6 | `transactionTime` | HHMM |
| TR-FROM-PROG | PIC X | `sourceProgram` | caller code (E/F/H/P/S/T/V…) |

### JOURNAL-REC (jrn.fd) → `glAccountPeriodBalance`

| COBOL Field | Type | TypeScript Field |
|---|---|---|
| JR-ACCTNO | PIC X(5) | `glAccountCode` |
| JR-YEAR | PIC 9999 | `periodYear` |
| JR-MM | PIC 99 | `periodMonth` |
| JR-SOURCE | PIC XX | `journalSource` |
| JR-BALANCE | PIC S9(9)V99 COMP-3 | `runningBalance` (Decimal) |
| JR-COUNT | PIC S9(5) COMP-3 | `unitCount` |

### HISTTRAN-REC (histtran.rec) → `historyTransaction`

| COBOL Field | Type | TypeScript Field |
|---|---|---|
| HI-SOURCE | PIC XX | `journalSource` |
| HI-DATE (YEAR/MM/DD) | PIC 9(8) | `transactionDate` |
| HI-REFNO | PIC X(12) | `referenceNumber` |
| HI-DUPEREFNO | PIC 99 COMP-6 | `dupeSequence` (0..99) |
| HI-LINENO | PIC 9999 COMP-6 | `lineNumber` (1..9999) |
| HI-TYPE | PIC X | `postType` (" "=normal, "C"=cost, "I"=inv) |
| HI-ACCTNO | PIC X(5) | `glAccountCode` |
| HI-ACCSOURCE | PIC XX | `accountSource` (= HI-SOURCE) |
| HI-ACCDATE | PIC 9(8) | `accountDate` (= HI-DATE) |
| HI-AMOUNT | PIC S9(9)V99 COMP-3 | `amount` |
| HI-COST | PIC S9(9)V99 COMP-3 | `costAmount` |
| HI-APPLYNO | PIC X(12) | `applyNumber` |
| HI-CONTNO | PIC X(10) | `controlNumber` |
| HI-CONTNA | PIC X(30) | `description` |
| HI-COUNT | PIC S9 COMP-3 | `unitCount` |
| HI-CLEAR-CODE | PIC X | `clearCode` (always SPACE on post) |
| HI-REV-ADJ | PIC X | `revAdjFlag` |
| HI-AUTO-POST | PIC X | `autoPostFlag` |
| HI-TRAN-DATE | PIC 9(6) COMP-6 | `enteredDate` |
| HI-TRAN-TIME | PIC 9(4) COMP-6 | `enteredTime` |
| HI-POST-DATE | PIC 9(6) COMP-6 | `postedDate` |
| HI-POST-TIME | PIC 9(4) COMP-6 | `postedTime` |
| HI-FROM-PROG | PIC X | `fromProgram` |
| HI-POSTED-DATE | PIC X(8) | `postedDateISO` (YYYYMMDD, added ACC-2247) |

### DETAIL-REC (detail.fd) → `scheduleDetail`

| COBOL Field | Type | TypeScript Field |
|---|---|---|
| DE-SCHDNO | PIC XX | `scheduleNumber` |
| DE-TYPE (via redefines) | — | `scheduleType` (1/2/3/4/5) |
| DE-CONTNO | PIC X(10) | `controlNumber` |
| DE-AMOUNT | PIC S9(9)V99 COMP-3 | `amount` |
| DE-REFNO | PIC X(12) | `referenceNumber` |
| DE-SOURCE | PIC XX | `journalSource` |
| DE-DATE1 | PIC 9(8) | `transactionDate` |
| DE-ACCTNO | PIC X(5) | `glAccountCode` |
| DE-DESC | PIC X(35) | `description` |
| DE-APPLYNO | PIC X(12) | `applyNumber` (type 5) |
| DE-APPLY-CD | PIC X | `applyCd` (type 5) |
| DE-SEQNO | PIC 9(4) COMP-6 | `sequenceNumber` |

### GL-REC (gl.rec) → `glAccount`

| COBOL Field | TypeScript Field | Notes |
|---|---|---|
| GL-ACCTNO | `code` | |
| GL-ACCTNAME | `name` | |
| GL-TYPE | `type` | A/C/E/L/M/S/% |
| GL-SCHDNO | `scheduleNumber` | 0 = no schedule |
| GL-COS-ACCT | `cosAccountCode` | cost-of-sale chain |
| GL-INV-ACCT | `invAccountCode` | inventory chain |
| GL-INACTIVE | `isActive` | "I" = inactive |
| GL-REQ-CONTNO | `requiresControlNumber` | blank/A/D/L/S/6 |
| GL-ADDUNITS | `trackUnits` | "Y" = track count |
| GL-CASH-CLEAR | `isCashClearing` | clearing source flag |

---

## 9. Decision: BUILD / FIX / SKIP / ABSORB

**Decision: FIX + EXTEND**

The TypeScript `gl-service` already partially implements this program's logic. The following changes are required to make it correct:

| Gap | Action |
|-----|--------|
| No SERIALIZABLE isolation | FIX: add `isolationLevel: 'Serializable'` |
| No JRN balance update | BUILD: `glAccountPeriodBalance` upsert inside TX |
| No HISTTRAN record creation | BUILD: `historyTransaction` write inside TX |
| No schedule DETAIL write | BUILD: `scheduleDetail` write inside TX (when `scheduleNumber ≠ null`) |
| No chained COS/INV posting | BUILD: detect `cosAccountCode`/`invAccountCode`, post sub-entries |
| No distribution account expansion | BUILD: call distribution-expansion logic (getgldistr equivalent) |
| `$queryRawUnsafe` for period status | FIX: replace with HTTP call to eom-service |
| `x-tenant-id ?? 'tenant-kunes'` | FIX: return 401 if missing |
| JWT secret fallback | FIX: fail at startup if env var missing |
| DRAFT→POSTED without approval | FIX: enforce DRAFT→PENDING_REVIEW→POSTED lifecycle |
| No pre-edit validation | BUILD: validate all GL accounts before transaction begins |
| No unit count tracking | BUILD: compute `unitCount` per INV-08 rules |
| No year-end bypass flag | BUILD: `isYearEnd` context flag |

**What to SKIP:** Batch lock file (`.BATCH` mechanism) — replaced by Postgres row-level lock. Picklist/dialog UI — N/A. Error log files — replaced by pino structured logging. SHOW-USER-INFO, LOAD-SOURCES — N/A. histtransync call — replaced by `HISTORY_TRANSACTION_SYNCED` outbox event. CALL-ACCT-SYNC invoker — replaced by `GL_BALANCES_UPDATED` outbox event.

---

## 10. Improvements Over COBOL

| COBOL Limitation | TypeScript Solution |
|---|---|
| Three separate file writes with NO transaction | Single `$transaction({ isolationLevel: 'Serializable' })` |
| Out-of-balance conditions required fixoobtran.cbl repair | Impossible with ACID transactions |
| DUPEREFNO overflow at 99 causes infinite loop (MAINT-15701) | Composite unique index + sequence; max sequences enforced |
| Histtran boundary violation (file full, status 24) | PostgreSQL row storage has no fixed-size file limit |
| ISAM sequential scan for next available histtran key | B-tree index; INSERT with conflict handling is O(log n) |
| Batch locking via temp file (race condition on NFS mounts) | Postgres `SELECT FOR UPDATE NOWAIT` |
| Pre-edit scans all tran records twice | Single-pass validation query on GL accounts |
| Unit count zeroed on overflow instead of error | Decimal(15,2) fields; overflow raises DB constraint error |
| Year > 2050 check hard-coded | No arbitrary year limit |
| No multi-tenant support | All rows scoped to `tenantId` |
| Single-company per installation | Multi-tenant SaaS, N companies per deployment |
| Sync called via shell `invoker` HTTP after commit | Outbox pattern — events persisted atomically, published async |
| No audit log of who approved | `approvedByUserId`, `approvedAt` fields |
| No idempotency protection | Entry ID serves as idempotency key; duplicate `WRITE` → `INSERT OR IGNORE` pattern |

---

## 11. Key Paragraphs Cross-Reference

| Paragraph | Lines | TypeScript Method |
|---|---|---|
| `START-PROG` | ~754 | `GLService.constructor` / startup validation |
| `PRE-EDIT-GL-ROUTINE` | ~1190 | `GLService.validateBatchAccounts()` |
| `START-PROC` | ~1700 | `GLService.postJournalEntry()` — opens files |
| `READ-REC` loop | ~1748 | `for (const line of entry.lines)` |
| `AUTO-DIST-ROUTINE` | ~1818 | `GLService.expandDistributionAccount()` |
| `PROC-TRANS` | ~1836 | `GLService.postSingleLine()` |
| `CONT1` | ~1975 | Core sequence: journal → detail → histtran |
| `UPDATE-JOURNAL` | ~2054 | `GLPostingEngine.updateJournalBalance()` |
| `UPDATE-DETAIL` | ~2082 | `GLPostingEngine.writeScheduleDetail()` |
| `SETUP-HISTTRAN-KEY` | ~2240 | `GLPostingEngine.resolveHisttranKey()` |
| `UPDATE-HISTTRAN` / `WR-HISTTRAN` | ~2296 | `GLPostingEngine.writeHistoryTransaction()` |
| `DONE-PROG` | ~2425 | `GLService.finalizeBatch()` |
| `CALL-ACCT-SYNC` | ~2465 | `GLService.publishBalanceUpdatedEvent()` |
| `DB-ENTRY` / `CR-ENTRY` | ~1888 | `GLPostingEngine.computeUnitCount()` |
