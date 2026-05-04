# COBOL Extraction: yrend.cbl

**Extracted:** 2025  
**Extracted By:** GitHub Copilot (Wave 2 — COPILOT.md protocol)  
**Status:** Complete

---

## 1. Source

| Field | Value |
|-------|-------|
| File | `acct/src/yrend.cbl` |
| PROGRAM-ID | `YREND` |
| Lines | 1,345 |
| Copybooks | gl.fc/fd, tran.fc/fd, src.fc/fd, sys.fc/fd, histtran.fc/fd |
| CALLs | `caaccteoy` (Java UI bridge), `../../acct/prog/autopost` (posts YE batch through tranpost), SYNC-GL (HTTP invoker to `/acct/sync?table=gl`, `/acct/validate`) |
| External APIs | `GET /accounting/api/{co}/acct/year_end` — returns YE journal source + retained earnings GL accounts |
| Email on error | `dl-ds-am-acct-dev@solera.com` (when LINENO reaches 9999) |

---

## 2. Purpose

YREND.cbl performs the **fiscal year-end close** for the accounting general ledger. It:

1. Validates that all preconditions are met (last month closed, not already processed, no locked GL records, valid source code, valid retained earnings accounts)
2. Zips a backup of the GL file
3. Opens a transaction batch
4. Iterates over all P&L accounts (GL-TYPE = S/C/E/M) with non-zero opening balances
5. For each: sets `GL-OPEN-BAL = 0`, accumulates balance into `TOTAL`
6. Writes a transaction line per P&L account (amount = negation of balance)
7. Writes a retained earnings journal entry (amount = TOTAL, which balances all P&L lines)
8. Updates the batch status to "OK TO POST"
9. Calls `autopost` (which calls `tranpost` with `FROM-PROG = "Y"` → `GLOBAL-YE-IS-IN-PROGRESS = TRUE`)
10. Generates EOY reports via Java API
11. Syncs the GL to the database

---

## 3. Business Invariants

### YE-INV-01: Last month of the fiscal year must be closed first
- Calendar year (1ST-MONTH = 01): `ACSYS-LSTCLOS-MM` must = 12
- Fiscal year (1ST-MONTH = N): `ACSYS-LSTCLOS-MM` must = N - 1 (or 12 if N = 1)
- Error: "Last Month of Year has NOT been closed"
- TypeScript: `tenant.lastCloseMonth` must equal `tenant.lastFiscalMonth` before year-end is allowed.

### YE-INV-02: Idempotency check via HISTTRAN record
- Key lookup: `HISTTRAN` for `source = KEY-SOURCE`, `date = ACSYS-LSTCLOS-DATE`, `reference = "EOY{YEAR}"`, `DUPEREFNO = 0`, `LINENO = 1`, `TYPE = ' '`
- If found: "Year end for {YEAR} has already been processed" — hard reject
- If not found: proceed
- **ACC-4098 addition:** When no P&L balances exist (nothing to zero), write a token histtran record so idempotency check works next time too
- TypeScript: `YearEndRecord` model with `@@unique([tenantId, fiscalYear])` — check before and write during TX.

### YE-INV-03: No locked GL records
- Scan entire GL file; if any record has `GL-STATUS = "99"`: "Year end cannot proceed, GL accounts are being updated"
- User must ensure no accounting users are in the system before running year-end
- TypeScript: `glAccount.lockedAt IS NOT NULL` → block with `GLRecordsLockedError`.

### YE-INV-04: Year-end journal source must be reserved
- Read source file for `KEY-SOURCE`; check flag `RESERVED-FOR-YEAR-END`
- If source not found or not reserved-for-year-end: reject
- TypeScript: `journalSource.isReservedForYearEnd = true` in the sources table.

### YE-INV-05: Retained earnings accounts must be active Liability accounts
- Each retained earnings GL account (from Java API) must:
  - Exist in the GL master
  - Be active (`GL-INACTIVE ≠ "Y"`)
  - Be of type "L" (Liability)
- TypeScript: Validate `glAccount.glType = 'LIABILITY' AND isActive = true` for each RE account.

### YE-INV-06: Post-YE: all P&L accounts must have GL-OPEN-BAL = 0
- The year-end process SETS these balances to zero as part of the close
- This is both the action and the invariant to verify afterward
- TypeScript: After year-end TX, assert sum of P&L `openingBalance` = 0.

### YE-INV-07: Transaction line limit of 9,999
- If line counter reaches 9999, email `dl-ds-am-acct-dev@solera.com` and abort
- No automatic recovery for this case
- TypeScript: Pre-flight count: `COUNT(*) FROM glAccount WHERE glType IN ('S','C','E','M') AND openingBalance != 0` — if > 9998, reject before starting TX.

### YE-INV-08: The journal entry must balance (total = 0)
- For each P&L line: `TR-AMOUNT = GL-OPEN-BAL * -1` (flip the sign)
- Retained earnings line: `TR-AMOUNT = SUM of original GL-OPEN-BAL values`
- Sum of all lines = 0 (standard double-entry balance)
- TypeScript: Enforce in domain logic: `assert(sum(plAmounts) + reAmount === 0)`.

