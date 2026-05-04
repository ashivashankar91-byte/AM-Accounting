# COBOL Deep Audit — Batch 3: F (non-finstm) Files

**Audit Date:** 2026-05-02  
**Scope:** All non-finstm `.cbl` files beginning with F (11 files)  
**Protocol:** Full PROCEDURE DIVISION read. fixoobtran.cbl read in full to verify repair formula.

---

## Summary Table

| # | File | Lines | Type | Monetary Ops | Data Mutations | Verdict |
|---|------|-------|------|-------------|----------------|---------|
| 1 | filecr.cbl | ~404 | Init Utility | NO | WRITE (empty files) | ✅ SAFE TO SKIP |
| 2 | filecrdf.cbl | ~353 | Init Subroutine | NO | WRITE (empty files) | ✅ SAFE TO SKIP |
| 3 | fixglsort.cbl | ~734 | One-time Utility | NO | REWRITE GL-SORTNO only | ✅ SAFE TO SKIP |
| 4 | fixoobtran.cbl | ~1300 | OOB Repair | YES (HISTTRAN negate) | REWRITE/WRITE HISTTRAN-FILE | ✅ ALREADY BUILT |
| 5 | fixorphan.cbl | ~270 | Orphan Repair | NO | WRITE TRAN-FILE (batch headers) | ✅ SAFE TO SKIP |
| 6 | fordymnt.cbl | ~185 | Test DB Utility | NO | DELETE/WRITE JOURNAL-MF (year only) | ✅ SAFE TO SKIP |
| 7 | fsisapproved.cbl | ~89 | Subroutine | NO | READ ONLY | ✅ SAFE TO SKIP |
| 8 | fsisjavaon.cbl | ~117 | Subroutine | NO | READ ONLY | ✅ SAFE TO SKIP |
| 9 | fsprtarc.cbl | ~655 | Report Display | NO | NO | ✅ SAFE TO SKIP |
| 10 | fsprtdcs.cbl | ~2800 | FS Print Generator | NO | File copies only | ✅ SAFE TO SKIP |
| 11 | fssupp.cbl | ~62 | Subroutine Wrapper | NO | Delegates to fsprtdcs | ✅ SAFE TO SKIP |

**P0 Gaps Found:** 0  
**P1 Gaps Found:** 0

---

## Detailed Verdicts

### filecr.cbl — FILECR

**Lines:** ~404 | **Type:** Interactive company file creation  
**Called by:** Admin (interactive) | **Calls:** None  
**Monetary operations:** NONE  
**Data mutations:** `OPEN OUTPUT` + `WRITE` to 12 ISAM accounting files with empty/zero initialization records (same pattern as `acctsetup.cbl` in Batch 1). Also writes filename paths to the filena index file.  
**Business logic:** Interactive version of company file provisioning. Prompts for company number, creates all 12 accounting files with empty initialization records.  
**Verdict:** ✅ **SAFE TO SKIP** — ISAM file initialization has no equivalent in Postgres. New tenant provisioning in `onboarding-service` handles this via Prisma migrations.

---

### filecrdf.cbl — FILECRDF

**Lines:** ~353 | **Type:** Batch subroutine (LINKAGE SECTION with PASS-COMPNO)  
**Called by:** Batch company copy scripts | **Calls:** None  
**Monetary operations:** NONE  
**Data mutations:** Same as filecr.cbl — writes empty initialization records to all 12 accounting files  
**Business logic:** Automated (non-interactive) version of filecr for scripted company creation (e.g., company copy operations). No user interaction.  
**Verdict:** ✅ **SAFE TO SKIP** — Same rationale as filecr. Automated equivalent is `onboarding-service`.

---

### fixglsort.cbl — FIXGLSORT

**Lines:** ~734 | **Type:** One-time metadata repair utility  
**Called by:** System administrator (COBOL 2012.08.001 release) | **Calls:** SYSTEM (zip, chmod)  
**Monetary operations:** NONE — `GL-OPEN-BAL` (PIC S9(9)V99) is read but never modified  
**Data mutations:**
- `REWRITE GL-REC` — updates `GL-SORTNO` field ONLY (text sorting key, not monetary)
- Skips distribution accounts (GL-TYPE = "%")
- Creates backup zip before modifying  
**Business logic:** Corrects blank `GL-SORTNO` values on GL distribution accounts by extracting sort key from `GL-ACCTNO`. Was run once during a specific release.  
**Verdict:** ✅ **SAFE TO SKIP** — Metadata-only repair of sort keys. In the TypeScript system, GL sort keys are managed via the GL account creation/update API. The one-time fix has already been applied to the historical data.

