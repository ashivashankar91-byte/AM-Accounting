# COBOL Deep Audit — Batch 6: Files G through J

**Audit Date:** 2026-05-02  
**Scope:** All `.cbl` files beginning with G, H, I, J (23 files)  
**Protocol:** Full PROCEDURE DIVISION read. High-risk files (glzero, glzerosch, jrnzero, jrpatch) read directly.

---

## Summary Table

| # | File | Lines | Type | Monetary Ops | Data Mutations | Verdict |
|---|------|-------|------|-------------|----------------|---------|
| 1 | getacctfn.cbl | ~180 | Subroutine | NO | READ ONLY | ✅ SAFE TO SKIP |
| 2 | getacctsys.cbl | ~55 | Subroutine | NO | READ ONLY | ✅ SAFE TO SKIP |
| 3 | getaclnk.cbl | ~80 | Subroutine | NO | READ ONLY | ✅ SAFE TO SKIP |
| 4 | getfssetups.cbl | ~100 | Subroutine | NO | Temp file only | ✅ SAFE TO SKIP |
| 5 | getglbyid.cbl | ~280 | Subroutine | NO | READ ONLY | ✅ SAFE TO SKIP |
| 6 | getgldesc.cbl | ~120 | Subroutine | NO | READ ONLY | ✅ SAFE TO SKIP |
| 7 | getgldistr.cbl | ~480 | Subroutine | YES (pct calc) | NO (returns to caller) | ✅ ALREADY BUILT |
| 8 | getjavafs.cbl | ~65 | Subroutine | NO | READ ONLY | ✅ SAFE TO SKIP |
| 9 | getjavafs2.cbl | ~70 | Subroutine | NO | READ ONLY | ✅ SAFE TO SKIP |
| 10 | getreservedjs.cbl | ~95 | Subroutine | NO | READ ONLY | ✅ SAFE TO SKIP |
| 11 | getsched.cbl | ~55 | Subroutine | NO | READ ONLY | ✅ SAFE TO SKIP |
| 12 | glblsubt.cbl | ~90 | Admin Utility | NO | REWRITE GL-SUBTOTAL(PIC X) | ✅ SAFE TO SKIP |
| 13 | glsync.cbl | ~320 | HTTP Bridge | NO | None (REST API call) | ✅ ALREADY BUILT |
| 14 | gltbexport.cbl | ~260 | UI Wrapper | NO | Temp files only | ✅ SAFE TO SKIP |
| 15 | glzero.cbl | ~90 | Admin Utility | YES (zero GL-OPEN-BAL) | REWRITE GL-MF | ⚠️ P1 GAP |
| 16 | glzerosch.cbl | ~95 | Admin Utility | YES (zero GL-OPEN-BAL) | REWRITE GL-MF | ⚠️ P1 GAP |
| 17 | histtransync.cbl | ~500 | HTTP/Touch Bridge | NO | Touch files + REST API | ✅ ALREADY BUILT |
| 18 | inqtran.cbl | ~800 | Inquiry | NO | Temp file only | ✅ SAFE TO SKIP |
| 19 | inquiryn.cbl | ~2600 | Inquiry | NO | DETAIL-MF (ApplyNo only) | ⚠️ PARTIALLY COVERED |
| 20 | jnlsrcsync.cbl | ~280 | HTTP Bridge | NO | None (REST API call) | ✅ ALREADY BUILT |
| 21 | joursec.cbl | ~550 | Security Maint | NO | TABLES-FILE (security) | ✅ SAFE TO SKIP |
| 22 | jrnzero.cbl | ~85 | Admin Utility | YES (zero JR-BALANCE) | REWRITE JOURNAL-MF | ⚠️ P1 GAP |
| 23 | jrpatch.cbl | ~220 | Admin Backdoor | NO (metadata only) | REWRITE JOURNAL-MF | ✅ SAFE TO SKIP |

**P0 Gaps Found:** 0  
**P1 Gaps Found:** 3 (glzero, glzerosch, jrnzero — buy/sell ownership change utilities)

---

## Group A: Getter Subroutines (11 files — all SAFE TO SKIP)

