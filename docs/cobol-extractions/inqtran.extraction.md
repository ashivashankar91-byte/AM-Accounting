# COBOL Extraction: inqtran.cbl

**Program ID**: INQTRAN  
**Size**: 828 lines  
**Purpose**: Transaction Inquiry popup — displays historical transaction records for a given source+refno or account, with optional date filtering.

---

## Entry Points

Called from:
- `inquiryn.cbl` (drill-down from GL or Schedule inquiry line, KEY-FROM=S or G)
- `tranpr.cbl` (print/edit, KEY-FROM=T)
- F&I module (KEY-FROM=F)
- AP module — voidck (KEY-FROM=V), apup/vchrev (KEY-FROM=P)

LINK-RECORD fields used:
- `HI-SOURCE` — 2-char journal source (e.g., "SE")
- `HI-REFNO` — up to 8-char reference number
- `FROM-DATE` / `TO-DATE` — optional date filter (YYYYMMDD)
- `KEY-FROM` — entry mode: F=F&I cracct, S=schedule inquiry, V=AP voidck, P=AP vchrev, G=GL account

---

## File Access

| File | Key Used | Purpose |
|------|----------|---------|
| `histtran` | `HI-ACCT-KEY` (primary: HI-ACCTNO) | Account-based lookup |
| `histtran` | `HI-KEY2` = `HI-SOURCE + HI-REFNO` (alternate) | Source+Refno lookup |

Primary flow: READ histtran by `HI-KEY2` (source+refno), then iterate forward while key matches.

Fallback: If no records found with exact refno, retry with "0" prepended to refno.

---

## Display Logic

- Shows transaction header: source, refno, date, account, amount (debit/credit)
- Date range filter applied when FROM-DATE/TO-DATE provided
- Journal source security: checks user permission table `WS-JRSRC-ACCESS` (bypassed for KEY-FROM=F and KEY-FROM=V)
- Voidck mode (V): writes matching records to temp ISAM file `/tmp/voidck_{loginid}_{tty}.tmp`; returns one of: `ERR1`, `WRN1`, `WRN2`, `ERR3` in `FROM-APAY-MESSAGE`

---

## TypeScript Equivalent

```
GET /api/v1/gl/history?source=XX&refno=YYYYYYYY&fromDate=YYYYMMDD&toDate=YYYYMMDD
```

Response: array of `HistoricalTransaction` objects with fields:
- `source`, `refno`, `transactionDate`, `accountNumber`, `debitAmount`, `creditAmount`, `controlNumber`, `applyNumber`, `description`

Security: check caller's journal-source permission for the requested source code.

---

## ELIMINATED Logic

- Temp ISAM file for voidck → use in-memory array return from service
- `FROM-APAY-MESSAGE` error codes → typed error response in API
- Key retry with "0" prefix → handle in query layer (try both)
