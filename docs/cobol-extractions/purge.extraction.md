# COBOL Extraction: purge.cbl

**Extracted:** 2025  
**Extracted By:** GitHub Copilot (Wave 2 — COPILOT.md protocol)  
**Status:** Complete

---

## 1. Source

| Field | Value |
|-------|-------|
| File | `acct/src/purge.cbl` |
| PROGRAM-ID | `PURGE` (quoted — reserved word in COBOL) |
| Lines | 2,363 |
| Last Modified | 2024 (AMACC-11958) |
| Copybooks | sched.fc/fd, detail.fc/fd, gl.fc/fd, jrn.fc/fd, missdoc.fc/fd, sys.fc/fd, tran.fc/fd |
| CALLs | `caaccteom` (UI gatekeeper), `pushunposted` (import unposted to program 37), `schedprn` (schedule print), `fssupp`/`fsisapproved`/`fsisjavaon` (financial statements), `getfssetups`/`getdcssw`/`getcode3` (FS config), `eomsync` (status sync at EOJ), `getaclnk`/`getglbyid`/`dialog2`/`omname`/`delnasales`/`log4cobol` (support) |

---

## 2. Purpose

Purge.cbl is the **EOM close orchestrator** — the single COBOL program that drives the entire month-end close sequence for accounting. It owns the 13-step workflow (ACSYS-TRACK-EOM), enforces all preconditions, calls all subordinate programs, and updates the last-close date atomically at EOJ.

**EOM Step sequence (ACSYS-TRACK-EOM values):**

| Track | Action |
|-------|--------|
| 0 | Not started |
| 5 | User on PURGE screen |
| 10 | File backups (zip) |
| 20 | schedprn detailed report |
| 25 | schedprn summary report |
| 62 | Generate Java EOM reports |
| 65 | Archive DocMate reports |
| 68 | Archive financial statements |
| 70 | Delete orphan detail records (no schedule master) |
| 100 | Updating/purging Schedule Detail file |
| 200 | Updating/purging GL & Journal files |
| 300 | Purging Missing Doc file |
| 0 (EOJ) | Reset to zero + update ACSYS-LSTCLOS-DATE |

Steps ≤70 are safe to reset and restart. Steps ≥100 are destructive (file purges) — cannot be safely restarted from scratch.

---

## 3. Business Invariants

### INV-EOM-01: No second simultaneous close
`ACSYS-TRACK-EOM ≠ 0` at startup → "Another session is currently running EOM" error and exit.  
TypeScript: Postgres `SELECT FOR UPDATE NOWAIT` on the EOMClose row. HTTP 409 if row is locked.

### INV-EOM-02: Previous failed close requires Auto/Mate intervention
If `ACSYS-TRACK-EOM > 0 AND ≠ 5` at startup → "Previous attempt failed in step N" error and exit.  
**No automatic retry.** Steps ≥100 may leave files in a partially purged state.  
TypeScript: `BLOCKED` status with step number exposed. `resumeFromStep()` route for manual recovery.

### INV-EOM-03: No unposted transactions in the period
All transactions dated ≤ CUT-DATE must be posted before EOM proceeds.  
Check 1: Scan TRAN-FILE for unposted headers (TR-ACCTNO = LOW-VALUES) with date ≤ CUT-DATE.  
Check 2: Call Java API `GET /acct/pending_transactions/unposted/in_month/{date}` → HTTP 200 = none found, other = found.  
TypeScript: Query `journalEntry` WHERE `status != 'POSTED' AND entryDate <= periodEnd AND tenantId = X`.

### INV-EOM-04: Year must be closed before first fiscal month of new year
When closing the first fiscal month of a new year, all P&L accounts (GL-TYPE = C/E/M/S) must have `GL-OPEN-BAL = 0`.  
If any has a non-zero opening balance, reject the close with "fiscal year must be closed using program 14 first."  
TypeScript: Query `glAccount` for types `COST_OF_SALES|EXPENSE|REVENUE` with `openingBalance != 0` — block if any found.

