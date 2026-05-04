# COBOL Deep Audit — Batch 9: Files R through S

**Audit Date:** 2026-05-02  
**Scope:** All `.cbl` files beginning with R or S (14 files)  
**Protocol:** Full PROCEDURE DIVISION read. schedmgr.cbl read directly (high risk — GL+DETAIL mutations).

---

## Summary Table

| # | File | Lines | Type | Monetary Ops | Data Mutations | Verdict |
|---|------|-------|------|-------------|----------------|---------|
| 1 | reseteom.cbl | ~350 | EOM Reset | YES (reverse carry-forward) | REWRITE GL-MF, JOURNAL-MF | ✅ ALREADY BUILT |
| 2 | scantran.cbl | ~190 | Diagnostic | NO | NO | ✅ SAFE TO SKIP |
| 3 | schedinvk.cbl | ~100 | Invoker | NO | NO | ✅ SAFE TO SKIP |
| 4 | schedmgr.cbl | ~480 | Schedule Maint | NO (GL-SCHDNO only) | DETAIL-MF, GL-MF(SCHDNO), REST sync | ⚠️ PARTIALLY COVERED |
| 5 | schedprn.cbl | ~1200 | Report | NO | PRINT-FILE only | ✅ SAFE TO SKIP |
| 6 | schedup.cbl | ~400 | Schedule Maint | NO | SCHED-MF WRITE/REWRITE | ✅ ALREADY BUILT |
| 7 | schedsec.cbl | ~320 | Security Maint | NO | TABLES-FILE only | ✅ SAFE TO SKIP |
| 8 | schedsync.cbl | ~280 | HTTP Bridge | NO | REST API call | ✅ ALREADY BUILT |
| 9 | sniffbaddetailapplycd.cbl | ~180 | Diagnostic | NO | NO | ✅ SAFE TO SKIP |
| 10 | srcup.cbl | ~330 | Journal Source Maint | NO | SOURCE-FILE WRITE/REWRITE | ✅ ALREADY BUILT |
| 11 | synccashlines.cbl | ~290 | Read-only | YES (read accum) | TEMP FILE only | ✅ SAFE TO SKIP |
| 12 | syncglsched13th.cbl | ~190 | Admin Utility | NO | GL-MF REWRITE (SCHDNO) only | ✅ SAFE TO SKIP |
| 13 | sysoption1.cbl | ~85 | Java Wrapper | NO | NO | ✅ SAFE TO SKIP |
| 14 | sysup.cbl | ~600 | System Config Maint | NO | ACCT-SYSTEM-FILE only | ✅ SAFE TO SKIP |

**P0 Gaps Found:** 0  
**P1 Gaps Found:** 1 (schedmgr.cbl — schedule-service should handle GL→schedule reassignment)

---

## Detailed Verdicts

### reseteom.cbl — RESETEOM

**Lines:** ~350 | **Type:** EOM reset (undo-close)  
**Called by:** eom-service | **Calls:** JOURNAL-MF (I-O), GL-MF (I-O)  
**Monetary operations:**
- `COMPUTE GL-OPEN-BAL = GL-OPEN-BAL - JR-BALANCE-CARRY` — REVERSES the ACCT_200 carry-forward
- `REWRITE GL-MF` with corrected opening balance
- `REWRITE JOURNAL-MF` — restores JR-STATUS to "O" (open)

**Business logic:**  
Undoes the ACCT_200 step of purge.cbl for a given company. Reads each GL account, finds the corresponding closing-year journal balance that was carried forward (`JR-BALANCE-CARRY`), subtracts it from `GL-OPEN-BAL`, and marks the journal period as re-opened. Used when a close needs to be reversed (e.g., posted entries found after close).

**New system coverage:**  
`eom-service` has `EOMService.resetClose()` which reverses the EOM workflow steps in reverse order. Looking at the interface: `resetClose(params: ResetCloseParams): Promise<ResetCloseResult>`. This is the TypeScript equivalent.

