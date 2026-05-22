# COBOL → TypeScript Traceability Matrix

**Generated:** 2026-05-03  
**Scope:** All P1 gap closures from Stream 1 + core monetary programs  
**Format:** COBOL program → TypeScript symbol → test coverage

---

## Gap Closure Traceability

| Gap# | COBOL Source | COBOL Paragraph / Data-Item | TypeScript Symbol | File | Test File |
|------|-------------|----------------------------|-------------------|------|-----------|
| G-09 | `tranpost.cbl` | `DB-ENTRY` / `CR-ENTRY` paragraphs; `HI-COUNT COMPUTE` | `computeUnitCount()` | `gl-service/src/domain/unit-count.ts` | `gl-service/src/tests/test-unit-count.ts` |
| G-03 | `depatchn.cbl` | `EDT-DETAIL` validation block; `REPLACE-DETAIL` | `ScheduleApplicationService.updateDetail()` | `schedule-service/src/application/schedule-service.ts` | `schedule-service/src/tests/test-update-detail.ts` |
| G-08a | `inquiryn.cbl` | `APPLY-NUMBER` / `APPLY-CD` field update | `ScheduleApplicationService.updateDetailApplyNumber()` | `schedule-service/src/application/schedule-service.ts` | `schedule-service/src/tests/test-update-detail.ts` |
| G-08b | `schedmgr.cbl` | `REVIEW-RESET-GL-SCHDNO` / `REVIEW-SET-GL-SCHDNO` | `GLService.updateAccount()` → `outboxEvent` → `ScheduleEventHandlers.handleGLAccountScheduleChanged()` | `gl-service/src/application/gl-service.ts`, `schedule-service/src/application/event-handlers.ts` | `schedule-service/src/tests/test-schedule-changed-event.ts` |
| G-04 | `glzero.cbl` | `ZERO-GL-OPEN-BAL` paragraph; `GL-OPEN-BAL := 0` | `GLService.resetForOwnershipChange()` (combined) | `gl-service/src/application/gl-service.ts` | `gl-service/src/tests/test-ownership-reset.ts` |
| G-05 | `glzerosch.cbl` | Same as G-04 + `ZERO-GL-SCHDNO`; `GL-SCHDNO := spaces` | `GLService.resetForOwnershipChange({ clearScheduleAssignments: true })` | Same | Same |
| G-06 | `jrnzero.cbl` | `DELETE-JRN-PERIOD-BAL`; `JRN-MF DELETE` | `GLService.resetForOwnershipChange({ clearPeriodBalances: true })` | Same | Same |
| G-07 | `purge.cbl` ACCT_200 | `CARRY-FWD-LOOP`; `GL-OPEN-BAL += SUM(period-bal)`; 8-year purge | `AcctGLPurgeHandler.execute()` → `POST /api/v1/gl/admin/period-carry-forward` | `eom-service/src/domain/step-handlers.ts`, `gl-service/src/http/routes.ts` | `eom-service/src/tests/test-acct-gl-purge.ts` |
| G-02 | `crfinchg.cbl` | `FINANCE-CHARGE-CALC`; `FC-AMT = HI-AMT * FC-RATE / 100`; `POST-FC-JOURNAL` | `FinanceChargeJob.run()` | `apar-service/src/application/finance-charge-job.ts` | `apar-service/src/tests/test-finance-charge-job.ts` |
| G-01 | `consolgl.cbl` | `CIRCULAR-REF-CHECK`; `DUP-COMPANY-GUARD` | `ConsolidationService.validateHierarchy()` | `group-service/src/application/consolidation-service.ts` | (prior session) |

---

## Core Monetary Program Traceability

### tranpost.cbl — Journal Entry Posting Engine

| COBOL Paragraph | COBOL Data Item | TypeScript Equivalent | Location |
|----------------|----------------|----------------------|----------|
| `MAIN-POST-LOOP` | `TR-FILE READ NEXT` | `approveJournalEntry()` line loop | `gl-service/src/application/gl-service.ts` |
| `DB-ENTRY` | `COMPUTE HI-AMT = TR-DR-AMT - TR-CR-AMT` | `netAmount = debit - credit` | Same |
| `UPDATE-GL-BAL` | `GL-RUN-BAL += HI-AMT` | `gLAccountPeriodBalance.upsert({ runningBalance: { increment } })` | Same |
| `DB-ENTRY` / `CR-ENTRY` | `COMPUTE HI-COUNT = TR-COUN * sign` | `computeUnitCount(netAmount, accountType, revAdjFlag, trackUnits)` | `gl-service/src/domain/unit-count.ts` |
| `UPDATE-HISTTRAN` | `HISTTRAN-MF WRITE` | `historyTransaction.create(...)` | `gl-service/src/application/gl-service.ts` |
| `POST-COST-INV` | `COSINV-CHAIN` pattern | `postCOSINVChain()` | Same |
| `VALIDATE-BALANCE` | `IF DEBIT-TOTAL ≠ CREDIT-TOTAL` | `validateDoubleEntry()` in pre-flight | `gl-service/src/domain/validation-engine.ts` |
| `SERIALIZABLE LOCK` | ISAM file locking (OS-level) | `$transaction({ isolationLevel: 'Serializable' })` | Same |