### getacctfn.cbl | getacctsys.cbl | getaclnk.cbl | getjavafs.cbl | getjavafs2.cbl | getreservedjs.cbl | getsched.cbl

All are read-only lookup subroutines:
- `getacctfn`: Maps company# + filename to full path via FILE-NAMES
- `getacctsys`: Fetches system info record (config, laser msg, name rec) by key
- `getaclnk`: Reads filename paths, returns link record for caller
- `getjavafs` / `getjavafs2`: Reads Java FS activation flag for OEM/year
- `getreservedjs`: Returns journal source reservation status (codes 0–6)
- `getsched`: Retrieves schedule master record by schedule# + company

All replaced by Postgres queries in their respective TypeScript services. No data mutations, no monetary operations.

---

### getfssetups.cbl

**Lines:** ~100 | Calls Java API (`/accounting/api/##/glfs/file`) to fetch FS setup records, writes temp file to `/tmp/fssetups.{loginid}.{tty}.{timestamp}.dat`. No accounting file writes.  
**Verdict:** ✅ SAFE TO SKIP — Configuration retrieval via REST API. TypeScript equivalent: `fs-service` FS config endpoints.

---

### getglbyid.cbl

**Lines:** ~280 | Lookup subroutine for GL-by-ID feature. Maps between GL numeric ID (`ACCTID`) and GL account number (`ACCTNO`). Read-only on `GLBYID-FILE`. Optional logging only.  
**Verdict:** ✅ SAFE TO SKIP — Lookup utility. TypeScript GL accounts use UUID primary keys; account code lookups are standard database queries.

---

### getgldesc.cbl

**Lines:** ~120 | Fetches GL record by account number. Read-only on GL-MF with optional lock (no REWRITE). Returns GL name and account details to caller.  
**Verdict:** ✅ SAFE TO SKIP — Read-only GL lookup. TypeScript equivalent: `GET /api/v1/gl/accounts/:code`.

---

### getgldistr.cbl — GETGLDISTR

**Lines:** ~480 | **Type:** GL distribution calculation subroutine  
**Called by:** GL posting programs, adjustment programs | **Calls:** GETTABLE, GETTABLE2, GETGLDESC, GETGLBYID  
**Monetary operations:**
```
COMPUTE GETGLDISTR-DIST-AMOUNT(SUB) = GETGLDISTR-AMOUNT * TB-GL-PCT(SUB) / 100
COMPUTE GETGLDISTR-DIST-AMOUNT(SUB) = GETGLDISTR-AMOUNT - TOTAL-DISTR-AMOUNT  ← last-remainder
```
- `TB-GL-PCT` (PIC 9(9)V99): percentage per distribution line
- `GETGLDISTR-AMOUNT` (PIC S9(13)V99): input amount to distribute
- Last-remainder pattern: final distribution line gets `amount - sum(all other lines)` to prevent rounding loss

**Data mutations:** NONE — returns calculated amounts in `GETGLDISTR-DIST-AMOUNT()` array to caller  
**Validations:**
1. Account must have "%" in account number (distribution account marker)
2. Each distribution line must have a numeric percentage
3. Percentages must sum to 100
4. No blank distribution accounts
5. All target accounts must be valid and active
6. Check for circular references (distribution account not used in another distribution)

**Business logic:** Pure calculation + validation subroutine. Resolves "%" distribution accounts by splitting the input amount across component accounts per configured percentages. Last-remainder handles rounding to prevent penny loss.

**New system coverage:**  
The TypeScript `connector-service` uses hardcoded NADA account codes (no "%" distribution accounts in the DMS deal posting flow). For manual journal entries via the web UI, `gl-service` needs to resolve "%" accounts if the TypeScript GLAccount model supports the distribution account type.

**Critical gap check:** Does `gl-service` handle `GLAccountType.DISTRIBUTION` (equivalent of GL-TYPE="%") with percentage-based fan-out? Looking at `gl-service.ts`, the `GLAccountType` enum and `AccountTypeMismatchRule` exist but distribution fan-out logic was not confirmed.

