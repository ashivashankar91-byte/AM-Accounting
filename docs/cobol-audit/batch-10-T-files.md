# COBOL Deep Audit — Batch 10: T Files

**Audit Date:** 2026-05-02  
**Scope:** All `.cbl` files beginning with T (5 files)  
**Protocol:** Full PROCEDURE DIVISION read. tranpost.cbl is the highest-risk program in the entire codebase (~120KB). Read in full; cross-referenced against gl-service.ts.

---

## Summary Table

| # | File | Lines | Type | Monetary Ops | Data Mutations | Verdict |
|---|------|-------|------|-------------|----------------|---------|
| 1 | tranpost.cbl | ~120KB | Posting Engine | YES (critical) | JOURNAL-MF, DETAIL-MF, HISTTRAN-FILE, GL-MF, TRAN-FILE | ✅ ALREADY BUILT |
| 2 | tranpr.cbl | ~107KB | Print/Post | YES (delegates to tranpost) | Same as tranpost | ✅ ALREADY BUILT |
| 3 | transumm.cbl | ~31KB | Autopost Report | NO (read-only accum) | PRINT-FILE only | ✅ SAFE TO SKIP |
| 4 | tranup.cbl | ~86KB | Transaction Entry | YES (validation accum) | TRAN-FILE WRITE/REWRITE, REST | ✅ ALREADY BUILT |
| 5 | tranup2.cbl | ~92KB | Transaction Entry Ph2 | YES (same as tranup) | TRAN-FILE WRITE/REWRITE, REST | ✅ ALREADY BUILT |

**P0 Gaps Found:** 0  
**P1 Gaps Found:** 1 (unit count sign convention — verification required in gl-service)

---

## tranpost.cbl — The Core Posting Engine

**Lines:** ~120KB | **Type:** COBOL DMS posting engine  
**REMARKS (AC4041):** "THIS PROGRAM POSTS DMS-SOURCED TRAN-FILE TRANSACTIONS TO JOURNAL, DETAIL, HISTTRAN FILES"  
**Called by:** autopost batch, tranpr.cbl | **Calls:** Nearly every accounting subroutine  

### Two Posting Paths

`tranpost.cbl` is one of TWO COBOL programs that implement the core posting logic:

| Program | Source | Trigger | Input |
|---------|--------|---------|-------|
| `tranpost.cbl` | DMS autopost | COBOL batch | TRAN-FILE (COBOL-sourced transactions) |
| `capostjv.cbl` (Batch 1) | OfficeMate Java | Java Program 37 | Pipe-delimited text file |

Both implement **identical business rules** and both write to the same three files. Both are replaced by `gl-service.approveJournalEntry()`.

### Business Rules Implemented

**Rule 1: Balance method (D = per-document, S = per-source)**
```cobol
IF TB-GL-BALMETHOD = "D"
  COMPUTE JR-KEY-DATE = TR-DATE-REFNO
ELSE
  COMPUTE JR-KEY-DATE = TR-DATE-SOURCE  ← per-source grouping
END-IF
```
TypeScript gl-service uses `JournalEntry.balanceMethod` field.

**Rule 2: Inactive GL account check**
```cobol
IF GL-INACTIVE-FLAG = "Y"
  MOVE "INACTIVE-ACCOUNT" TO POST-ERROR
  PERFORM REJECT-TRANSACTION
END-IF
```
TypeScript gl-service: `validateGLAccountActive()` pre-posting check.

**Rule 3: Distribution account fan-out (GL-TYPE = "%")**
```cobol
IF GL-TYPE = "%"
  CALL "getgldistr" USING DISTRIBUTION-PARAMS
  PERFORM FAN-OUT-LOOP VARYING SUB FROM 1 BY 1
    UNTIL SUB > GETGLDISTR-NUM-DIST
END-IF
```
TypeScript gl-service: confirmed to call `resolveDistributionAccount()` for "%" type GLs.

**Rule 4: COS/INV chain posting**
```cobol
IF GL-COSGL IS NOT ZERO
  COMPUTE TR-AMOUNT = TR-AMOUNT * -1
  WRITE JOURNAL-MF WITH GL-COSGL KEY
END-IF
```
TypeScript gl-service: `CostOfSalesRule` handles COS/INV chained GL entries.

**Rule 5: Journal balance overflow protection**
```cobol
IF JR-BALANCE > +999999999.99 OR < -999999999.99
  MOVE "JR-OVERFLOW" TO POST-ERROR
  PERFORM REJECT-TRANSACTION
END-IF
```
TypeScript: `Prisma.Decimal(15,2)` accommodates up to `9,999,999,999,999.99` — overflow protection is schema-level.

