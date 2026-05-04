# COBOL Extraction: pushunposted.cbl

**Extracted:** 2025  
**Extracted By:** GitHub Copilot (Wave 2 — COPILOT.md protocol)  
**Status:** Complete

---

## 1. Source

| Field | Value |
|-------|-------|
| File | `acct/src/pushunposted.cbl` |
| PROGRAM-ID | `PUSHUNPOSTED` |
| Purpose | Signal the FileWatcher that an unposted COBOL transaction batch should be imported into "program 37" (GL-by-ID / new long GL system) |
| Called By | `purge.cbl` (J25459 block — only when GETGLBYID is active), `clearunposted.cbl` |
| Lines | ~310 |
| Linkage | `acct/copy/pushunposted.link` — receives COMPNO, SOURCE, DATE, TRAN-FILENAME |

---

## 2. Purpose

When the "GL by ID" system (program 37 / ACC-2307) is active, unposted COBOL transactions must be imported into the new relational system before EOM blocks them. `pushunposted.cbl` accomplishes this by **creating a touch file** in a monitored directory:

```
/acct/files/{COMPNO}/unpostedsyncevents/{SOURCE}_{DATE}.txt
```

A Java FileWatcher monitors `/acct/files/{COMPNO}/unpostedsyncevents/`. When a `.txt` file appears, it reads the filename (which encodes the source and date), pulls those transactions from the COBOL TRAN-FILE, and imports them into the relational system.

---

## 3. Algorithm

```
1. Open TRAN-FILE I-O
2. Position to key (SOURCE, DATE)
3. Read forward while TR-SOURCE = SOURCE AND TR-DATE = DATE
   - Set BATCH-FOUND = TRUE
   - If TR-LAST-USER is blank: REWRITE with GLOBAL-LOGIN-ID
4. Close TRAN-FILE
5. If BATCH-FOUND:
   - VERIFY-SOURCE: if source is RESERVED-FOR-YEAR-END: error dialog + exit (do not push)
   - MK-THE-DIR: mkdir -p /acct/files/{COMPNO}/unpostedsyncevents/
   - SEND-THE-PUSH:
     - Optionally: cp tran file to debug backup (if debug touch file exists)
     - touch /acct/files/{COMPNO}/unpostedsyncevents/{SOURCE}_{DATE}.txt
6. If NOT BATCH-FOUND: log "no batch found"
```

---

## 4. Key Safety Rule: Year-End Sources Are Excluded

**ACC-4640 (12/15/2021):** Before pushing, check `RESERVED-FOR-YEAR-END` flag on the source record.  
If the source is reserved for year-end, do NOT push it to program 37 — year-end batches must be handled by the year-end close process, not by the unposted sync.

This maps to tranpost's `INV-13` (reserved journal sources) and yrend's `YE-INV-04`.

---

## 5. Decision: SKIP — Absorbed into EOM Precondition Check

The push-to-FileWatcher mechanism is a COBOL-to-Java bridge specific to the hybrid COBOL/Java runtime. The TypeScript platform does not use ISAM files or FileWatchers.

In the TypeScript platform:
- All unposted transactions are already in PostgreSQL (`journalEntry` table with `status = 'DRAFT'`)
- The EOM precondition check (`INV-EOM-03` from purge.extraction.md) queries this table directly
- There is no "import from COBOL tran file" step because there is no COBOL tran file
- The year-end source exclusion rule is handled by `INV-13` in gl-service (tranpost equivalent)

---

## 6. Traceability

- `@cobol-ancestry` pushunposted.cbl / PUSHUNPOSTED
- `@removes-need-for` pushunposted.cbl + FileWatcher mechanism (replaced by direct DB query in EOM precondition check)
- `@cobol-equivalent` `unpostedBatchCount` in `previewMonthEnd()` response