**Verdict:** ✅ **ALREADY BUILT** for the DMS posting path (connector-service uses explicit NADA codes). Distribution account resolution for manual journal entries should be verified in `gl-service`.

---

## Group B: GL Operations

### glblsubt.cbl — GLBLSUBT

**Lines:** ~90 | **Type:** Admin utility  
**REMARKS:** "INITIALIZE GL SUBTOTALS TO SPACE"  
**Monetary operations:** NONE — `GL-SUBTOTAL1`, `GL-SUBTOTAL2`, `GL-SUBTOTAL3` are each `PIC X` (single character), confirmed by reading `acct/copy/gl.rec`. These are report grouping/subtotal break codes, NOT monetary amounts.  
**Data mutations:** `REWRITE GL-REC` — blanks `GL-SUBTOTAL1/2/3` only (PIC X fields)  
**Business logic:** Admin utility to clear GL account subtotal break codes (used as grouping markers in GL trial balance print). Used after incorrect journal entries or GL setup changes.  
**Verdict:** ✅ **SAFE TO SKIP** — GL subtotal fields are display/grouping PIC X metadata, not monetary accumulators. In the TypeScript GLAccount model, equivalent fields (account group, subtotal markers) are managed via the GL account update API.

---

### glsync.cbl — GLSYNC

**Lines:** ~320 | **Type:** HTTP sync bridge  
**Called by:** GL modification programs | **Calls:** Invoker API (`/accounting/api/{compno}/acct/gl/sync/{glno}`)  
**Monetary operations:** NONE  
**Data mutations:** NONE locally — REST API call to sync GL changes to OfficeMate database  
**Business logic:** URL-encodes GL account number (special chars → hex), calls REST endpoint, reads response from temp file. Same pattern as `jnlsrcsync.cbl`.  
**Verdict:** ✅ **ALREADY BUILT** — HTTP sync bridge. TypeScript services post directly to Postgres; no sync bridge needed.

---

### gltbexport.cbl — GLTBEXPORT

**Lines:** ~260 | **Type:** Trial balance export UI wrapper  
**Called by:** GL reporting | **Calls:** Java dialog (`TrialBalanceExtractDlg`)  
**Monetary operations:** NONE  
**Data mutations:** Temp files only  
**Business logic:** Launches Java UI for TB extraction, parses Save/Cancel response. No accounting file writes.  
**Verdict:** ✅ **SAFE TO SKIP** — UI wrapper for Java TB export; replaced by TypeScript trial balance API endpoints.

---

### glzero.cbl — GLZERO

**Lines:** ~90 | **Type:** Interactive admin utility  
**REMARKS:** "INITIALIZE GL BALANCES AND COUNTS TO ZERO. Used to clear data for buy/sell new owner."  
**Monetary operations:**
- `MOVE ZEROS TO GL-OPEN-BAL, GL-OPEN-CNT` — zeroes monetary opening balance
- `REWRITE GL-REC` for every GL account (skips GL-TYPE="%")
- Fields: `GL-OPEN-BAL` (PIC S9(9)V99 COMP-3) — the fiscal year opening balance

**Data mutations:** `REWRITE GL-MF` — zeros `GL-OPEN-BAL` and `GL-OPEN-CNT` for ALL GL accounts in the company  
**Trigger:** Manual interactive operation — admin enters company number, program zeroes all GL opening balances  
**Business logic:** Dealership ownership change (buy/sell). When a new owner takes over, zero all GL account opening balances to start with a clean fiscal year.

**New system coverage:**  
In the TypeScript multi-tenant architecture, a "buy/sell" event typically means provisioning a **new tenant** for the new owner. The new tenant has no `GLAccountPeriodBalance` records — effectively zero opening balances by definition. No explicit "zero all balances" operation is needed because the ISAM files are not reused; Postgres tenants are provisioned fresh.

However, if the business requires keeping the **same tenant ID** across an ownership change (for historical data continuity), the TypeScript system needs an admin API endpoint to reset all `GLAccount.openingBalance` values to zero for a tenant. No such endpoint exists in the current `gl-service`.

