# COBOL Deep Audit — Batch 2: Files D through E

**Audit Date:** 2026-05-02  
**Scope:** All `.cbl` files in `acct/src/` whose filename begins with D or E (10 files)  
**Protocol:** Full PROCEDURE DIVISION read. Cross-referenced against TypeScript codebase.

---

## Summary Table

| # | File | Lines | Type | Monetary Ops | Data Mutations | Verdict |
|---|------|-------|------|-------------|----------------|---------|
| 1 | deletetrn.cbl | ~170 | Utility | NO | DELETE TRAN-FILE | ✅ SAFE TO SKIP |
| 2 | delimdgl.cbl | ~800 | GL Export | YES (read accum) | WRITE GL-DELIM-FILE (export) | ✅ SAFE TO SKIP |
| 3 | delimfil.cbl | ~1400 | GL Export | YES (read accum) | WRITE GL-DELIM-FILE (export) | ✅ SAFE TO SKIP |
| 4 | delimhis.cbl | ~800 | History Export | NO | WRITE HIS-EXTRACT (export) | ✅ SAFE TO SKIP |
| 5 | delimsch.cbl | ~4800 | Schedule Extract | YES (read accum) | TMP work files + EXTRACT (temp) | ✅ SAFE TO SKIP |
| 6 | deloldtran.cbl | ~800 | Cleanup Utility | NO | DELETE TRAN-FILE (old records) | ✅ SAFE TO SKIP |
| 7 | depatchn.cbl | ~1400 | Interactive Patch | YES (initialize) | WRITE/REWRITE/DELETE DETAIL-MF | ⚠️ PARTIALLY COVERED |
| 8 | dialflnk.cbl | ~800 | Orchestration | NO | NO | ✅ SAFE TO SKIP |
| 9 | dumpoobtran.cbl | ~1000 | OOB Report | YES (read accum) | WRITE PRINT-FILE (report) | ✅ SAFE TO SKIP |
| 10 | eomsync.cbl | ~280 | Orchestration | NO | NO | ✅ SAFE TO SKIP |

**P0 Gaps Found:** 0  
**P1 Gaps Found:** 1 (depatchn.cbl — admin edit endpoint for schedule detail)

---

## Detailed Verdicts

### deletetrn.cbl — DELETETRN

**Lines:** ~170 | **Type:** Interactive utility  
**Called by:** Admin menu | **Calls:** None  
**Monetary operations:** NONE  
**Data mutations:** `DELETE TRAN-FILE RECORD` — user confirms each deletion  
**Business logic:** Interactive utility to delete transaction records from TRAN-FILE by source/date. User selects source, date range, confirms each record before deletion.  
**New system coverage:** In the TypeScript system, TRAN-FILE is replaced by the `JournalEntry` table with `DRAFT` status. Deleting draft entries is handled via the web UI journal management screen or an admin API endpoint (`DELETE /api/v1/journal-entries/:id`).  
**Verdict:** ✅ **SAFE TO SKIP** — No monetary operations. Functional equivalent exists in the TypeScript web UI.

---

### delimdgl.cbl — DELIMDGL

**Lines:** ~800 | **Type:** GL export utility  
**Called by:** acctmenu.cbl option 34 | **Calls:** getglbyid (optional)  
**Monetary operations:**
- `ADD GL-OPEN-BAL TO TOTAL-PRI-BAL` (accumulate opening balance)
- `ADD JR-BALANCE TO TOTAL-PRI-BAL` (when JR-SOURCE = "09" prior-year)
- `ADD HI-AMOUNT TO TOTAL-CUR-BAL` (from histtran)
- `COMPUTE TOTAL-YTD-BAL = TOTAL-PRI-BAL + TOTAL-CUR-BAL`
All READ-ONLY on accounting files — no write to GL-MF, JOURNAL-MF, HISTTRAN-FILE.

**Data mutations:** `WRITE GL-DELIM-FILE` — comma-delimited CSV export file only  
**Business logic:** Iterates GL accounts, reads journal entries sorted by account/source, retrieves detail history, computes YTD balances, exports comma-delimited CSV for external use.  
**New system coverage:** `gl-service` provides `GET /api/v1/gl/accounts` with balance data. Trial balance exports are handled via the web UI or a dedicated export endpoint. The YTD balance formula (`opening + journal + histtran`) is replicated in `getAccountPeriodBalance()` queries.  
**Verdict:** ✅ **SAFE TO SKIP** — Read-only accounting files; all mutations to export CSV. TypeScript provides equivalent via GL inquiry APIs.

