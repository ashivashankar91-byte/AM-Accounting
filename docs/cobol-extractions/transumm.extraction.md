# COBOL Extraction: transumm.cbl

**Program ID**: TRANSUMM  
**Size**: 815 lines  
**Purpose**: Autopost Transaction Summary Report. Prints summary of auto-posted batches (source="**"). Two modes: prior-day records (with deletion after print) or today's records (no deletion).

---

## Overview

Only processes records where `TR-SOURCE = "**"` (auto-posted flag). This program is the audit trail for automated GL postings (EOD, scheduled batch jobs).

---

## Input Data Flow

1. Scan `TRAN-FILE` for all records with `TR-SOURCE = "**"`
2. Build `TMP-TRAN-FILE` (ISAM, sorted key: `APDATE + SOURCE + GLYYMM + GLACCT`)
3. Merge tmp file with `jrn` file (for MTD figures) in `COMPARE-ACCTS` loop
4. Print report from merged data

**PR-TABLE**: Up to 500 entries loaded from tmp file before sort/merge.

---

## User Choices

| Choice | Behavior |
|--------|---------|
| 1 | Prior autopost dates (all days before today). **Deletes** those records from tran file after printing. |
| 2 | Today's autopost date only. Does **NOT** delete records. |

---

## Sort Key

```
TMP-TRAN-KEY = APDATE(YYYYMMDD) + SOURCE(2) + GLYYMM(6) + GLACCT(7)
```

Records grouped by: autopost-date → source → GL year/month → GL account.

---

## Report Layout

Per autopost-date group → per source → per GL year/month:

```
ACCOUNT(7) | COUNT/AMOUNT this register | COUNT/AMOUNT MTD | ACCOUNT NAME(30)
```

Footer per source: register totals.
Footer per page: page totals.

**Balance check**: If `JRN-BAL ≠ 0` → prints "ERRORS IN REGISTER" for that batch.

---

## Merge Logic (COMPARE-ACCTS)

```
while more tmp records:
  if tmp key < jrn key:   print tmp-only line (new GL, no MTD history)
  if tmp key = jrn key:   print combined line (this-register + MTD)
  if tmp key > jrn key:   advance jrn
```

---

## TypeScript Equivalents

```
GET /api/v1/gl/reports/autopost-summary?choice=1|2
```

Response:
```json
{
  "autopostDate": "2024-01-15",
  "groups": [{
    "source": "**",
    "glPeriod": "202401",
    "lines": [{
      "accountCode": "4001001",
      "accountName": "Sales Revenue",
      "thisRegisterCount": 5,
      "thisRegisterAmount": "12500.00",
      "mtdCount": 47,
      "mtdAmount": "89340.00"
    }],
    "registerBalance": "0.00"
  }]
}
```

Choice 1 behavior: After successful report generation, mark records as "summarized" (set `autopostSummarizedAt = now()`). Do NOT hard-delete — use soft-delete pattern.

---

## ELIMINATED Logic

- TMP-TRAN-FILE ISAM sort file → Prisma ORDER BY on GlTransaction
- Physical delete from COBOL tran file → set `autopostSummarizedAt` timestamp (soft audit trail)
- 500-entry PR-TABLE → streaming query result
- COMPARE-ACCTS merge loop → LEFT JOIN GlTransaction to JournalSummary in Prisma query