### yrend.cbl — Year-End Close

| COBOL Invariant | COBOL Logic | TypeScript Equivalent | Location |
|----------------|------------|----------------------|----------|
| YE-INV-01 | All journals POSTED before YE | `preflightYearEnd()` status check | `eom-service/src/application/eom-service.ts` |
| YE-INV-02 | Retain ≥ 1 year of history | Config `retainYears ≥ 1` guard | Same |
| YE-INV-03 | P&L net → retained earnings | `executeYearEnd()` RE calculation | Same |
| YE-INV-04 | YE entry flagged `isYearEnd = true` | `isYearEnd` field on JournalEntry | `gl-service/prisma/schema.prisma` |
| YE-INV-05 | YE entry cannot be reversed | `rejectYearEndReversal()` guard | `gl-service/src/application/gl-service.ts` |
| YE-INV-06 | RE account must exist | `getRetainedEarningsAccount()` or throw | `eom-service/src/application/eom-service.ts` |
| YE-INV-07 | `ACC-1445`: no C/I histtran on YE | `if (isYearEnd && (C|I)) return` | `gl-service/src/application/gl-service.ts` |

### purge.cbl — EOM Schedule Purge (ACCT_100)

| COBOL Purge Type | COBOL Logic | TypeScript Equivalent | Location |
|-----------------|------------|----------------------|----------|
| Type 1 | Delete ALL details ≤ closeDate | `purgeType1()` — deleteByScheduleBeforeDate | `schedule-service/src/application/schedule-service.ts` |
| Type 2 | Carry forward balance, delete rest | `purgeType2()` — create BF + delete | Same |
| Type 3 | Zero-balance purge (by control#) | `purgeType3()` — sum per control, delete if 0 | Same |
| Type 4 | Age-based (30/60/90) purge | `purgeType4()` — delete aged buckets | Same |
| Type 5 | Apply-number purge | `purgeType5()` — delete by applyNumber match | Same |
| Type 6 | Fiscal-year end full clear | `purgeType6()` — deleteByScheduleBeforeDate (FY) | Same |
| Type 7 | Hard purge ALL | `purgeType7()` — deleteBySchedule | Same |
| ACCT_200 | GL opening-balance carry-forward + 8-yr retention | `AcctGLPurgeHandler.execute()` | `eom-service/src/domain/step-handlers.ts` |

### crfinchg.cbl — Finance Charge Calculation

| COBOL Paragraph | COBOL Formula | TypeScript Equivalent | Location |
|----------------|--------------|----------------------|----------|
| `FINANCE-CHARGE-CALC` | `FC-AMT = HI-AMT * FC-RATE / 100` | `chargeAmount = aged * (annualRatePercent / 100) / 12` | `apar-service/src/application/finance-charge-job.ts` |
| `MARK-FC-APPLIED` | `SET HI-APPLY-CD = 'F'` | `PATCH /apply-number { applyCd: 'F' }` | Same |
| `POST-FC-JOURNAL` | DR receivable / CR revenue GL | `POST /api/v1/gl/journal-entries` DR+CR | Same |
| Grace period | `IF AGE <= GRACE SKIP` | `if (ageDays(detail) <= config.gracePeriodDays) continue` | Same |
| Minimum balance | `IF HI-AMT < MIN-AMT SKIP` | `if (balance < config.minimumBalance) continue` | Same |

### consolgl.cbl — Group Consolidation

| COBOL Paragraph | COBOL Logic | TypeScript Equivalent | Location |
|----------------|------------|----------------------|----------|
| `CIRCULAR-REF-CHECK` | DFS through company hierarchy | `validateHierarchy()` cycle detection | `group-service/src/application/consolidation-service.ts` |
| `DUP-COMPANY-GUARD` | Check for duplicate companyId in tree | `validateNoDuplicateCompanies()` | Same |
| `SUM-BALANCES` | Sum all GL balances per account type | `consolidate()` aggregation | Same |
| `ELIMINATIONS` | Intercompany journal elimination | `applyEliminations()` | Same |

---

## Data-Item to Schema Traceability

| COBOL Data Item | COBOL File | PostgreSQL Column | Prisma Model |
|----------------|-----------|------------------|-------------|
| `GL-RUN-BAL` | `GL.FC` | `runningBalance` | `GLAccountPeriodBalance` |
| `GL-OPEN-BAL` | `GL.FC` | `openingBalance` | `GLAccount` |
| `GL-OPEN-CNT` | `GL.FC` | `openingUnitCount` | `GLAccount` |
| `GL-SCHDNO` | `GL.FC` | `scheduleCode` | `GLAccount` |
| `GL-ADDUNITS` | `GL.FC` | `trackUnits` | `GLAccount` |
| `HI-COUN` / `TR-COUN` | `HISTTRAN.FC` | `unitCount` | `HistoryTransaction` |
| `HI-APPLY-NO` | `HISTTRAN.FC` | `applyNumber` | `ScheduleDetail` |
| `HI-APPLY-CD` | `HISTTRAN.FC` | `applyCd` | `ScheduleDetail` |
| `HI-JE-ID` | `HISTTRAN.FC` | `journalEntryId` | `ScheduleDetail` |
| `HI-REV-ADJ` | `HISTTRAN.FC` | `revAdjFlag` (on JournalEntry) | `JournalEntry` |
| `SD-AMT` | `SCHED.FD` | `amount` | `ScheduleDetail` |
| `SD-CONTROL-NO` | `SCHED.FD` | `controlNumber` | `ScheduleDetail` |
| `SD-BAL-CURR` | `SCHED.FD` | `balanceCurrent` | `ScheduleDetail` |
| `SD-BAL-30` | `SCHED.FD` | `balanceOver30` | `ScheduleDetail` |
| `SD-BAL-60` | `SCHED.FD` | `balanceOver60` | `ScheduleDetail` |
| `SD-BAL-90` | `SCHED.FD` | `balanceOver90` | `ScheduleDetail` |
| `TR-REV-ADJ` | `TRAN.FC` | `revAdjFlag` | `JournalEntryLine` |
| `TR-ADDUNITS` | `TRAN.FC` | `trackUnits` (resolved from GLAccount) | `GLAccount` |
| `JRN-MF` | `JRN.FD` | (rows in) `GLAccountPeriodBalance` | `GLAccountPeriodBalance` |

---

## Multi-Tenant Architecture Delta

| COBOL Assumption | TypeScript Resolution |
|-----------------|----------------------|
| Single company — tenant implicit | `tenantId` on every table row + `x-tenant-id` header mandatory (401 if missing) |
| ISAM file locking for concurrency | `$transaction({ isolationLevel: 'Serializable' })` via Prisma |
| OOB conditions require repair programs | Impossible by design — atomic transactions prevent partial writes |
| Buy/sell ownership change = run 3 programs | `GLService.resetForOwnershipChange()` atomic in single transaction |
| COBOL source codes validated via SRCSYS-FILE | HTTP call to gl-service `/admin/journal-sources/:code` (fail-open on network error) |
| Finance charge = nightly batch on file server | `FinanceChargeJob.run()` HTTP-callable, cron-schedulable |
| Schedule detail migration = manual reconciliation | Outbox event `GL_ACCOUNT_SCHEDULE_CHANGED` → `migrateByGLAccount()` async |

---

## Test Coverage Summary

| Service | Test File | Gap Coverage | Lines |
|---------|-----------|-------------|-------|
| gl-service | `test-unit-count.ts` | G-09 (18 truth-table rows + edge cases) | ~75 |
| gl-service | `test-ownership-reset.ts` | G-04, G-05, G-06 | ~138 |
| gl-service | `test-posting-engine.ts` | Core posting (pre-existing) | — |
| gl-service | `test-double-entry.ts` | Balance validation (pre-existing) | — |
| schedule-service | `test-update-detail.ts` | G-03, G-08a (6 validations + apply-number) | ~195 |
| schedule-service | `test-schedule-changed-event.ts` | G-08b (schedule migration handler) | ~94 |
| schedule-service | `test-schedule-service.ts` | Core CRUD (pre-existing) | — |
| eom-service | `test-acct-gl-purge.ts` | G-07 (carry-forward + 8-yr retention) | ~102 |
| eom-service | `test-period-close.ts` | Core EOM steps (pre-existing) | — |
| apar-service | `test-finance-charge-job.ts` | G-02 (FC calc + GL posting + marking) | ~177 |