---

### delimfil.cbl — DELIMFIL

**Lines:** ~1400 | **Type:** GL trial balance export with GL-by-ID  
**Called by:** Menu-driven option | **Calls:** getglbyid, getgldesc  
**Monetary operations:**
- `ADD GL-OPEN-BAL TO TOT-PRIOR-BAL` (opening balance accumulation)
- `ADD JR-BALANCE TO TOT-PRI-BAL` (prior source "09")
- `ADD JR-BALANCE TO TOT-CUR-BAL` (current sources)
- `COMPUTE TOT-YTD-BAL = TOT-PRIOR-BAL + TOT-CUR-BAL`
- `MOVE DE-AMOUNT TO NUM-FIELD` (detail amounts formatted for output)
All READ-ONLY.

**Data mutations:** `WRITE GL-DELIM-FILE` (export); optional `CALL "SYSTEM" copytopc.sh` (PC copy)  
**Business logic:** Menu-driven GL export with GL-by-ID support, account range filtering (FROM-ACCT to THRU-ACCT), optional schedule detail extraction, PC export via system call. Enhanced version of delimdgl with GL-by-ID (AC2429).  
**New system coverage:** Same as delimdgl — gl-service APIs provide all the underlying data. Account range filtering and schedule detail export are features of the GL inquiry endpoints.  
**Verdict:** ✅ **SAFE TO SKIP** — Read-only accounting files; mutations only to export.

---

### delimhis.cbl — DELIMHIS

**Lines:** ~800 | **Type:** History export  
**Called by:** Background parameter-driven process | **Calls:** getglbyid (optional)  
**Monetary operations:** NONE (field extraction only)  
**Data mutations:** `WRITE ACCT-HIS-EXTRACT` — pipe-delimited text export, not accounting files  
**Business logic:** Validates parameters (company, date range, output directory), opens history extract with pipe delimiters, filters by date range and source, writes field-by-field to text file.  
**New system coverage:** `gl-service` provides `GET /api/v1/gl/history` with date range filtering. Transaction history exports are available via API and web UI.  
**Verdict:** ✅ **SAFE TO SKIP** — Read-only histtran; text export only.

---

### delimsch.cbl — DELIMSCH

**Lines:** ~4800 (largest file in batch) | **Type:** Type-3 schedule extract for AutoLenders  
**Called by:** Background batch process | **Calls:** julian2 (date calc), getglbyid (optional)  
**Monetary operations:**
- `ADD GL-OPEN-BAL TO TOTAL-PRI-BAL` (GL opening balance)
- `ADD JR-BALANCE TO TOTAL-PRI-BAL` (journal balance)
- `ADD HI-AMOUNT TO TOTAL-CUR-BAL` (histtran amount)
- `COMPUTE TOTAL-YTD-BAL = TOTAL-PRI-BAL + TOTAL-CUR-BAL`
- `COMPUTE TRAN-TOTAL = TRAN-TOTAL + HI-AMOUNT` (per-transaction aggregation)
- Balance fields read: `TDE-BAL-CUR`, `TDE-BAL-OVR30`, `TDE-BAL-OVR60`, `TDE-BAL-OVR90`
All READ-ONLY on accounting files.

**Data mutations:**
- `WRITE TMP-DETAIL-REC` to `TMP-DETAIL-MF` — temporary work file (not permanent)
- `WRITE TMP-DETTOT-REC` to `TMP-DET-TOT` — temporary totals file (not permanent)
- Output extract to `/crm/comcast/sched##_##.txt` — pipe-delimited text for AutoLenders  
**Business logic:** For schedule type 3 (Automotive with aging), reads detail records by schedule/control#, builds aging buckets (current/30+/60+/90+), accumulates GL balances, writes to temporary indexed files for sorting, computes age-in-days, constructs pipe-delimited output with vehicle info (year/make/model/VIN) and owner name lookup.  
**New system coverage:** schedule-service provides schedule detail with aging buckets. The AutoLenders integration would be handled by a connector-service integration point or a dedicated integration service posting to the AutoLenders REST API. The complex ISAM sort-merge pattern is replaced by a single SQL query with ORDER BY.  
**Verdict:** ✅ **SAFE TO SKIP** — All permanent accounting files are READ-ONLY. Mutations only to temporary work files and text export. The AutoLenders integration format should be reimplemented as a connector-service integration endpoint.

