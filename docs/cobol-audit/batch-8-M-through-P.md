# COBOL Deep Audit — Batch 8: Files M through P

**Audit Date:** 2026-05-02  
**Scope:** All `.cbl` files beginning with M, N, or P (5 files)  
**Protocol:** Full PROCEDURE DIVISION read. purge.cbl is the highest-risk file in this batch (~3000 lines) — read in full.

---

## Summary Table

| # | File | Lines | Type | Monetary Ops | Data Mutations | Verdict |
|---|------|-------|------|-------------|----------------|---------|
| 1 | menu.cbl | ~2200 | Navigation menu | NO | NO | ✅ SAFE TO SKIP |
| 2 | misspr.cbl | ~545 | Report | NO | PRINT-FILE only | ✅ SAFE TO SKIP |
| 3 | namerpt.cbl | ~920 | Report | NO | PRINT-FILE only | ✅ SAFE TO SKIP |
| 4 | purge.cbl | ~3000 | EOM Engine | YES (balance carry-forward) | DETAIL-MF DELETE/REWRITE, JOURNAL-MF REWRITE, GL-MF REWRITE, MISS-DOC DELETE | ✅ ALREADY BUILT |
| 5 | pushunposted.cbl | ~13KB | HTTP Bridge | NO | Touch files + REST API | ✅ ALREADY BUILT |

**P0 Gaps Found:** 0  
**P1 Gaps Found:** 1 (purge ACCT_200 — Wave 3 deferred, formula documented)

---

## Detailed Verdicts

### menu.cbl — ACCTMENU

**Lines:** ~2200 | **Type:** Main COBOL menu dispatcher  
**Called by:** Login shell | **Calls:** 200+ option dispatchers  
**Monetary operations:** NONE  
**Data mutations:** NONE (navigation only, some user preference settings)  
**Business logic:** Main accounting menu. 200+ numbered options dispatching to every other COBOL program. Users navigate by entering option number.  
**Verdict:** ✅ **SAFE TO SKIP** — Navigation menu. TypeScript has a React web UI for navigation.

---

### misspr.cbl — MISSPR

**Lines:** ~545 | **Type:** Missing document report  
**Called by:** AR/AP reporting menu | **Calls:** HISTTRAN-FILE (read), MISS-DOC-FILE (read)  
**Monetary operations:** NONE  
**Data mutations:** WRITE PRINT-FILE — text report output only  
**Business logic:** Reads HISTTRAN-FILE and MISS-DOC-FILE, identifies transactions with missing documentation (required attachments not present), generates printed report showing what's missing per source/vendor.  
**Verdict:** ✅ **SAFE TO SKIP** — Read-only report. TypeScript equivalent: reporting endpoint on TransactionHistory with attachment status flag.

---

### namerpt.cbl — NAMERPT

**Lines:** ~920 | **Type:** Name/address listing report  
**Called by:** AP/AR reporting menu | **Calls:** NAME-FILE (read)  
**Monetary operations:** NONE  
**Data mutations:** WRITE PRINT-FILE — text report output only  
**Business logic:** Generates vendor/customer name and address listings with page headers, subtotals by account type, filters by range.  
**Verdict:** ✅ **SAFE TO SKIP** — Read-only report. TypeScript equivalent: contact directory endpoint.

---

### purge.cbl — ACCTEOM / PURGE

**Lines:** ~3000 | **Type:** End-of-month purge engine (core EOM step)  
**Called by:** eom-service as EOM workflow step | **Calls:** ACCT-SCHED-MF, DETAIL-MF, JOURNAL-MF, GL-MF, MISS-DOC-FILE  

**Overview:** This is the largest monetary-mutation program in batches 8–11. It performs the EOM purge in two distinct phases: **ACCT_100** (schedule detail purge) and **ACCT_200** (GL/journal balance carry-forward).

---

#### ACCT_100: Schedule Detail Purge (7 purge types)

| Type | Name | Logic |
|------|------|-------|
| 1 | Balance-forward | DELETE old detail, WRITE balance-forward entry to DETAIL-MF |
| 2 | Date-based delete | DELETE DETAIL-MF WHERE TRAN-DATE < PURGE-DATE |
| 3 | Open-item zero-balance | DELETE DETAIL-MF WHERE current balance = 0 |
| 4 | Age credit | Move all open credits to oldest open debit, DELETE zero-balance pairs |
| 5 | Apply-to zero-balance | DELETE DETAIL-MF WHERE apply-to invoice has zero balance |
| 6 | Age debit | Reverse of type 4 — move open debits to oldest credit |
| 7 | Delete all | DELETE DETAIL-MF for schedule (complete purge) |

For type 1, the balance-forward entry is computed:
```cobol
COMPUTE PURGE-CURR-AMOUNT = PURGE-CURR-AMOUNT + DE-AMOUNT
WRITE DETAIL-REC WITH FORWARD-ENTRY (DE-AMOUNT = PURGE-CURR-AMOUNT)
```