---

### fixoobtran.cbl — FIXOOBTRAN

**Lines:** ~1300 | **Type:** Interactive out-of-balance transaction repair  
**Called by:** Admin diagnostics (program 8) | **Calls:** histtransync  
**Monetary operations:**
- `COMPUTE GRAND-TOTAL = GRAND-TOTAL + TMP-TBL1-AMOUNT(X2)` — sum for validation only
- `COMPUTE HI-LINENO = HI-LINENO + 900` — marks reversing entry (not monetary)
- `COMPUTE HI-AMOUNT = HI-AMOUNT * -1` — negate amount for reversing HISTTRAN entry
- `COMPUTE HI-COST = HI-COST * -1` — negate cost
- `COMPUTE HI-COUNT = HI-COUNT * -1` — negate count

**Data mutations:**
- `REWRITE HISTTRAN-REC` — marks original as "R" (reversed)
- `WRITE HISTTRAN-REC` — creates new reversing entry with negated amount/cost/count
- **NO write to GL-MF or JOURNAL-MF**
- `CALL histtransync` — syncs to OfficeMate database after repair

**Business logic:**
1. User selects SOURCE/REFNO/DATE combination (OOB transaction group)
2. Program loads all HISTTRAN entries for that key into memory (max 9,500 entries)
3. User marks entries with "X" to reverse
4. `COMPUTE HI-AMOUNT = HI-AMOUNT * -1` for each selected entry; `HI-LINENO + 900` marker
5. Validates `GRAND-TOTAL = 0` before writing (sum of originals + reversals must net to zero)
6. REWRITE/WRITE HISTTRAN, then calls histtransync

**Key insight — repair scope:** `fixoobtran.cbl` only repairs HISTTRAN-FILE. It does NOT recompute GL-MF opening balances or JOURNAL-MF running balances. This means GL and journal balances could still be incorrect after repair — the tool provides a histtran-level correction but not a full reconciliation.

**New system coverage:**  
`gl-service.approveJournalEntry()` uses `$transaction({ isolationLevel: 'Serializable' })` wrapping ALL three writes (GLAccountPeriodBalance, ScheduleDetail via outbox, TransactionHistory). This makes the condition that fixoobtran was built to repair **impossible to occur** with new TypeScript entries. Historical COBOL-era OOB records in the migrated histtran data can be identified via `agent-gl` anomaly detection.

**@removes-need-for annotation:** `gl-service.ts` line 288 contains `@removes-need-for fixoobtran.cbl, fixorphan.cbl, dumpoobtran.cbl` — the design rationale is explicitly documented.

**Migration note:** Before go-live cutover, run `fixoobtran.cbl` on all current COBOL data to identify and repair any existing OOB conditions so they don't carry over as historical anomalies.

**Verdict:** ✅ **ALREADY BUILT** — The TypeScript Serializable transaction model prevents future OOB conditions. The fix program is a repair for a class of error that cannot occur in the new system. Existing OOB data should be cleaned up before migration cutover.

---

### fixorphan.cbl — FIXORPHAN

**Lines:** ~270 | **Type:** Batch orphan batch-header repair  
**Called by:** Batch process | **Calls:** SYSTEM (zip, email)  
**Monetary operations:** NONE  
**Data mutations:**
- `WRITE TRAN-REC` — creates missing batch header records (TR-ACCTNO = LOW-VALUES, TR-AMOUNT = ZERO)
- `CALL "SYSTEM" ZIP-COMMAND` — backup  
**Business logic:** Locates orphan transactions in TRAN-FILE (detail lines without a batch header between last-closed-month and +1 year), creates missing headers. Backs up TRAN-FILE before modification.  
**Verdict:** ✅ **SAFE TO SKIP** — Batch header creation only; no monetary fields. The TRAN-FILE orphan condition results from COBOL ISAM batch processing — this cannot occur in the TypeScript system because Postgres transactions are atomic. Also referenced in `@removes-need-for` annotation.

---

### fordymnt.cbl — FORDYMNT

**Lines:** ~185 | **Type:** Ford test database year maintenance  
**Called by:** Admin (interactive) | **Calls:** None  
**Monetary operations:** NONE  
**Data mutations:**
- `DELETE JOURNAL-MF RECORD`
- `WRITE JOURNAL-REC` — updates `JR-YEAR` field only (year metadata, not monetary balance)  
**Business logic:** Updates JOURNAL-MF record years for Ford Motor test database maintenance. Used to refresh test environment with current year values so reports don't show stale year data.  
**Verdict:** ✅ **SAFE TO SKIP** — Year metadata update only; no monetary fields modified. Test database utility with no production equivalent needed.