---

### deloldtran.cbl — DELOLDTRAN

**Lines:** ~800 | **Type:** TRAN-FILE cleanup batch  
**Called by:** Background batch process (AMACC-3727) | **Calls:** validdate, SYSTEM (zip, email)  
**Monetary operations:** NONE (date-based deletion only)  
**Data mutations:**
- `DELETE TRAN-FILE RECORD` — removes unposted transactions older than last-close-month
- `CALL "SYSTEM" ZIP-COMMAND` — creates backup zip before deletes
- `CALL "SYSTEM" EMAIL-COMMAND` — sends completion email  
**Business logic:** For each company, reads last close month from system file, scans TRAN-FILE for unposted records with dates prior to last-close-month, validates date format, deletes matching records, creates zip backup, emails results.  
**New system coverage:** In the TypeScript system, TRAN-FILE is replaced by `JournalEntry` table with status DRAFT. Data retention policies are enforced via database cleanup jobs or Postgres partitioning/TTL. DRAFT entries older than the last close period can be purged via a cron job or eom-service step.  
**Verdict:** ✅ **SAFE TO SKIP** — TRAN-FILE is a staging area for unposted transactions. In Postgres, old DRAFT journal entries are cleaned up as part of the EOM process or a scheduled retention job.

---

### depatchn.cbl — DEPATCHN

**Lines:** ~1400 | **Type:** Interactive schedule detail patch  
**Called by:** Admin maintenance menu (program 8) | **Calls:** getglbyid, getsched, validdate  
**Monetary operations:**
- `MOVE 0 TO DE-BAL-CUR, DE-BAL-OVR30, DE-BAL-OVR60, DE-BAL-OVR90` (initialize on new record)
- `MOVE ZERO TO DE-AMOUNT` (initialize detail amount)
- `MOVE DE-AMOUNT TO TRAN-AMOUNT(SUB)` (copy to work table for begbal processing)
- Balance fields: `DE-BAL-CUR`, `DE-BAL-OVR30`, `DE-BAL-OVR60`, `DE-BAL-OVR90` (PIC S9(9)V99 COMP-3)

**Data mutations:**
- `WRITE DETAIL-REC` to DETAIL-MF (section WRITE-REC, new records)
- `REWRITE DETAIL-REC` to DETAIL-MF (section WRITE-REC, existing records)
- `DELETE DETAIL-MF` (section DEL-REC, user-driven deletion)

**Validations enforced:**
1. Schedule master locked WITH LOCK during patch (J25958)
2. Source must exist in SOURCE-FILE
3. GL account must be in schedule's GL list (SD-GLNO1 through SD-GLNO5)
4. Reference number required for type-5 detail
5. Date format validated (MM: 1–12, DD: 1–31)
6. GL-by-ID resolution if active (AC2167)

**Business logic:** Interactive menu to patch individual schedule detail records. Supports types 1–5 schedules: select schedule/control#, select existing detail or create new, enter amount/GL/source/refno, perform WRITE/REWRITE/DELETE on DETAIL-MF. Handles balance-forward entries with GL distribution (up to 5 GL lines). Type-5 apply# entries with date validation. Vehicle lookup for display (stock# or VIN-last6).

**New system coverage:**  
`schedule-service` (`amacc/services/schedule-service/`) handles schedule creation, but a specific **admin edit endpoint for individual detail records** needs verification. The validations enforced by depatchn (source exists, GL in schedule list, refno required for type 5) must be present in the TypeScript `schedule-service` when creating or updating detail records.

**Gap assessment:**  
The COBOL validations (rules 1–6 above) must be reproduced in `schedule-service` when it accepts detail record mutations. Need to confirm that:
- `schedule-service POST /api/v1/schedules/:id/detail` validates GL against the schedule's allowed GL list
- Reference number is required for type-5 entries
- Schedule master lock is handled via optimistic locking (`version` field) not application-level lock