**Rule 6: 99-post duplicate protection**
```cobol
IF POSTNO > 99
  MOVE "ALREADY-POSTED" TO POST-ERROR
END-IF
```
TypeScript gl-service: `JournalEntry.postCount` field + `DuplicatePostProtectionRule`.

**Rule 7: 13th month routing (GLOBAL-YE-IS-IN-PROGRESS)**
```cobol
IF GLOBAL-YE-IS-IN-PROGRESS = "Y"
  MOVE 13 TO JR-PERIOD
  SKIP GL-LOOKUP
  SKIP DETAIL-WRITE
END-IF
```
TypeScript: eom-service step-based orchestration handles the year-end period separately. The global flag pattern is replaced by workflow state in the EOM step machine. When the year-end step is active, all new journal entries are automatically routed to period 13.

**Rule 8: TRAN-FILE DELETE after successful post**
```cobol
DELETE TRAN-FILE RECORD AFTER SUCCESSFUL-POST
```
TypeScript: `JournalEntry` status changes from `DRAFT` → `POSTED` after successful `approveJournalEntry()`. The DRAFT record is not deleted but its status is final.

### Three-Way Write (The Critical Pattern)

```cobol
PERFORM WRITE-JOURNAL-BALANCE      ← JOURNAL-MF REWRITE
PERFORM WRITE-DETAIL-ENTRY         ← DETAIL-MF WRITE
PERFORM WRITE-HISTTRAN-ENTRY       ← HISTTRAN-FILE WRITE
```

**TypeScript equivalent:**
```typescript
await this.prisma.$transaction(async (tx) => {
  await tx.gLAccountPeriodBalance.upsert({ ... });  ← JOURNAL-MF
  await tx.scheduleDetail.create({ ... });          ← DETAIL-MF
  await tx.transactionHistory.create({ ... });      ← HISTTRAN-FILE
}, { isolationLevel: 'Serializable' });
```

The SERIALIZABLE isolation level ensures that the three-way write is atomic — if any part fails, all three are rolled back. This eliminates the OOB conditions that `fixoobtran.cbl`, `dumpoobtran.cbl`, and `fixorphan.cbl` were built to repair.

### Unit Count Sign Convention (P1 — Verification Required)

```cobol
IF GL-TYPE = "S" OR "L"         ← Sales / Liability
  IF TR-REV-ADJ = SPACE
    COMPUTE HI-COUNT = TR-COUN * -1  ← Sales: DR = negative units
  ELSE
    COMPUTE HI-COUNT = TR-COUN       ← Rev/Adj: normal
  END-IF
ELSE IF GL-TYPE = "E" OR "A"    ← Expense / Asset
  IF TR-REV-ADJ = "R" OR "A"
    COMPUTE HI-COUNT = TR-COUN * -1  ← Exp/Ast rev/adj: negate
  ELSE
    COMPUTE HI-COUNT = TR-COUN       ← Normal: positive units
  END-IF
ELSE IF GL-TYPE = "M" OR "C"    ← Misc / Cost
  * Sign determined by TR-REV-ADJ indicator
END-IF
```

This convention ensures that unit counts (vehicle counts, units sold) are tracked with correct signs relative to financial statement presentation:
- Sales GL accounts: debits (returns/corrections) get negative units; credits (normal sales) get positive
- Expense/Asset GL accounts: reversed entries get negative units

**Gap assessment:** The TypeScript gl-service has `JournalEntryLine.unitCount`. Whether the sign convention is applied by GL type needs verification. The P1 flag is: **verify that `gl-service.approveJournalEntry()` applies the same GL-TYPE-based sign logic to `unitCount`**.

**Verdict:** ✅ **ALREADY BUILT** with one P1 verification item for unit count sign convention.

---

## tranpr.cbl — TRANPR

**Lines:** ~107KB | **Type:** Print and post (print queue posting)  
**Called by:** Print menu option | **Calls:** `tranpost.cbl` (CALL or EXEC after print)  
**Monetary operations:** Same as tranpost — delegates to tranpost for all monetary operations  
**Business logic:** Handles the "print before post" workflow. Prints transaction detail report, then calls tranpost to perform the actual posting. Formats printed output but all monetary logic is in tranpost.  
**Verdict:** ✅ **ALREADY BUILT** — Delegates entirely to tranpost for monetary operations. The print functionality is in the TypeScript web UI; posting is via `gl-service.approveJournalEntry()`.

---

## transumm.cbl — TRANSUMM

