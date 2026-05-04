# COBOL Extraction: tranpr.cbl

**Program ID**: TRANPR  
**Size**: 2686 lines  
**Purpose**: Edit and Print Transaction Journal (Program 2). Pre-posting review and print for unposted transaction batches. User selects a source+date batch, can print/preview/edit before posting.

---

## Entry Points & Caller Modes

KEY-FROM-PROG values (extensive — this program is widely reused):

| Code | Caller |
|------|--------|
| 1-5 | Menu options |
| 7 | From schedule EOD (SCHDEOD mode) |
| A | Auto |
| C | COS chain |
| E | Edit only |
| F | F&I |
| H | Historical |
| P | AP |
| R | Receiving |
| S | Sales |
| T | Transactions |
| V | AP voidck |
| W | Warranty |
| Y | Year-end |
| Z | Zero-out |

SCHDEOD mode: No popup errors, returns to caller on batch error.

---

## Print Codes

| Code | Meaning |
|------|---------|
| P | Print Preview (132-char) |
| E | Edit Only (screen preview) |
| D | Display on screen |
| A | Auto (called from batch processing) |

---

## Picklist

Shows all unposted batches (source + date). If a batch has STATUS = "ENTERING DATA", user is warned (superuser override allowed). Batches filtered by `ACSYS-TRAN-POSTMTH` (post-ahead month limit).

---

## Report Columns (Transaction Journal)

Header line `PR-HDR3D`:
```
REF#(12) | LN# | CONTROL#(10) | ACCT#(7) | CNT | DEBITS(13) | CREDITS(13) | APPLY#/COST(11) | CTR NAME(25)
```

Totals printed:
- GROSS PROFIT + %
- JOURNAL TOTALS (debits / credits)
- BALANCE (must be zero)
- NO. DOCUMENTS

---

## Account Summary Section

Header `PR-HDR4/5`:
```
ACCOUNT | COUNT/AMOUNT (this journal) | COUNT/AMOUNT (MTD) | ACCOUNT NAME
```

**GL table**: `OCCURS 5000 TIMES` — accumulates per-GL totals across all lines in the batch. Cross-referenced with `jrn` file for MTD figures.

**REFNO table**: `OCCURS 300 TIMES` — tracks reference numbers when balance-method = "Document". Used to validate each document balances to zero.

---

## 13th Month Integration

If `GLOBAL-13TH-IS-IN-PROGRESS`:
- Checks that the selected batch source matches `GLOBAL-13TH-MONTH-SOURCE`
- If source is reserved for year-end (`RESERVED-FOR-YEAR-END`), also allowed

---

## GL Distribution

If `GL-TYPE = "%"` (percentage-distributed GL account), calls `getgldistr` sub-program to get actual distribution accounts before accumulating totals.

---

## Validation

- Source must not be the clearing source (`CLEARING-SOURCE`)
- Batch date must not exceed post-ahead limit (`ACSYS-TRAN-POSTMTH`)
- Each document must balance (debits = credits) when `BALANCE-METHOD = "D"`
- Journal must balance overall

---

## TypeScript Equivalents

```
GET  /api/v1/gl/transaction-batches
     → List of unposted batches with source, date, status, documentCount

GET  /api/v1/gl/transaction-batches/:source/:date/journal
     → TransactionJournalLine[] with per-line detail (ref#, control#, acct#, debits, credits, applyNo)
     Query: ?format=preview|print

GET  /api/v1/gl/transaction-batches/:source/:date/summary
     → Per-GL summary with this-batch count/amount + MTD count/amount
     
GET  /api/v1/gl/transaction-batches/:source/:date/totals
     → { grossProfit, grossProfitPct, totalDebits, totalCredits, balance, documentCount }
```

---

## ELIMINATED Logic

- 5000-entry GL table accumulation → Prisma GROUP BY on `GlTransaction` where `postedDate IS NULL`
- 300-entry REFNO balance table → Prisma query: `SELECT refno, SUM(debitAmount - creditAmount) GROUP BY refno`
- ISAM file picklist scan → `SELECT DISTINCT source, date FROM GlTransaction WHERE postedAt IS NULL`
- `getgldistr` expansion → handle at posting time (already done in gl-service Wave 1)
- 132-char print formatting → handled by PDF/report generator (future)
