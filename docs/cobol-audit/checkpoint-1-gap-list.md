# Checkpoint 1 — Consolidated Gap List: Batches 1–6

**Date:** 2026-05-02  
**Coverage:** All COBOL files A–J (127 files) across Batches 1–6  
**Purpose:** First gap checkpoint per audit protocol.

---

## Overall Status: No P0 Gaps

**P0 gaps (missing monetary logic that could silently produce incorrect financial statements): ZERO**

All core posting paths, year-end close, EOM, consolidation, and GL balance maintenance are confirmed built in the TypeScript system.

---

## P1 Gap Registry (Batches 1–6)

| Gap# | Priority | Status | COBOL Source | Description | Fix Location |
|------|----------|--------|-------------|-------------|-------------|
| G-01 | P1 | ✅ FIXED | consolgl.cbl | Consolidated import: circular reference (source company = consolidated company) and duplicate company IDs were not validated | `consolidation-service.ts` — duplicate check + circular ref check added |
| G-02 | P1 | 🔲 OPEN | crfinchg.cbl | Finance charge calculation engine: `RATE * AGED-BALANCE / 12` — no TS equivalent of FINCHG-CALC-AMOUNT computation with AR bucket aging (current/30/60/90) | `apar-service` — `FinanceChargeCalculationJob` to add |
| G-03 | P1 | 🔲 OPEN | depatchn.cbl | Schedule detail admin edit: no confirmed endpoint for individual detail record WRITE/REWRITE/DELETE with COBOL validation parity | `schedule-service.ts` — verify/add `createDetail()` + `updateDetail()` validations |
| G-04 | P1 | 🔲 OPEN | glzero.cbl | GL opening balance reset for buy/sell: MOVE ZEROS TO GL-OPEN-BAL for all GL accounts — no admin endpoint in gl-service | `gl-service.ts` — `resetForOwnershipChange()` |
| G-05 | P1 | 🔲 OPEN | glzerosch.cbl | Same as G-04 plus GL-SCHDNO reset — zero schedule number assignments on all GL accounts | `gl-service.ts` — same function, add `scheduleAssignment = null` |
| G-06 | P1 | 🔲 OPEN | jrnzero.cbl | Journal period balance reset for buy/sell: MOVE ZEROS TO JR-BALANCE, JR-COUNT for all JOURNAL-MF records — no admin endpoint in gl-service | `gl-service.ts` — `resetForOwnershipChange()` (same atomic transaction as G-04) |

---

## Detail Descriptions

### G-01: Consolidation Circular Reference (FIXED)

**COBOL logic (consolgl.cbl):**
```cobol
READ CONSOL-GL-FILE INTO GL-REC
IF GL-MF-ACCTNO IN GL-REC = CONSOLIDATING-COMPANY
  MOVE "CIRCULAR" TO CONSOL-ERROR-CODE
END-IF
```

**TypeScript fix applied** to `amacc/services/group-service/src/application/consolidation-service.ts`:
```typescript
const unique = new Set(params.companies);
if (unique.size < params.companies.length) {
  throw new InvalidCompanyListError('Duplicate source company IDs are not allowed');
}
const consolidatedId = config?.consolidatedTenantId ?? params.consolidatedTenantId;
if (consolidatedId && params.companies.includes(consolidatedId)) {
  throw new InvalidCompanyListError(
    `Consolidated tenant '${consolidatedId}' cannot be listed as a source company`
  );
}
```

**Risk if unfixed:** Consolidated import would double-count all balances for the consolidated company, producing GL amounts exactly double what they should be. Would have been undetected until trial balance comparison with the consolidated subsidiaries.

---

### G-02: Finance Charge Calculation Engine (OPEN)

**COBOL logic (crfinchg.cbl):**
```cobol
COMPUTE FINCHG-CALC-AMOUNT ROUNDED = FINCHG-RATE * AGED-BALANCE / 12
IF TDE-BAL-CUR  > 0 MOVE TDE-BAL-CUR  TO AGED-BALANCE
  IF TDE-BAL-OVR30 > 0 MOVE TDE-BAL-OVR30 TO AGED-BALANCE
IF TDE-BAL-OVR60 > 0 MOVE TDE-BAL-OVR60 TO AGED-BALANCE
  IF TDE-BAL-OVR90 > 0 MOVE TDE-BAL-OVR90 TO AGED-BALANCE
```

The program applies the finance charge rate to each aging bucket independently, generates a DETAIL-MF entry for each bucket, and posts a combined journal entry.

**Missing in TypeScript:** No `FinanceChargeCalculationJob` or `FinanceChargeService` exists.