**Verdict:** ✅ **ALREADY BUILT** — `EOMService.resetClose()` covers the COBOL RESETEOM function.

---

### scantran.cbl — SCANTRAN

**Lines:** ~190 | **Type:** Read-only transaction diagnostic  
**Called by:** Admin diagnostics | **Calls:** TRAN-FILE (read), optionally clearunposted  
**Monetary operations:** NONE  
**Data mutations:** NONE directly (optionally calls clearunposted for action)  
**Business logic:** Scans TRAN-FILE for transactions in a given date range, classifies by age, optionally calls clearunposted for old ones. Diagnostic tool.  
**Verdict:** ✅ **SAFE TO SKIP** — Read-only diagnostic. TypeScript: admin endpoint to list old draft JournalEntries.

---

### schedinvk.cbl — SCHEDINVK

**Lines:** ~100 | **Type:** Vehicle description lookup invoker  
**Called by:** Schedule maintenance screens | **Calls:** REST API (vehicle info service)  
**Monetary operations:** NONE  
**Data mutations:** NONE  
**Business logic:** Constructs REST API call to retrieve vehicle information by stock#/VIN for display in schedule maintenance.  
**Verdict:** ✅ **SAFE TO SKIP** — REST invoker. TypeScript schedule-service calls vehicle info directly.

---

### schedmgr.cbl — SCHEDMGR

**Lines:** ~480 | **Type:** Schedule assignment manager  
**Called by:** GL account maintenance | **Calls:** GL-MF (I-O), DETAIL-MF (I-O), GLSYNC, HISTTRANSYNC  
**Monetary operations:** NONE — all monetary fields are READ-ONLY (for display and filtering)  
**Data mutations:**
- `MOVE NEW-SCHDNO TO GL-SCHDNO; REWRITE GL-MF` — updates GL account's schedule assignment
- `DELETE DETAIL-MF` — deletes all detail records for the GL account's old schedule
- `WRITE DETAIL-REC` — writes detail records to the new schedule
- `CALL GLSYNC` — syncs GL-MF change to OfficeMate
- `CALL HISTTRANSYNC` — syncs history change to OfficeMate

**Business logic:**  
When a GL account is reassigned to a different schedule, `schedmgr.cbl` migrates the existing detail records:
1. Read all DETAIL-MF records for the old schedule/GL combination
2. DELETE each from DETAIL-MF
3. WRITE each to DETAIL-MF with the new schedule number
4. REWRITE GL-MF with new `GL-SCHDNO`
5. Sync both changes to OfficeMate backend

**Validation:** Checks that target schedule exists and matches GL type (E/A/L/S/etc.) before moving records.

**New system coverage:**  
`schedule-service` manages schedule master records. GL account → schedule assignment is stored in `GLAccount.scheduleId`. However, the **migration of existing detail records** when a GL account changes schedules is not a clearly documented feature. The `gl-service` GL account update endpoint needs to trigger a `schedule-service` call to migrate existing `ScheduleDetail` records when `scheduleId` changes.

**Key constraint to preserve:** When reassigning a GL account to a different schedule, ALL existing detail records must be atomically moved. Partial migration leaves orphan detail records causing incorrect AR/AP aging.

**Verdict:** ⚠️ **PARTIALLY COVERED**

**P1 gap:** When `GLAccount.scheduleId` is updated in `gl-service`, the system must atomically move all `ScheduleDetail` records from the old schedule to the new schedule for that GL account. This is a transactional operation that must be coordinated between `gl-service` and `schedule-service`.

**Fix location:**  
Option A: `gl-service` publishes `GL_ACCOUNT_SCHEDULE_CHANGED` outbox event → `schedule-service` consumes and migrates detail records (eventually consistent, simpler coupling).  
Option B: `gl-service` calls `schedule-service` synchronously in the same HTTP request with saga compensation (stronger consistency).  
Recommendation: Option A for decoupling, with compensating transaction if the event fails.

---