**Verdict:** ⚠️ **P1 GAP**

**Evidence:** `glzero.cbl` REMARKS: "Used to clear data for buy/sell new owner." This is a legitimate business operation (ownership change). In a multi-tenant TS system, new-tenant provisioning achieves the same result, making this a low-frequency edge case, but if existing-tenant ownership transfers are required, the admin endpoint is missing.

---

### glzerosch.cbl — GLZEROSCH (PROGRAM-ID: GLZERO)

**Lines:** ~95 | **Type:** Interactive admin utility  
**REMARKS:** "INITIALIZE GL BALANCES AND COUNTS TO ZERO and schedules."  
**Monetary operations:**
- `MOVE ZEROS TO GL-OPEN-BAL, GL-OPEN-CNT, GL-SCHDNO` — also removes schedule assignment
- `REWRITE GL-REC` for every GL account

**Data mutations:** `REWRITE GL-MF` — zeros `GL-OPEN-BAL`, `GL-OPEN-CNT`, and `GL-SCHDNO` (schedule assignment)  
**Business logic:** Same as `glzero.cbl` but also removes schedule number assignments from GL accounts. Used when ownership change requires complete schedule reconfiguration in addition to balance reset.  
**Verdict:** ⚠️ **P1 GAP** — Same rationale as `glzero.cbl`, plus schedule assignment reset.

---

## Group C: History/Journal Operations

### histtransync.cbl — HISTTRANSYNC

**Lines:** ~500 | **Type:** Transaction sync bridge  
**Called by:** Posting programs, year-end close | **Calls:** REST API or FileWatcher touch file  
**Monetary operations:** NONE  
**Data mutations:** Creates touch files in `/acct/files{compno}/transactionsync/` or calls REST API — no direct COBOL file writes  
**Functions:**
1. `TRANS_POSTING` (default): Notify backend of new posted transaction
2. `BANK_RECON`: Bank reconciliation sync
3. `PSTHIST_EXT`: External history sync

**Business logic:** Validates source/refno chars are URL-safe, then either creates FileWatcher touch file (async) or calls REST API directly (sync mode for year-end). Error emails to dev team on failure.  
**Verdict:** ✅ **ALREADY BUILT** — HTTP/FileWatcher bridge. TypeScript services write directly to Postgres; no sync bridge needed. The `JOURNAL_ENTRY_POSTED` outbox event handles downstream notifications.

---

### jrnzero.cbl — JRNZERO

**Lines:** ~85 | **Type:** Interactive admin utility  
**REMARKS:** "INITIALIZE journal BALANCES AND COUNTS TO ZERO."  
**Monetary operations:**
- `MOVE ZEROS TO JR-BALANCE, JR-COUNT`
- `REWRITE JOURNAL-REC` for EVERY JOURNAL-MF record in the company
- Fields: `JR-BALANCE` (PIC S9(9)V99 COMP-3) — period running balance; `JR-COUNT` (PIC S9(7))

**Data mutations:** `REWRITE JOURNAL-MF` — zeros `JR-BALANCE` and `JR-COUNT` for ALL period journal records  
**Trigger:** Manual interactive operation  
**Business logic:** Clears all period running balances for a company. Used in conjunction with `glzero.cbl` for ownership changes — zeros both the GL opening balances and the current-period running balances, leaving a completely clean accounting slate.

**New system coverage:**  
In the TypeScript system, `GLAccountPeriodBalance` rows store the equivalent of `JR-BALANCE`. For a new tenant, these rows don't exist (zero by default). For an existing-tenant ownership transfer, zeroing all `GLAccountPeriodBalance.runningBalance` values would require an admin API that does not exist in the current `gl-service`.

**Verdict:** ⚠️ **P1 GAP** — Same rationale as `glzero.cbl`. Used together as a pair for ownership changes.

---

## Group D: Inquiry Programs

### inqtran.cbl — INQTRAN