**User decision (Option A, confirmed):** DMS (dealer management system) supplies pre-calculated finance charges. The TS system only needs to receive and post them, not calculate from scratch. **The GL posting path is already built** via `gl-service.approveJournalEntry()`. What's missing is the periodic scheduled job that queries aged schedule balances and generates the finance charge detail records before posting.

**Fix scope:** `apar-service` (accounts payable/receivable service) — add a `FinanceChargeJob` that:
1. Reads all type-3 (finance charge eligible) schedule detail aging buckets
2. Applies `rate × aged_balance / 12` per bucket
3. Creates `ScheduleDetail` records for each aging bucket's charge
4. Creates a `JournalEntry` with the total finance charge amount
5. Sends to `gl-service.approveJournalEntry()`

---

### G-03: Schedule Detail Admin Edit (OPEN)

**COBOL logic (depatchn.cbl):** Interactive WRITE/REWRITE/DELETE on DETAIL-MF with these validations:
1. Source code must exist in SOURCE-FILE before write
2. GL account must be in the schedule's configured GL list (SD-GLNO1–5)
3. Reference number required for type-5 (apply-to) entries
4. Date validation (month 1–12, day 1–31)
5. Schedule master locked during edit (LOCK)
6. GL-by-ID resolution if tenant uses long GL accounts

**Fix scope:** `amacc/services/schedule-service/src/application/schedule-service.ts` — verify or add:
- Validation rule 2 (GL in schedule list) in `createDetail()` and `updateDetail()`
- Validation rule 3 (refno for type-5) in the same methods
- Admin endpoint `PATCH /api/v1/schedules/:id/detail/:lineId` for individual record edits

---

### G-04 + G-05: GL Opening Balance Reset (OPEN — combine with G-06)

**COBOL logic (glzero.cbl / glzerosch.cbl):** Iterate all GL-MF records, execute:
```cobol
MOVE ZEROS TO GL-OPEN-BAL, GL-OPEN-CNT  ← glzero
MOVE ZEROS TO GL-OPEN-BAL, GL-OPEN-CNT, GL-SCHDNO  ← glzerosch (also resets schedule assignment)
REWRITE GL-REC
```

Used for dealership ownership change (buy/sell). REMARKS: "Used to clear data for buy/sell new owner."

**Fix scope:** `amacc/services/gl-service/src/application/gl-service.ts` — add admin-only method:
```typescript
async resetForOwnershipChange(tenantId: TenantId, initiatedBy: string): Promise<void> {
  await this.prisma.$transaction(async (tx) => {
    await tx.gLAccount.updateMany({
      where: { tenantId },
      data: { openingBalance: new Decimal(0), openingUnitCount: 0, scheduleId: null }
    });
    await tx.gLAccountPeriodBalance.deleteMany({ where: { tenantId } });
    await tx.auditLog.create({ data: { event: 'OWNERSHIP_CHANGE_RESET', tenantId, initiatedBy } });
  }, { isolationLevel: 'Serializable' });
}
```

---

### G-06: Journal Period Balance Reset (OPEN — merged into G-04 fix)

**COBOL logic (jrnzero.cbl):** Iterate all JOURNAL-MF records, execute:
```cobol
MOVE ZEROS TO JR-BALANCE, JR-COUNT
REWRITE JOURNAL-REC
```

Zeroes all period running balances. Used in conjunction with `glzero.cbl` to give a completely clean state to the new owner.

In the TypeScript system, `GLAccountPeriodBalance.deleteMany({ where: { tenantId } })` achieves the same effect (zero period balances) more cleanly than resetting to zero in-place. **This is already included in the G-04/G-05 fix above.**

---

## Summary Statistics for Batches 1–6

| Category | Count | Files |
|----------|-------|-------|
| Files audited | 127 | A through J (Batches 1–6) |
| SAFE TO SKIP | 93 | Menu/UI, init, exports, sync bridges, reports, subroutines |
| ALREADY BUILT | 20 | Core posting, consolidation, GL sync, schedule management |
| PARTIALLY COVERED | 8 | consolgl (fixed), crfinchg, depatchn, delimsch, glzero/sch, jrnzero, inquiryn |
| P0 GAPS | 0 | — |
| P1 GAPS | 6 | G-01 through G-06 (G-01 fixed) |

---

## Key Architectural Finding (Batches 1–6)

The `fixoobtran.cbl` + `fixorphan.cbl` + `dumpoobtran.cbl` cluster (discovered in this batch) confirms the single most important design decision in the TypeScript system: using `$transaction({ isolationLevel: 'Serializable' })` for the three-way write (GL balance + period journal + transaction history). These three COBOL repair programs were the operational overhead for a class of errors that cannot occur in the new system. They are **already built away** by the database design.
