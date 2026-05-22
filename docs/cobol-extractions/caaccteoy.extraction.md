# COBOL Extraction: caaccteoy.cbl

**Extracted:** 2025  
**Extracted By:** GitHub Copilot (Wave 2 — COPILOT.md protocol)  
**Status:** Complete

---

## 1. Source

| Field | Value |
|-------|-------|
| File | `acct/src/caaccteoy.cbl` |
| PROGRAM-ID | `CAACCTEOM` ⚠️ **DUPLICATE PROGRAM-ID — SEE SECTION 3** |
| Purpose | Java UI bridge — Year-End gatekeeper screen |
| Called By | `yrend.cbl` |
| Lines | ~150 |

---

## 2. Purpose

`caaccteoy.cbl` is a thin presentation bridge. It sends year-end state data to a Java Swing component (`com.automate.acct.ui.eoy.AccountingEndOfYearComp`) via the `file2nui` mechanism.

**Sends to Java (8 fields):**
1. Version string ("1")
2. Company number
3. Retained earnings account number (`RETAIN-ACCTNO`)
4. Year-end journal source (`KEY-SOURCE`)
5. Last close date (`ACSYS-LSTCLOS-DATE`)
6. Year-end transaction date (`ACSYS-LSTCLOS-DATE` again)
7. Reference number (built as `"EOY" + ACSYS-LSTCLOS-YEAR`)
8. Message (empty)

**Receives from Java:**
1. Cancel / Process flag
2. Print / Archive motran flag (for the EOY transaction register)

There is **zero business logic** in this program.

---

## 3. ⚠️ CRITICAL BUG: DUPLICATE PROGRAM-ID

`caaccteoy.cbl` declares:
```
PROGRAM-ID. CAACCTEOM.
```

This is the **same PROGRAM-ID** as `caaccteom.cbl`.

| File | PROGRAM-ID | Purpose |
|------|------------|---------|
| `caaccteom.cbl` | CAACCTEOM | EOM UI bridge |
| `caaccteoy.cbl` | **CAACCTEOM** | Year-End UI bridge — **WRONG, should be CAACCTEOY** |

**Impact in COBOL:**  
In practice, `caaccteom.cbl` is called by `purge.cbl` and `caaccteoy.cbl` is called by `yrend.cbl` — they are never loaded in the same runtime session. The COBOL loader resolves programs by filename, not PROGRAM-ID (in Micro Focus environments). So this has never caused a runtime failure.

**In theory:**  
If both programs were ever loaded into the same COBOL runtime memory (e.g., via multi-program call chains), `caaccteoy` would shadow `caaccteom` or vice versa, depending on load order. Any `CALL "CAACCTEOM"` would resolve to whichever was loaded first.

**Root cause:**  
Almost certainly a copy-paste error when creating `caaccteoy.cbl` from `caaccteom.cbl`. The author forgot to change the `PROGRAM-ID` from `CAACCTEOM` to `CAACCTEOY`.

**TypeScript impact:**  
None. TypeScript service methods are named `initiateEomClose()` and `initiateYearEnd()` — no naming collision is possible.

---

## 4. Decision: SKIP — Replaced by REST API

Same reasoning as `caaccteom.cbl`. The `eom-service` REST API replaces this:
- `POST /api/v1/eom/year-end` — initiates a year-end close
- The retained earnings account, YE source, and reference number are configuration data fetched from the Java API (`GET /accounting/api/{co}/acct/year_end`)

- `@cobol-ancestry` caaccteoy.cbl / CAACCTEOM (misnamed)
- `@removes-need-for` caaccteoy.cbl (replaced by REST API + web UI)
- `@cobol-failure-cases-covered` PROGRAM-ID duplicate — documented; no TypeScript equivalent vulnerability
