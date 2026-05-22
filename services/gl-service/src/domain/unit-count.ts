/**
 * @module unit-count
 * @cobol-origin tranpost.cbl DB-ENTRY and CR-ENTRY paragraphs
 * @trace-cobol
 *   COBOL only counts when TR-ADDUNITS = "Y" AND GL-ADDUNITS = "Y" (trackUnits flag)
 *   DB-ENTRY (debit):
 *     S/L: COMPUTE HI-COUNT = TR-COUN * -1
 *     E/A: COMPUTE HI-COUNT = TR-COUN
 *     C/M default: IF TR-REV-ADJ = "R" COMPUTE HI-COUNT = TR-COUN * -1 ELSE TR-COUN
 *   CR-ENTRY (credit):
 *     S/L: COMPUTE HI-COUNT = TR-COUN
 *     E/A: COMPUTE HI-COUNT = TR-COUN * -1
 *     C/M default: IF TR-REV-ADJ = "R" COMPUTE HI-COUNT = TR-COUN * -1 ELSE TR-COUN
 *
 * Truth table (absolute count = 1 per unit; sign encodes direction):
 *   DR REVENUE/LIABILITY      → -1  (sale credit = +1, return debit = -1)
 *   DR EXPENSE/ASSET          → +1
 *   DR COST_OF_SALES/MISC, " "→ +1
 *   DR COST_OF_SALES/MISC, "R"→ -1
 *   CR REVENUE/LIABILITY      → +1
 *   CR EXPENSE/ASSET          → -1
 *   CR COST_OF_SALES/MISC, " "→ +1
 *   CR COST_OF_SALES/MISC, "R"→ -1
 *   amount = 0                → 0   (no units on zero-amount lines)
 */

/**
 * Compute signed unit count for a ledger line.
 *
 * @param netAmount   Positive = debit, negative = credit, zero = no count
 * @param accountType GL account type (REVENUE, LIABILITY, EXPENSE, ASSET, COST_OF_SALES, MISC, …)
 * @param revAdjFlag  Reversal/adjustment indicator: 'R' = reversal, 'A' = adjustment, ' ' = normal
 * @param trackUnits  Whether this GL account tracks unit counts (GL-ADDUNITS = "Y")
 * @returns Signed unit count contribution for this line: -1, 0, or +1
 */
export function computeUnitCount(
  netAmount: number,
  accountType: string,
  revAdjFlag: string,
  trackUnits: boolean,
): number {
  if (!trackUnits || netAmount === 0) return 0;
  const isDebit = netAmount > 0;
  switch (accountType) {
    case 'REVENUE':       // S in COBOL
    case 'LIABILITY':     // L in COBOL
      return isDebit ? -1 : 1;
    case 'EXPENSE':       // E in COBOL
    case 'ASSET':         // A in COBOL
      return isDebit ? 1 : -1;
    case 'COST_OF_SALES': // C in COBOL
    default:              // M (MISC) and unknowns — COBOL treats same as C
      // Note: for C/M, the sign does NOT depend on debit/credit direction.
      // It depends ONLY on the reversal flag. This is intentional per COBOL spec:
      // cost-of-sales and misc accounts track absolute unit flow, reversals subtract.
      return revAdjFlag === 'R' ? -1 : 1;
  }
}