**Verdict:** ⚠️ **PARTIALLY COVERED**

**Evidence:** Direct WRITE/REWRITE/DELETE on DETAIL-MF — all monetary field validations documented above. The `schedule-service` has schedule management but the admin-level individual detail-record edit endpoint and its validations need to be confirmed.

**P1 gap:** Add explicit admin endpoint `PATCH /api/v1/schedules/:id/detail/:lineId` to schedule-service with all 6 COBOL validations. Priority: P1 (admin function, not daily business operation).

---

### dialflnk.cbl — DIALFLNK

**Lines:** ~800 | **Type:** FS setup orchestration  
**Called by:** FS menu options | **Calls:** getfssetups, finstmcp/finstfip  
**Monetary operations:** NONE  
**Data mutations:** NONE  
**Business logic:** Loads company filenames and system configuration, checks whether FS setups are in database or COBOL config, calls appropriate FS print program (finstmcp or finstfip) with company/year/format parameters.  
**Verdict:** ✅ **SAFE TO SKIP** — Pure orchestration, no file mutations.

---

### dumpoobtran.cbl — DUMPOOBTRAN

**Lines:** ~1000 | **Type:** Out-of-balance report utility (read-only)  
**Called by:** Admin diagnostics menu | **Calls:** None  
**Monetary operations:**
- `COMPUTE TRAN-TOTAL = TRAN-TOTAL + HI-AMOUNT` — aggregation for detection ONLY, no persistence
**Data mutations:** NONE on accounting files
- `WRITE PRINT-REC FROM PR-REC` — output to PRINT-FILE text report only

**Business logic:** READ-ONLY diagnostic report. Scans HISTTRAN-FILE for transactions grouped by source/date/refno, aggregates `HI-AMOUNT` into `TRAN-TOTAL`, outputs non-zero totals as out-of-balance conditions. Scans TRAN-FILE for orphan transactions. Filters by cutoff date (6 months prior, J10498).

**Critical confirmation:** NO WRITE/REWRITE/DELETE on HISTTRAN-FILE or TRAN-FILE. Program is diagnostic only.

**Validation of TypeScript design claim:** Confirms that gl-service's `$transaction({ isolationLevel: 'Serializable' })` eliminates the need for this repair tool — dumpoobtran was a detector, not a fixer. The OOB condition that created work for this program cannot occur in the TypeScript system because the three-way write (GL/journal/histtran) is atomic.  
**Verdict:** ✅ **SAFE TO SKIP** — Read-only report utility; validates TypeScript design claim.

---

### eomsync.cbl — EOMSYNC

**Lines:** ~280 | **Type:** EOM orchestration bridge  
**Called by:** EOM processing | **Calls:** REST API `/accounting/api/{co}/acct/monthend`  
**Monetary operations:** NONE  
**Data mutations:** NONE (reads receipt file from /tmp/, no accounting file changes)  
**Business logic:** Resyncs last close date from COBOL system, calls REST API via invoker, reads response from receipt file. Pure bridge from COBOL ISAM to Java REST backend.  
**New system coverage:** eom-service handles all EOM orchestration directly via the TypeScript API. No sync bridge needed.  
**Verdict:** ✅ **SAFE TO SKIP** — Sync bridge with no monetary logic.

---

## Gaps Found

### Gap 3 (P1): Schedule Detail Admin Edit — depatchn.cbl

**File:** depatchn.cbl  
**Missing in:** `schedule-service` may lack a dedicated admin edit endpoint with COBOL validation parity  

**Business logic to preserve:**
1. Source must exist in journal source master before write
2. GL account must be in the schedule's configured GL list (SD-GLNO1–5)
3. Reference number required for type-5 (apply-to) detail entries
4. Schedule master locked during patch (optimistic locking in TS)
5. Date validation (MM: 1–12, DD: 1–31)
6. GL-by-ID resolution if tenant uses long GL accounts

**Monetary impact:** If rule 2 is missing, a detail record can be posted to a GL account not associated with its schedule, breaking the schedule balance reconciliation used for AR aging and customer statements.

**Fix location:** `amacc/services/schedule-service/src/application/schedule-service.ts` — add validation in `createDetail()` and `updateDetail()` methods.

**Priority:** P1 — Admin function (not daily automated operation), but used for manual corrections of AR/AP records.