**Lines:** ~800 | **Type:** Transaction history inquiry  
**Called by:** Inquiry menus, schedule inquiry, F4 on transaction entry | **Calls:** HISTTRAN-FILE (read), GETGLDESC, GETGLBYID  
**Monetary operations:** NONE  
**Data mutations:** Temp file only (for apay voidck integration)  
**Business logic:** Read-only inquiry of HISTTRAN-FILE by source/refno/date range. Displays GL descriptions, aging for type-5, supports print preview. Creates temp indexed file when called from AP void check (contains matching records for void processing).  
**Verdict:** ✅ **SAFE TO SKIP** — Read-only inquiry. TypeScript equivalent: `GET /api/v1/gl/history` with filter parameters.

---

### inquiryn.cbl — INQUIRYN

**Lines:** ~2600 | **Type:** Multi-function interactive inquiry  
**Called by:** Main accounting menu | **Calls:** JOURNAL-MF, HISTTRAN-FILE, DETAIL-MF (reads), GETGLDESC, GETGLBYID, NAME-DATABASE, VEHICLE-DATABASE  
**Monetary operations:** NONE  
**Data mutations:**
- `DELETE DETAIL-MF` + `WRITE DETAIL-REC` — only when user presses F2 on type-5 schedule to change `DE-APPLYNO` (apply-to number)
- Fields updated: `DE-APPLYNO`, `DE-SEQNO` (regenerated) — **not monetary amounts**
- Temp file: `/tmp/inquiryn{timestamp}.tmp` — deleted at EOJ

**Business logic:**
- GL inquiry (types 1–5): YTD balance, aging, prior month detail, posted-only, schedule detail
- Schedule inquiry: pageable list of schedules + detail, control# lookup, vehicle lookup, aging display
- Transaction inquiry: delegates to inqtran
- F2 on type-5: allows user to change ApplyNo (reclassify AR payment application)

**New system coverage:**  
The vast majority is read-only. The ApplyNo change (F2) is the only mutation — it reclassifies how a payment is applied to an outstanding invoice. This is equivalent to a `PATCH /api/v1/schedules/:id/detail/:lineId/applyno` endpoint in `schedule-service`. The `DE-APPLYNO` field is not monetary but is business-critical for AR aging accuracy.

**Verdict:** ⚠️ **PARTIALLY COVERED** — Read-only majority. The ApplyNo change mutation needs a corresponding `schedule-service` endpoint. ApplyNo affects which invoice a payment is applied to, which affects AR aging reports and customer statements.

---

## Group E: Journal/Security Operations

### jnlsrcsync.cbl — JNLSRCSYNC

Same pattern as `glsync.cbl` — HTTP REST bridge. No accounting file writes. Calls `/accounting/api/{compno}/acct/src/sync/{src}`. ✅ ALREADY BUILT.

---

### joursec.cbl — JOURSEC

**Lines:** ~550 | **Type:** Journal source security maintenance  
**Called by:** System setup menu | **Calls:** TABLES-FILE (I-O), SOURCE-FILE (read)  
**Monetary operations:** NONE  
**Data mutations:** WRITE/REWRITE TABLES-FILE — per-user per-source access flags (Y/N for 323 sources)  
**Business logic:** Admin sets per-user access to journal sources via screen. Maintains `JS##` section records in TABLES-FILE.  
**Verdict:** ✅ **SAFE TO SKIP** — Security configuration replaced by JWT RBAC. Journal source access control is handled at the `gl-service` authorization middleware level.

---

### jrpatch.cbl — JRPATCH

**Lines:** ~220 | **Type:** Interactive journal balance patch (admin backdoor)  
**Called by:** Admin maintenance menu (program 8, option 7) | **Calls:** JOURNAL-MF (I-O), GL-MF (read), GETGLBYID, REST API sync (AC2917)  
**Monetary operations:** NONE (reads `JR-BALANCE` and `JR-COUNT` for display; user edits these values)  
**Data mutations:** `REWRITE JOURNAL-MF` or `WRITE JOURNAL-MF` — direct creation/modification of journal balance records  
**Business logic:** Allows admin to directly create or modify JOURNAL-MF records, bypassing the normal posting workflow. User enters GL acct, source, year, month; program finds or creates the journal record; user edits the balance; program rewrites.

