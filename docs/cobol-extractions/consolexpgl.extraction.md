# COBOL Extraction: consolexpgl.cbl

**Program ID**: CONSOLEXPGL  
**Size**: 780 lines  
**Purpose**: Builds merged GL, Journal, Source, consolmap, and GLbyID COBOL files for a consolidated financial statement company. Called by consolgl.cbl (Option 2).

---

## Algorithm (per source company)

For each imported company number:

### Step 1: Check for Long GL IDs
- If source company has GLbyID active (`GLOBAL-GL-BY-ID-ACTIVE`), read glbyid file to resolve ACCTID for each GL record.

### Step 2: Process Each GL Account

```
For each GL record in source company's gl file:
  1. Build consolmap key = original ACCTNO (12 chars)
  2. READ consolmap with lock
     - If NOT FOUND: assign new consolidated ACCTID
         Format: lowercase-letter(a-z) + 4-digit-counter (0001-9999)
         Sequence: a0001, a0002, ... a9999, b0001, ...
         Up to 99 original acctids from different companies stored per consolmap entry
       WRITE consolmap record
     - If FOUND: use existing CONSOL-MAP-NEW-ACCTID
  3. WRITE GL record to consolidated GL file
     - If duplicate ACCTNO: READ existing, ADD open-bal/cnt, REWRITE
```

### Step 3: Process Journal Entries

```
Start at BEG-OF-YEAR-DATE in source company's journal file.
For each journal entry:
  Translate source ACCTNO to consolidated ACCTNO via consolmap
  WRITE journal record to consolidated journal file
  - If duplicate key: READ existing, ADD balance/count, REWRITE
```

### Step 4: Process Source File

```
For each source record in source company's source file:
  WRITE to consolidated source file
  - If duplicate: skip (source records are descriptive, not additive)
```

### Step 5: Process Cost/Inventory Accounts

Same consolmap lookup/create logic for COST and INV account types (`PROCESS-COST-INV`).

---

## consolmap File

**ISAM file**, keyed by `CONSOL-MAP-ACCTNO` (12-char original account name).

Record structure:
```
CONSOL-MAP-ACCTNO      PIC X(12)   -- original account name (key)
CONSOL-MAP-NEW-ACCTID  PIC X(5)    -- assigned consolidated ID (e.g., "a0001")
CONSOL-MAP-ORIG-IDS    OCCURS 99   -- original acctids from each source company
  CONSOL-MAP-ORIG-ACCTID  PIC X(5)
```

ID assignment counter: increments per new unique account encountered. Survives across multiple company imports (persisted in consolmap file).

---

## GLbyID Rebuild

After all companies merged:
1. Wipe GLbyID file (OPEN OUTPUT)
2. For each consolmap entry: WRITE glbyid record mapping ACCTNO ↔ ACCTID

---

## DB Rebuild Trigger

After COBOL file merge complete:
```
POST http://localhost:8080/accounting/api/{consolidatedCompanyNo}/acct/consolidated/rebuild
```
Called via Java OfficeMate invoker. Rebuilds Postgres `gl`, `journal`, `mfg_gl` tables from the newly merged COBOL files.

---

## TypeScript Equivalents

This entire program becomes the internal implementation of:
```
POST /api/v1/groups/:groupId/consolidated-gl/import
```

**No separate COBOL files needed.** All data is already in Postgres per-tenant. The merge becomes:

```sql
-- For each source tenantId:
INSERT INTO consolidated_gl_accounts (tenantId, accountCode, ...)
SELECT :consolidatedTenantId, accountCode, SUM(openBalance), SUM(count)
FROM gl_accounts
WHERE tenantId = :sourceTenantId
GROUP BY accountCode
ON CONFLICT (tenantId, accountCode) DO UPDATE
  SET openBalance = consolidated_gl_accounts.openBalance + EXCLUDED.openBalance
```

### consolmap equivalent
`ConsolidationMapping` table:
```
consolidatedTenantId  String
originalAccountCode   String  (from source tenant)
sourceTenantId        String
consolidatedAccountId String  (assigned: "a0001" etc.)
PRIMARY KEY (consolidatedTenantId, originalAccountCode, sourceTenantId)
```

### ID Assignment (TypeScript)
```typescript
function nextConsolidatedId(lastId: string): string {
  const letter = lastId[0];
  const num = parseInt(lastId.slice(1));
  if (num < 9999) return letter + String(num + 1).padStart(4, '0');
  return String.fromCharCode(letter.charCodeAt(0) + 1) + '0001';
}
```

---

## ELIMINATED Logic

- `consolmap` ISAM file → `ConsolidationMapping` Postgres table
- `GLbyID` rebuild → redundant (Postgres JOIN between mapping and gl_accounts)
- `BEG-OF-YEAR-DATE` scan → Prisma `WHERE journalDate >= beginOfYear`
- 99-original-acctid limit → no limit in Postgres (unlimited rows per mapping key)
- Java OfficeMate `consolidated/rebuild` call → eliminated (Postgres already current)