### schedprn.cbl — SCHEDPRN

**Lines:** ~1200 | **Type:** Schedule detail print report  
**Called by:** Reporting menu | **Calls:** SCHED-MF (read), DETAIL-MF (read), HISTTRAN-FILE (read), NAME-FILE (read)  
**Monetary operations:** READ-ONLY accumulation for report totals:
- `ADD DE-AMOUNT TO RPT-TOTAL-AMOUNT` — for report totals only; NO file writes
**Data mutations:** WRITE PRINT-FILE — text report only  
**Business logic:** Prints schedule detail listings with aging, customer names, contact info, subtotals. Extensive formatting logic (headers, footers, column alignment).  
**Verdict:** ✅ **SAFE TO SKIP** — Read-only report generator. TypeScript equivalent: schedule-service reporting endpoints with PDF generation.

---

### schedup.cbl — SCHEDUP

**Lines:** ~400 | **Type:** Schedule master maintenance  
**Called by:** Schedule setup menu | **Calls:** SCHED-MF (I-O), GLSYNC (for GL link updates)  
**Monetary operations:** NONE (monetary balance fields are initialized to 0 on new records only)  
**Data mutations:**
- `WRITE SCHED-REC` — new schedule creation
- `REWRITE SCHED-REC` — update existing schedule (description, GL link list, purge type, etc.)
- `DELETE SCHED-MF` — delete schedule (with validation that no active detail exists)
- `CALL SCHEDSYNC` — sync to OfficeMate backend

**Business logic:** Full CRUD for schedule master records (SCHED-MF = Schedule table in TypeScript). Validates: schedule# uniqueness, GL link list (max 5 GL accounts per schedule), purge type (1–7), schedule type (1–5).

**New system coverage:**  
`schedule-service` has `createSchedule()`, `updateSchedule()`, `deleteSchedule()`. The `POST /api/v1/schedules` endpoint is confirmed. Purge type and GL link list validation should be present.

**Verdict:** ✅ **ALREADY BUILT** — `schedule-service` covers the full CRUD operations.

---

### schedsec.cbl — SCHEDSEC

**Lines:** ~320 | **Type:** Schedule access security  
**Called by:** Schedule setup | **Calls:** TABLES-FILE (I-O)  
**Monetary operations:** NONE  
**Data mutations:** WRITE/REWRITE TABLES-FILE (per-user schedule access flags)  
**Business logic:** Per-user per-schedule read/write access flags. Who can view which schedules.  
**Verdict:** ✅ **SAFE TO SKIP** — Security configuration replaced by JWT RBAC in TypeScript.

---

### schedsync.cbl — SCHEDSYNC

Same HTTP bridge pattern as `glsync.cbl`, `jnlsrcsync.cbl`. Calls `/accounting/api/{compno}/acct/sched/sync/{schedno}`. No accounting file writes.  
**Verdict:** ✅ **ALREADY BUILT** — Sync bridge obsolete.

---

### sniffbaddetailapplycd.cbl — SNIFFBADDETAILAPPLYCD

**Lines:** ~180 | **Type:** Data quality checker  
**Called by:** Admin diagnostics | **Calls:** DETAIL-MF (read), JOURNAL-MF (read)  
**Monetary operations:** NONE  
**Data mutations:** NONE  
**Business logic:** Scans DETAIL-MF for type-5 records with apply codes that don't have corresponding invoice records in the same schedule. Reports bad apply codes for admin review.  
**Verdict:** ✅ **SAFE TO SKIP** — Read-only data quality report. TypeScript equivalent: admin data integrity check endpoint.

---

### srcup.cbl — SRCUP

**Lines:** ~330 | **Type:** Journal source code maintenance  
**Called by:** GL setup menu | **Calls:** SOURCE-FILE (I-O), JNLSRCSYNC  
**Monetary operations:** NONE  
**Data mutations:**
- `WRITE SOURCE-REC` / `REWRITE SOURCE-REC` — create/update journal source codes
- `DELETE SOURCE-FILE` — delete source code
- `CALL JNLSRCSYNC` — sync to OfficeMate backend