---

### fsisapproved.cbl — FSISAPPROVED

**Lines:** ~89 | **Type:** Subroutine (LINKAGE SECTION)  
**Called by:** Financial statement programs | **Calls:** None  
**Monetary operations:** NONE  
**Data mutations:** READ ONLY from `FS-NOTAPPROVED-FILE`  
**Business logic:** Checks if a financial statement is approved for a given year/manufacturer by querying approval file. Returns Y/N switch to caller.  
**Verdict:** ✅ **SAFE TO SKIP** — Read-only query subroutine. FS approval state in the TypeScript system is managed in Postgres.

---

### fsisjavaon.cbl — FSISJAVAON

**Lines:** ~117 | **Type:** Subroutine (LINKAGE SECTION)  
**Called by:** Financial statement programs | **Calls:** None  
**Monetary operations:** NONE  
**Data mutations:** READ ONLY from `JAVA-FS-FILE` (activation list)  
**Business logic:** Determines if Java financial statement is active for a given year/manufacturer. Handles 2010+ activation dates per manufacturer code.  
**Verdict:** ✅ **SAFE TO SKIP** — Read-only configuration check. Java FS activation is replaced by fs-service feature flags in Postgres.

---

### fsprtarc.cbl — FSPRTARC

**Lines:** ~655 | **Type:** FS PDF archive display  
**Called by:** FS menu | **Calls:** SYSTEM (file directory, browser)  
**Monetary operations:** NONE  
**Data mutations:** NONE  
**Business logic:** Displays archived financial statement PDFs. Searches archive directory, finds PDF, constructs URL, launches browser (AMPS/Anzio) to display historical financial statements.  
**Verdict:** ✅ **SAFE TO SKIP** — Report display/archive browser. TypeScript web app provides equivalent UI.

---

### fsprtdcs.cbl — FSPRTDCS

**Lines:** ~2800 | **Type:** Financial statement print generator  
**Called by:** FS menu system | **Calls:** Java invoker (PDF/Excel generation)  
**Monetary operations:** ZERO monetary COMPUTE/ADD/SUBTRACT operations despite its size.  
**Data mutations:**
- Builds command strings for Java invoker
- `CALL "SYSTEM"` to execute Java financial statement engine (returns PDF/Excel to /tmp/)
- `CP-COMMAND` file copies: archives PDF/Excel/NCM files from /tmp to /amdb/finstmt/data/
- **NO WRITE/REWRITE to GL-MF, JOURNAL-MF, HISTTRAN-FILE, DETAIL-MF, TRAN-FILE**

**Business logic:**
1. Displays FINSTEP screen (month/year, calendar/fiscal flag, drill-down option)
2. Calls Java invoker with parameters: company, date, OEM, YTD flag, drill-down, login
3. Java generates PDF and optional extract files (NCM Excel)
4. Parses Java response (error codes 0–14)
5. Displays PDF in browser via AMPS/Anzio
6. Optionally submits extract file to OEM (Nissan, Infiniti, BMW, Jaguar, Toyota/Lexus, Chrysler/Fiat)
7. Archives PDF/Excel to /amdb/finstmt/data/ for historical retrieval

**New system coverage:** `fs-service` generates financial statements directly from Postgres GL data. OEM-specific submission logic is handled by `connector-service` integration points. PDF generation uses the TypeScript reporting layer.  
**Verdict:** ✅ **SAFE TO SKIP** — Financial statement generator/archiver with zero accounting file mutations. All business logic (GL data, FS layout) is in `fs-service`.

---

### fssupp.cbl — FSSUPP

**Lines:** ~62 | **Type:** Subroutine wrapper  
**Called by:** FS programs | **Calls:** `fsprtdcs` (delegates entirely)  
**Monetary operations:** NONE  
**Data mutations:** NONE (delegates to fsprtdcs)  
**Business logic:** Simple pass-through that calls `fsprtdcs` with `FS-PRINT-OR-DCS = "PRINT"`.  
**Verdict:** ✅ **SAFE TO SKIP** — Wrapper only.

---

## Gaps Found

**None.** All 11 files are safe to skip or already built. The most important file in this batch — `fixoobtran.cbl` — is confirmed as already covered by the TypeScript SERIALIZABLE transaction design.