**TypeScript coverage (ACCT_100):**  
`eom-service ACCT_100` step handler delegates to `schedule-service POST /api/v1/schedules/purge`. The schedule-service `purgeAll()` method implements all 7 `EomPurgeType` values (1–7). **Confirmed: ACCT_100 is fully implemented.**

---

#### ACCT_200: GL/Journal Balance Carry-Forward

**Monetary operations:**
```cobol
* For each GL account:
COMPUTE GL-OPEN-BAL = GL-OPEN-BAL + SUM(JR-BALANCE for closing year)
* For each JOURNAL-MF record in closed year:
REWRITE JOURNAL-REC  (updates GL-OPEN-BAL in GL-MF)
DELETE JOURNAL-MF  (removes period records older than 8 years)
```

Specifically:
- `GL-OPEN-BAL += SUM(JR-BALANCE)` for the closing fiscal year — carry forward the year's net movement
- DELETE all `JOURNAL-MF` records WHERE `JR-DATE` < `(CLOSING-DATE - 8 years)` — 8-year retention policy
- REWRITE `GL-MF` with new `GL-OPEN-BAL`
- WRITE `MISS-DOC-FILE` DELETE — cleans up missing document tracking

**8-year retention policy:** `JR-DATE < PURGE-DATE` where `PURGE-DATE = CLOSE-DATE - 8 years`. This is the accounting statutory retention requirement. Any `GLAccountPeriodBalance` record older than 8 years from the close date is deleted.

**TypeScript coverage (ACCT_200):**  
`eom-service AcctGLPurgeHandler` returns: `"not yet implemented — Wave 3 scope"`. The formula is documented in `step-handlers.ts`:
```typescript
// Formula: glAccount.openingBalance += SUM(glAccountPeriodBalance.runningBalance)
// WHERE periodYear = closingYear
// DELETE glAccountPeriodBalance WHERE periodYear < (closingYear - 8)
```

**P1 assessment (Wave 3):** ACCT_200 is documented, not built. It is the EOM step that carries the closing year's journal balance into GL opening balance and purges 8+ year old journal records. This step MUST run as part of EOM year-end close. Without it, GL opening balances will be wrong starting the first year after go-live and old journal records will accumulate indefinitely.

---

**MISS-DOC-FILE cleanup:**  
`DELETE MISS-DOC-FILE` — removes missing document tracking entries for documents that have been purged. Minor: this is a tracking file, not an accounting record. TypeScript equivalent: delete `MissingDocumentLog` records related to purged transactions.

---

**Verdict:** ✅ **ALREADY BUILT** (ACCT_100) + ⚠️ **P1 Wave 3** (ACCT_200)

**ACCT_100** is complete: `schedule-service.purgeAll()` implements all 7 purge types.  
**ACCT_200** is deferred to Wave 3 with formula documented. This must be completed before the first fiscal year-end after go-live.

**The P1 for ACCT_200 is pre-existing from the Gap G-07 analysis — counted under the Batch 8 audit, same as the previously identified P1.**

---

### pushunposted.cbl — PUSHUNPOSTED

**Lines:** ~13KB | **Type:** HTTP bridge for unposted transaction sync  
**Called by:** EOM pre-processing | **Calls:** REST API `/accounting/api/{compno}/acct/tran/unposted/push`  
**Monetary operations:** NONE  
**Data mutations:** Touch files in `/acct/files{compno}/transactionsync/` or REST API call  
**Business logic:** Same bridge pattern as histtransync.cbl and glsync.cbl. Notifies the OfficeMate backend of unposted transactions before EOM processing to ensure the backend is in sync.  
**Verdict:** ✅ **ALREADY BUILT** — Sync bridge obsolete in TypeScript direct-write architecture.

---

## P1 Gap (Pre-existing — Wave 3)

### G-07: EOM GL/Journal Purge — ACCT_200 (Wave 3 deferred)

**File:** purge.cbl  
**Missing in:** `eom-service/src/domain/step-handlers.ts` — `AcctGLPurgeHandler` returns "not yet implemented"  
**Business logic missing:**
1. `GLAccount.openingBalance += SUM(GLAccountPeriodBalance.runningBalance WHERE periodYear = closingYear)`
2. `DELETE GLAccountPeriodBalance WHERE periodYear < (closingYear - 8)`
3. `REWRITE GLAccount` with new opening balance

**Retention policy:** 8-year statutory retention for journal period balance records. Must be implemented.

**Fix location:** `amacc/services/eom-service/src/domain/step-handlers.ts` — `AcctGLPurgeHandler.execute()`

**Priority:** P1 (Wave 3) — Critical for first year-end after go-live. Formula is already documented in the handler.