### YE-INV-09: autopost must complete for YE to be effective
- yrend.cbl writes transaction records and calls `autopost` which calls `tranpost` with `FROM-PROG = "Y"` (`GLOBAL-YE-IS-IN-PROGRESS = TRUE`)
- This enables the following tranpost bypasses (documented in tranpost.extraction.md, INV-04):
  - Skip UPDATE-JOURNAL (YE doesn't add to journal history)
  - Skip UPDATE-DETAIL (YE doesn't create schedule detail)
  - Allow inactive GL accounts (accounts may have been deactivated)
  - Allow reserved sources (09, 88) — see tranpost INV-13
  - Skip cutoff date enforcement — see tranpost INV-12
- TypeScript: `yearEndClose()` passes `{ isYearEnd: true }` context to `gl-service.postBatch()`.

---

## 4. The Retained Earnings Algorithm

```
TOTAL = 0

For each GL account WHERE glType IN ('S', 'C', 'E', 'M') AND openingBalance != 0:
  tr_amount = openingBalance * -1      // negate: credit what was a debit
  TOTAL += openingBalance              // accumulate original balances
  openingBalance = 0                   // zero out the P&L account
  write tran line (amount = tr_amount)

// Write retained earnings entry (offsets all P&L lines)
retainedEarnings.openingBalance += TOTAL
write tran line for RE account (amount = TOTAL)

// Assertion: sum of all tran lines = 0
// Because: sum(-openingBalance for each PL) + TOTAL = -TOTAL + TOTAL = 0
```

---

## 5. Failure Modes

| Condition | COBOL Effect | TypeScript Handling |
|---|---|---|
| Last month not closed | Error dialog, GOBACK | `LastMonthNotClosedError` (400) |
| Already processed this year | Error dialog, GOBACK | `YearAlreadyClosedError` (409) |
| Locked GL records | Error dialog, GOBACK | `GLRecordsLockedError` (409) |
| Invalid year-end source | Error dialog, GOBACK | `InvalidYearEndSourceError` (400) |
| Retained earnings account not found/inactive/wrong type | Error dialog, GOBACK | `InvalidRetainedEarningsAccountError` (400) |
| GL zip backup fails | Fatal, GOBACK | `BackupError` (500) |
| LINENO = 9999 | Email dev team, abort | `YELineCountExceededError` (500); pre-flight count avoids this |
| autopost fails | Tran file left with "ENTERING DATA" status — must be cleared manually | `YearEndPostingFailedError` — leaves `journalBatch` in DRAFT state for manual review |
| GL sync fails | Non-fatal, error dialog only | Warning event published; sync retried via outbox |

---

## 6. PROGRAM-ID Collision: caaccteoy.cbl

yrend.cbl calls `caaccteoy` (the Java UI bridge for year-end), which is implemented in file `caaccteoy.cbl`.  
**However**, `caaccteoy.cbl` declares `PROGRAM-ID. CAACCTEOM` — the same identifier as `caaccteom.cbl`.

- In practice: both programs are called independently in separate COBOL sessions, never together — so the collision never triggered a runtime error
- In theory: loading both into the same COBOL runtime session would cause one to shadow the other
- TypeScript: irrelevant — two separate service methods with no naming collision. Documented as a COBOL legacy defect.

See: `caaccteoy.extraction.md` for full documentation of this bug.

---

## 7. Decision: BUILD

Year-end close is the **single most important missing capability** in the TypeScript rewrite. There is no equivalent in the existing `eom-service`. This must be built from scratch.

Key new artifacts:
- `YearEndClose` method on `EOMService`
- `YearEndRecord` Prisma model (idempotency token, replaces histtran key check)
- `EOMCloseType.YEAR_END` variant on `EOMClose`
- `POST /api/v1/eom/year-end` route
- P&L zeroing + retained earnings journal entry via `gl-service.postBatch({ isYearEnd: true })`

---

## 8. Improvements Over COBOL

| COBOL Limitation | TypeScript Solution |
|---|---|
| Manual zip backup to disk; lost on crash | `glAccount` snapshots to `YearEndSnapshot` table before TX starts |
| Idempotency via histtran key lookup (in-band) | Dedicated `YearEndRecord` table with DB-level uniqueness |
| LINENO overflow possible (9999 limit) | Pre-flight count enforced before TX starts |
| autopost was a separate process — YE could succeed but posting could fail | All in one atomic transaction: zero balances + insert journal entries |
| No preview of what will be zeroed | `previewYearEnd()` returns P&L account balances before execution |
| GL sync was a fire-and-forget HTTP call at EOJ | Outbox event `YEAR_END_COMPLETED` with GL sync trigger |

---

## 9. Traceability

- `@cobol-ancestry` yrend.cbl / YREND
- `@cobol-programs-replaced` yrend.cbl
- `@intelligence-additions` pre-flight line count, P&L balance preview, atomic TX (vs. two-phase COBOL write+autopost)
- `@platform-additions` YearEndRecord idempotency table, outbox event
- `@removes-need-for` caaccteoy.cbl (Java UI bridge), manual autopost call