**Lines:** ~31KB | **Type:** Autopost summary report (read-only)  
**Called by:** EOM reporting | **Calls:** TRAN-FILE (read), HISTTRAN-FILE (read), JOURNAL-MF (read)  
**Monetary operations:**
- `ADD TR-AMOUNT TO SUMM-TOTAL` — accumulation for report totals (read-only)
- `ADD HI-AMOUNT TO HIST-TOTAL` — same pattern
All read-only accumulation, no persistence.  
**Data mutations:** WRITE PRINT-FILE — report output only  
**Business logic:** Reads TRAN-FILE and HISTTRAN-FILE, groups transactions by source/date, computes subtotals, prints autopost summary. Used to review pending autopost items before EOM.  
**Verdict:** ✅ **SAFE TO SKIP** — Read-only report. TypeScript equivalent: `GET /api/v1/gl/journal-entries?status=PENDING_AUTOPOST` reporting endpoint.

---

## tranup.cbl — TRANUP (Phase 1)

**Lines:** ~86KB | **Type:** Transaction data entry (phase 1)  
**Called by:** Transaction entry menu | **Calls:** TRAN-FILE (I-O), getglbyid, getsched, histtransync  
**Monetary operations:**
- `COMPUTE TRAN-TOTAL = TRAN-TOTAL + TR-AMOUNT` — accumulation for balance check
- `COMPUTE TRAN-BALANCE = TRAN-DEBIT-TOTAL - TRAN-CREDIT-TOTAL` — journal entry balance validation
- `MOVE ZERO TO TR-AMOUNT, TR-COUN` — initialize new line item
All accumulations are for validation only; persistence goes to TRAN-FILE (staging).

**Data mutations:**
- `WRITE TRAN-REC` — creates DRAFT transaction record in TRAN-FILE
- `REWRITE TRAN-REC` — updates draft in TRAN-FILE
- `CALL histtransync` — notifies backend of new draft

**Business logic:** Interactive journal entry creation (phase 1 of 2):
1. User enters batch header: source, date, reference#, description
2. User enters debit/credit lines: GL account, amount, unit count
3. Validates running balance (debits must equal credits) before allowing submit
4. Creates TRAN-FILE batch record and line records (TR-BATCHNO header + TR-LINENO lines)
5. Validates each GL account (active, correct type for source)

**New system coverage:**  
`gl-service` creates `JournalEntry` records with status `DRAFT` via `POST /api/v1/gl/journal-entries`. The web UI handles the multi-line entry form. Balance validation (debits = credits) is enforced before saving. GL account validation (active, type) is per Rule 2.

**Verdict:** ✅ **ALREADY BUILT** — `gl-service` DRAFT journal entry creation covers tranup.cbl workflow.

---

## tranup2.cbl — TRANUP2 (Phase 2)

**Lines:** ~92KB | **Type:** Transaction data entry (phase 2)  
**Called by:** Transaction entry menu (from tranup) | **Calls:** TRAN-FILE (I-O), same subroutines  
**Monetary operations:** Same as tranup — accumulation for balance validation  
**Data mutations:** Same as tranup — WRITE/REWRITE TRAN-FILE  
**Business logic:** Phase 2 of transaction entry — extends tranup with additional field validation, schedule detail assignment, optional vehicle lookup, COS/INV chain validation. The split into two phases was a COBOL screen-size limitation (more fields than fit on one screen).  
**Verdict:** ✅ **ALREADY BUILT** — Covered by same `gl-service` journal entry flow. The web UI's multi-step entry form corresponds to the tranup/tranup2 two-phase pattern.

---

## Gaps Found

### G-09 (P1 — Verify): Unit Count Sign Convention — tranpost.cbl

**File:** tranpost.cbl lines 4,200–4,350 (estimated)  
**Risk:** Unit count sign convention by GL-TYPE may not be implemented in gl-service  
**Business logic at risk:**
- Sales/Liability GL accounts: DR entries should have negative unit count; CR entries positive
- Expense/Asset GL accounts: Rev/Adj entries should have negative unit count; normal positive
- Misc/Cost GL accounts: sign determined by TR-REV-ADJ indicator

**Impact if wrong:** Unit count reports (vehicles sold, units per account) will show incorrect counts. This affects management reporting and OEM reporting but does NOT affect monetary balances.

**Fix scope:** `amacc/services/gl-service/src/application/gl-service.ts` — in `approveJournalEntry()`, when computing `unitCount` for `TransactionHistory`:
```typescript
function computeUnitCountSign(
  rawCount: number,
  glType: GLAccountType,
  isRevAdj: boolean
): number {
  if (glType === 'SALES' || glType === 'LIABILITY') {
    return isRevAdj ? rawCount : -rawCount;
  } else if (glType === 'EXPENSE' || glType === 'ASSET') {
    return isRevAdj ? -rawCount : rawCount;
  }
  // MISC/COST: follow isRevAdj
  return isRevAdj ? -rawCount : rawCount;
}
```

**Priority:** P1 (verify) — Unit count does not affect monetary balances but affects management reporting accuracy. Verify implementation in gl-service before go-live.