### INV-EOM-05: Prior-year 13th month must be finalized before closing 11th fiscal month
Check `GET /acct/transactions/13thMonth/{prior_year}` — if any 13th month transactions exist in the prior year, the 11th month close is blocked.  
TypeScript: Use a separate `thirteenthMonthPeriod` flag on EOMClose or query for unfinalized 13th-month entries.

### INV-EOM-06: Last close date must not have been changed concurrently
After user confirmation and before purge begins: re-read system file. If `ACSYS-LSTCLOS-DATE ≠ SAVE-ACSYS-LSTCLOS-DATE`, abort with "Last Close Date Changed."  
TypeScript: Optimistic concurrency — `EOMClose.version` field; TX fails if version changed.

### INV-EOM-07: Journal (JRN) records are retained for 8 years
`JRN-PURGE-DATE = CUT-YEAR - 8`. Records older than 8 years from the close date are deleted.  
TypeScript: GL period balances older than 8 years are soft-deleted or archived. No hard delete without audit.

### INV-EOM-08: Schedule Detail purge behavior by type

| SD-EOM-PURGE | Action |
|---|---|
| 1 | Sum all detail → write balance-forward record → delete transaction records |
| 2 | Delete all records with date ≤ close date |
| 3 | Open-item: if total = 0, delete all records for the control number |
| 4 | Age-credit: same as 2 but age buckets are different |
| 5 | Apply-to: same as 3 but keyed by apply number |
| 6 | Age-debit with sub-totals by GL account |
| 7 | Delete all records (regardless of date) |

TypeScript: `scheduleDetail` archival job with `purgeType` enum on `Schedule` model.

### INV-EOM-09: GL-OPEN-BAL accumulation formula (GL-PURGE step, ACCT_200)

**This formula directly determines the correctness of every subsequent trial balance.**

**COBOL source (purge.cbl GL-PURGE paragraph, track 200):**
```
For each GL account in the GL file:
  GL-OPEN-BAL = 0
  GL-OPEN-CNT = 0
  For each JRN record WHERE JR-GL = this account:
    GL-OPEN-BAL += JR-BALANCE     // accumulate month-to-date running balance
    GL-OPEN-CNT += JR-COUNT       // accumulate unit count
  REWRITE GL-REC                  // write back accumulated opening balance

If closing first fiscal month (CUT-MM = ACSYS-1ST-MONTH):
  Write JRN record at FISYR-BEG-DATE with GL-OPEN-BAL
  // Seeds the new fiscal year's starting balance

Purge: DELETE JRN records WHERE JR-DATE < (CUT-YEAR - 8)
  // 8-year retention (INV-EOM-07)
```

**TypeScript equivalent formula (ACCT_200 handler):**
```
// Step 1: For each GL account, sum all period balances for the closing period
// and add to openingBalance
UPDATE glAccount
SET openingBalance += SUM(glAccountPeriodBalance.runningBalance)
WHERE glAccountPeriodBalance.periodYear = closingYear
  AND glAccountPeriodBalance.periodMonth = closingMonth
  AND glAccountPeriodBalance.tenantId = tenantId

// Step 2 (first fiscal month only): seed fiscal-year-begin balance record

// Step 3: purge period balances older than 8 years
DELETE glAccountPeriodBalance WHERE periodYear < closingYear - 8
```

**Precision requirement:** `GLAccountPeriodBalance.runningBalance` is `Decimal @db.Decimal(15, 2)` in the GL service schema. The accumulation must use `Prisma.Decimal` arithmetic — NOT JavaScript `+` — to prevent float drift across potentially thousands of accounts. Same requirement as year-end RE accumulation.

### INV-EOM-10: GL opening balance is written at start of each fiscal year
When closing the first fiscal month (`CUT-MM = ACSYS-1ST-MONTH`): write a JRN record at `FISYR-BEG-DATE` with the opening balance. This seeds the fiscal year's running balance.  
TypeScript: `GLAccountPeriodBalance` at `(periodYear, firstFiscalMonth)` is seeded during EOM ACCT_200 step.

### INV-EOM-11: Close date is updated atomically at EOJ only
`ACSYS-LSTCLOS-DATE` and `ACSYS-CUTOFF-DATE` are updated **only after all purges complete successfully**.  
TypeScript: `EOMClose.status = COMPLETED` + `closedDate` updated inside a single Prisma transaction as the final step.