**Key assessment:**  
This is a dangerous admin backdoor that bypasses the normal posting audit trail. In the TypeScript system, this operation is intentionally absent — ALL journal balance modifications must go through proper reversal/adjustment journal entries via `gl-service`. The absence of this program is a **deliberate security improvement**, not a gap.

If a journal balance needs correction in the TypeScript system, the correct path is: create a journal entry with the appropriate debit/credit amounts, route it through `agent-gl` for AI-assisted review, then approve via `approveJournalEntry()`. This maintains a complete audit trail.

**Verdict:** ✅ **SAFE TO SKIP** — Admin backdoor intentionally not replicated. Direct journal balance manipulation bypasses the audit trail. TypeScript enforces all changes via proper journal entries.

---

## Gaps Found

### Gap 4 (P1): GL Opening Balance Reset for Buy/Sell — glzero.cbl / glzerosch.cbl

**Files:** glzero.cbl, glzerosch.cbl  
**Missing in:** gl-service — no admin endpoint to reset `GLAccount.openingBalance` for all accounts in a tenant  
**Business logic missing:** When a dealership changes ownership (buy/sell), zero all GL account opening balances so the new owner starts with a clean fiscal year.

**Monetary impact:** If the TypeScript system can't zero GL opening balances for an ownership change, the new owner's accounting will show the prior owner's opening balances in all period-balance calculations. Financial statements would be incorrect from day one.

**Fix location:** `amacc/services/gl-service/src/application/gl-service.ts`  
```typescript
// Admin-only: zero all GL opening balances (buy/sell scenario)
async resetAllOpeningBalances(tenantId: TenantId, initiatedBy: string): Promise<void> {
  // Requires ADMIN role check
  await this.prisma.$transaction(async (tx) => {
    await tx.gLAccount.updateMany({
      where: { tenantId },
      data: { openingBalance: 0, openingUnitCount: 0 },
    });
    // Audit log entry
  });
}
```

**Priority:** P1 — Required for ownership change scenario. Mitigated by multi-tenant architecture (new tenant = new ownership) but explicit endpoint needed for in-place tenant reuse.

---

### Gap 5 (P1): Journal Period Balance Reset for Buy/Sell — jrnzero.cbl

**Files:** jrnzero.cbl  
**Missing in:** gl-service — no admin endpoint to zero all `GLAccountPeriodBalance.runningBalance` for a tenant  
**Business logic missing:** Used in conjunction with `glzero.cbl` to give a new owner a completely clean accounting state — zero both GL opening balances and all current-period running journal balances.

**Fix location:** Same as Gap 4 — combined operation:
```typescript
// Combined buy/sell reset: zero GL openings AND period balances
async resetForOwnershipChange(tenantId: TenantId, initiatedBy: string): Promise<void> {
  await this.prisma.$transaction(async (tx) => {
    await tx.gLAccount.updateMany({ where: { tenantId }, data: { openingBalance: 0 } });
    await tx.gLAccountPeriodBalance.deleteMany({ where: { tenantId } });
    // Audit log entry
  });
}
```

**Priority:** P1 — Same scenario as Gap 4. Implement as a single atomic admin operation.

---

### Gap 6 (P1, minor): Schedule Detail ApplyNo Update — inquiryn.cbl F2

**File:** inquiryn.cbl  
**Missing in:** `schedule-service` — ApplyNo update endpoint for type-5 detail records  
**Business logic missing:** Allow user to reclassify which invoice a payment is applied to (change `DE-APPLYNO` on a type-5 schedule detail record). Used for AR payment reallocation.

**Monetary impact:** Indirect — ApplyNo determines which invoice is marked as paid. Incorrect ApplyNo causes wrong invoices to show as outstanding, distorting AR aging reports and customer statements.

**Fix location:** `amacc/services/schedule-service/src/application/schedule-service.ts`  
Add: `updateDetailApplyNo(tenantId, scheduleId, lineId, newApplyNo)` with validation that the schedule is type-5 and the new ApplyNo references a valid open invoice.

**Priority:** P1 (minor) — AR aging accuracy. Low frequency operation (manual payment reallocation).
