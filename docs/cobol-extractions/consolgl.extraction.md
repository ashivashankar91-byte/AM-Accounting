# COBOL Extraction: consolgl.cbl

**Program ID**: CONSOLGL  
**Size**: 1570 lines  
**Purpose**: Consolidated G/L Sub-menu (Program 36 on accounting main menu). Menu controller for building a consolidated financial statement from multiple company numbers.

---

## Overview

Reads `/acct/prog/consolgl.opts2` to find which company numbers are part of this dealership group's consolidation. If multiple groups exist, shows a `guimenupop` selection popup.

Two active options (as of AMPS 3.6.52+, SDE/UI mode with consolg2/consoli2 screens):

---

## Option 1: Clear Consolidated GL

Clears the consolidated company's data:
1. Open all GL COBOL files with OUTPUT (truncate): `GL-MF`, `JOURNAL-MF`, `SOURCE-FILE`
2. Close them (now empty)
3. Run `psql DELETE` statements on Postgres tables: `journal`, `gl`, `mfg_gl`, `yearbal` — for the consolidated company number

**Effect**: Wipes consolidated company's data for a fresh re-import.

---

## Option 2: Import GL (Merge)

1. User enters 2–40 source company numbers
2. Validates each company: must have a readable GL file and journal file
3. User enters `WS-LSTCLOS-DATE` (last closed date for the consolidated FS)
4. Validates and locks last-closed-date in distributed sysinfo DB
5. Writes last-closed-date to `acct-system-file`
6. Syncs last-closed-date to DB via Java OfficeMate call
7. Calls `consolexpgl` (shell: `runcobol85 ../../acct/prog/consolexpgl`) with company list
8. After `consolexpgl` completes, triggers Java OfficeMate syncs:
   - `GLReverseSync` for consolidated company
   - `JournalSync` for consolidated company
   - `mfg_gl` rebuild via `runStatement.sh`
9. Runs validation: `java com.automate.acct.Validate -b ##` (company number)

---

## Configuration

`/acct/prog/consolgl.opts2` format (line-sequential):
```
{consolidatedCompanyNo}
{groupName}
{sourceCompany1}
{sourceCompany2}
...
```

Multiple group blocks possible (one per consolidated company).

---

## Last-Closed-Date Locking

Before updating last-closed-date:
1. Calls distributed lock endpoint (prevents concurrent access)
2. Writes date to `ACSYS-LSTCLOS-DATE` in acct-system-file
3. Syncs to DB via invoker
4. Releases lock

---

## TypeScript Equivalents

```
POST /api/v1/groups/:groupId/consolidated-gl/clear
  → Clears GlAccount, JournalEntry, Source for the consolidated tenant

POST /api/v1/groups/:groupId/consolidated-gl/import
  Body: { companies: number[], lastClosedDate: string }  // "YYYYMMDD"
  → Triggers consolexpgl merge logic, syncs DB, runs validation

GET  /api/v1/groups/:groupId/consolidated-gl
  → Returns consolidated GL status: lastImported, lastClosedDate, sourceCompanies[], isValid
```

---

## ELIMINATED Logic

- `/acct/prog/consolgl.opts2` config file → `TenantGroup` table in Postgres (group-service)
- COBOL file truncation → DELETE FROM gl_accounts WHERE tenantId = consolidatedTenantId
- Shell invocations of consolexpgl → direct TypeScript function call
- Java OfficeMate syncs (GLReverseSync, JournalSync) → already in Postgres, no sync needed
- `com.automate.acct.Validate` → inline validation query
- ISAM distributed lock → Postgres advisory lock or optimistic concurrency