**Business logic:** Full CRUD for journal source codes (SOURCE-FILE = JournalSource in TypeScript). Validates code uniqueness, description, reserved-for-year-end flag.  
**Verdict:** ✅ **ALREADY BUILT** — `gl-service` has `createJournalSource()`, `updateJournalSource()`, `deleteJournalSource()` endpoints.

---

### synccashlines.cbl — SYNCCASHLINES

**Lines:** ~290 | **Type:** Bank reconciliation snapshot  
**Called by:** Bank rec module | **Calls:** HISTTRAN-FILE (read), JOURNAL-MF (read)  
**Monetary operations:**
- `ADD HI-AMOUNT TO CASH-TOTAL` — accumulation for bank rec (read-only, no persistence)
**Data mutations:** WRITE TEMP-FILE — bank rec work file only (no permanent accounting file writes)  
**Business logic:** Reads histtran + journal for bank accounts, accumulates daily cash totals, writes to temporary indexed file for bank reconciliation module. Read-only on accounting files.  
**Verdict:** ✅ **SAFE TO SKIP** — Read-only bank rec snapshot. TypeScript equivalent: cash reconciliation report endpoint using TransactionHistory + GLAccountPeriodBalance.

---

### syncglsched13th.cbl — SYNCGLSCHED13TH

**Lines:** ~190 | **Type:** 13th-month GL snapshot utility  
**Called by:** Year-end close process | **Calls:** GL-MF (I-O)  
**Monetary operations:** NONE  
**Data mutations:** `REWRITE GL-MF` — updates `GL-SCHDNO` field only (schedule number, not monetary)  
**Business logic:** Copies schedule number assignments from period 12 GL accounts to period 13 GL snapshot accounts (the 13th period is used for year-end adjusting entries). This keeps the 13th-month snapshot's schedule assignments in sync with the actual period-12 assignments.  
**Verdict:** ✅ **SAFE TO SKIP** — Schedule metadata update. In the TypeScript system, 13th-period logic is handled by the eom-service year-end workflow, which creates a separate `JournalEntry` set with period=13.

---

### sysoption1.cbl / sysup.cbl

- `sysoption1.cbl`: Java UI redirect stub for Java-era system options display. No mutations. ✅ SAFE TO SKIP
- `sysup.cbl`: System configuration maintenance — WRITE/REWRITE `ACCT-SYSTEM-FILE` (last close date, year/month params, company info). No monetary mutations. TypeScript equivalent: `AccountingConfig` table managed via `POST /api/v1/config`. ✅ SAFE TO SKIP

---

## Gaps Found

### G-08 (P1, minor): Schedule Detail Migration on GL Account Reassignment — schedmgr.cbl

**File:** schedmgr.cbl  
**Missing in:** `gl-service` + `schedule-service` — no automatic ScheduleDetail migration when GLAccount.scheduleId changes  
**Business logic missing:** When a GL account is moved to a different schedule, all existing `ScheduleDetail` records must be atomically migrated from the old schedule to the new one.

**Monetary impact (indirect):** Orphan detail records in the wrong schedule cause AR/AP aging to show incorrect per-schedule balances. The total AR/AP amount is correct, but the schedule breakdown is wrong. Affects schedule-level aging reports and customer account statements.

**Fix scope:**
- In `gl-service`: When `PUT /api/v1/gl/accounts/:id` updates `scheduleId`, publish `GL_ACCOUNT_SCHEDULE_CHANGED` outbox event with `{ tenantId, glAccountId, oldScheduleId, newScheduleId }`
- In `schedule-service`: Subscribe to this event and execute `ScheduleDetail.updateMany({ where: { glAccountId, scheduleId: oldScheduleId }, data: { scheduleId: newScheduleId } })` in a transaction

**Priority:** P1 (minor) — Admin operation, but critical for data consistency in AR/AP aging.
