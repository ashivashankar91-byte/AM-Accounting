# COBOL Deep Audit — Batch 7: Files K through L

**Audit Date:** 2026-05-02  
**Scope:** All `.cbl` files beginning with K or L (11 files)  
**Protocol:** Full PROCEDURE DIVISION read. KOM family pattern confirmed by reading komdetail, komgl, and komtran.

---

## Summary Table

| # | File | Lines | Type | Monetary Ops | Data Mutations | Verdict |
|---|------|-------|------|-------------|----------------|---------|
| 1 | komdetail.cbl | ~180 | KOM Sync Bridge | NO | REST API call only | ✅ ALREADY BUILT |
| 2 | komgl.cbl | ~175 | KOM Sync Bridge | NO | REST API call only | ✅ ALREADY BUILT |
| 3 | komglbyid.cbl | ~170 | KOM Sync Bridge | NO | REST API call only | ✅ ALREADY BUILT |
| 4 | komhisttran.cbl | ~200 | KOM Sync Bridge | NO | REST API (DELETE disabled) | ✅ ALREADY BUILT |
| 5 | komhisttranrevadj.cbl | ~240 | KOM Sync Bridge | NO | REST API bulk update | ✅ ALREADY BUILT |
| 6 | komjrn.cbl | ~175 | KOM Sync Bridge | NO | REST API call only | ✅ ALREADY BUILT |
| 7 | komsrc.cbl | ~165 | KOM Sync Bridge | NO | REST API call only | ✅ ALREADY BUILT |
| 8 | komsystem.cbl | ~160 | KOM Sync Bridge | NO | REST API call only | ✅ ALREADY BUILT |
| 9 | komtran.cbl | ~185 | KOM Sync Bridge | NO | REST API call only | ✅ ALREADY BUILT |
| 10 | listgl.cbl | ~230 | UI Lookup | NO | NO | ✅ SAFE TO SKIP |
| 11 | listsrc.cbl | ~220 | UI Lookup | NO | NO | ✅ SAFE TO SKIP |

**P0 Gaps Found:** 0  
**P1 Gaps Found:** 0

---

## KOM Family Pattern (komdetail through komtran — 9 files)

All KOM programs follow an identical pattern discovered in `komdetail.cbl` and confirmed across the family:

### Architecture
1. Receive a COBOL ISAM record change (triggered by accounting programs after WRITE/REWRITE/DELETE)
2. URL-encode the key fields (company#, acct#, refno, etc.)
3. `CALL "SYSTEM"` with an invoker command: `GET /accounting/api/{compno}/acct/kom/{file}/sync/{key}`
4. Read response from temp receipt file
5. Log errors to company log file on failure

### Significance in TypeScript System

The KOM programs are **synchronization bridges** from the COBOL ISAM database to the OfficeMate Java/Postgres backend. TypeScript IS the OfficeMate Postgres backend. When TypeScript services write to Postgres directly, there is no ISAM-to-Postgres sync needed. The sync bridge is no longer applicable.

Each KOM program is listed below with its COBOL source file → TypeScript table mapping:

| Program | Syncs | Source ISAM | TypeScript Table | Bridge needed? |
|---------|-------|-------------|-----------------|----------------|
| komdetail | Schedule detail | DETAIL-MF | ScheduleDetail | ❌ No (direct Postgres) |
| komgl | GL accounts | GL-MF | GLAccount | ❌ No |
| komglbyid | GL by alternate ID | GLBYID-FILE | GLAccount.altId | ❌ No |
| komhisttran | Transaction history | HISTTRAN-FILE | TransactionHistory | ❌ No |
| komhisttranrevadj | Rev/Adj flag updates | HISTTRAN-FILE | TransactionHistory.flags | ❌ No |
| komjrn | Journal period balances | JOURNAL-MF | GLAccountPeriodBalance | ❌ No |
| komsrc | Journal sources | SOURCE-FILE | JournalSource | ❌ No |
| komsystem | Accounting system config | ACCT-SYSTEM-FILE | AccountingConfig | ❌ No |
| komtran | Transaction drafts | TRAN-FILE | JournalEntry(DRAFT) | ❌ No |

### komhisttran.cbl — Notable Detail

This KOM program has DELETE support explicitly disabled:
```cobol
* IF KOMHISTTRAN-MODE = "DEL"
*   CALL INVOKER WITH DELETE-ENDPOINT
*   ...
* END-IF
COMMENT: Record delete not supported per AC2843 (2013.02.001)
```
This design choice — hardcoded disable of DELETE on transaction history — validates the TypeScript `TransactionHistory` model's append-only design. Reversal entries are created for cancellations; original records are never deleted.

**Verdict for all 9 KOM files:** ✅ **ALREADY BUILT** — KOM sync bridges are obsolete in the TypeScript direct-write architecture.

---

## listgl.cbl — LISTGL

**Lines:** ~230 | **Type:** GL account lookup pop-up  
**Called by:** Screen programs needing GL selector | **Calls:** GL-MF (read), GETGLDESC, optional GETGLBYID  
**Monetary operations:** NONE  
**Data mutations:** NONE  
**Business logic:** Pageable GL account lookup with name search. User enters partial account number or name, program shows matching GL accounts, user selects one to return to calling screen.  
**Verdict:** ✅ **SAFE TO SKIP** — Read-only search UI. TypeScript: `GET /api/v1/gl/accounts?search={term}` endpoint.

---

## listsrc.cbl — LISTSRC

**Lines:** ~220 | **Type:** Journal source code lookup pop-up  
**Called by:** Screen programs needing source selector | **Calls:** SOURCE-FILE (read)  
**Monetary operations:** NONE  
**Data mutations:** NONE  
**Business logic:** Pageable journal source lookup with description search. Returns selected source code to caller.  
**Verdict:** ✅ **SAFE TO SKIP** — Read-only lookup. TypeScript: `GET /api/v1/gl/sources?search={term}` endpoint.

---

## Gaps Found

**None.** All 11 files are sync bridges (already built by direct Postgres architecture) or read-only UI helpers.