---

## 4. State Mutations

| COBOL | Effect | TypeScript Equivalent |
|-------|--------|----------------------|
| `ACSYS-TRACK-EOM` | Progress tracking; prevents concurrent close | `EOMClose.currentStep` + optimistic lock |
| `ACSYS-LSTCLOS-DATE` | Updated to CUT-DATE at EOJ | `EOMClose.closedDate` / `tenant.lastCloseDate` |
| `ACSYS-CUTOFF-DATE` | Same as LSTCLOS-DATE at EOJ | `tenant.cutoffDate` |
| DETAIL-MF | Purged / balance-forwarded per schedule type | `scheduleDetail` archive job |
| JOURNAL-MF | Old records deleted, GL-OPEN-BAL accumulated, year-begin record written | `glAccountPeriodBalance` archival + seed |
| GL-MF | `GL-OPEN-BAL` and `GL-OPEN-CNT` accumulated from JRN records and rewritten | `glAccount.openingBalance` update |
| MISS-DOC-FILE | Records ≤ CUT-DATE deleted | `missingDoc` archival |

---

## 5. Preconditions

1. `ACSYS-TRACK-EOM = 0` (no close in progress or previously completed)
2. No unposted transactions in or before the period
3. If first fiscal month: all P&L accounts have zero opening balance (year was closed)
4. If closing 11th fiscal month: prior year's 13th month is finalized
5. Last close date has not been changed by another session since the user started
6. Fiscal year-to-date close sequence is correct (no gaps)

---

## 6. Failure Modes

| COBOL Condition | COBOL Effect | TypeScript Handling |
|---|---|---|
| ACSYS-TRACK-EOM > 0 at startup | Error dialog, exit — no auto-recovery | `EOMCloseBlockedError`, expose step number in response |
| Unposted transactions found | Error dialog, reset track to 0, exit | `UnpostedTransactionsBlockedError` with count |
| File backup (zip) failure | Non-fatal: message only | Warning event, close continues |
| Java report generation failure | Fatal: exit with error | `ReportGenerationError` — marks step BLOCKED |
| ftp.archam (DocMate) failure | Error dialog, exit | `ArchiveError` — marks step BLOCKED |
| DETAIL-MF write fails (balance forward) | Fatal error dialog, exit | Prisma TX rollback — step BLOCKED |
| GL-MF write fails | Fatal error dialog, exit | Prisma TX rollback — step BLOCKED |
| eomsync failure | Non-fatal: sync retried via outbox | Outbox processor handles retry |

---

## 7. Decision: FIX + EXTEND

The existing `eom-service` partially implements this. Critical gaps:
- Missing close precondition checks (unposted count, year-closed check, 13th month check)
- No year-end close capability (see yrend.extraction.md)
- No step ≥100 implementation (detail purge, GL purge, missdoc purge)
- Missing `previewMonthEnd()` intelligence function
- Missing resumable step execution (steps ≥100 cannot be restarted from scratch)

---

## 8. Improvements Over COBOL

| COBOL Limitation | TypeScript Solution |
|---|---|
| ACSYS-TRACK-EOM = single integer, one company | `EOMClose` row per tenant/period; concurrent closes for different tenants are safe |
| Steps 5–70 safe to restart; ≥100 not restartable | All steps idempotent via Prisma upsert/archive; any step can be resumed |
| Manual "call Auto/Mate" for failed step recovery | `POST /{id}/retry-step` — automated retry with max retry count |
| No visibility into close state from outside | HTTP API; `GET /{id}/steps` shows each step status and error message |
| No close readiness preview | `GET /preview` returns blocking conditions before close starts |
| File backup was zip on disk — lost on server crash | PostgreSQL schema snapshots or S3 archive (platform addition) |
| eomsync was a synchronous HTTP call at EOJ | Outbox event `EOM_CLOSE_COMPLETED` — async, reliable |
| No audit trail of who closed the month | `EOMClose.initiatedByUserId`, `closedByUserId` fields |
