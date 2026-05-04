# COBOL Extraction: caaccteom.cbl

**Extracted:** 2025  
**Extracted By:** GitHub Copilot (Wave 2 — COPILOT.md protocol)  
**Status:** Complete

---

## 1. Source

| Field | Value |
|-------|-------|
| File | `acct/src/caaccteom.cbl` |
| PROGRAM-ID | `CAACCTEOM` |
| Purpose | Java UI bridge — EOM gatekeeper screen |
| Called By | `purge.cbl` |
| Lines | ~100 |

---

## 2. Purpose

`caaccteom.cbl` is a thin presentation bridge. It sends accounting state data to a Java Swing component (`com.automate.acct.ui.eom.AccountingEndOfMonthComp`) via the `file2nui` (file-to-new-user-interface) mechanism.

**Sends to Java:**
1. Version string ("1")
2. Company number
3. Last close date (`ACSYS-LSTCLOS-DATE`)
4. Current (proposed) close date (`CUT-DATE`)

**Receives from Java:**
1. Cancel / Process flag
2. Print flag for each of 6 report types
3. Archive flag for each of 6 report types
4. Close month Y/N flag

There is **zero business logic** in this program. It is a pure UI mediator.

---

## 3. Business Logic

None. All logic is in `purge.cbl` and the Java Swing component.

The Java component:
- Displays the EOM screen to the user (dates, options)
- Allows user to cancel or confirm
- Returns print/archive preferences for up to 6 report types

---

## 4. Decision: SKIP — Replaced by REST API

The TypeScript rewrite eliminates the COBOL/Java Swing UI entirely. The `eom-service` REST API replaces this:

- `POST /api/v1/eom/closes` — initiates an EOM close (equivalent to user clicking "Process")
- `GET /api/v1/eom/closes/:id/preview` — shows the user what will happen before confirming (improvement over COBOL)

The print/archive options were specific to the COBOL report subsystem (schedprn, fssupp). Java-based report generation is now handled by a dedicated report service. Report preferences are passed as query parameters, not returned from a UI dialog.

---

## 5. No Traceability Required

This is a UI bridge with no business logic. The business logic it gated lives in `purge.cbl` (see `purge.extraction.md`).

- `@cobol-ancestry` caaccteom.cbl / CAACCTEOM
- `@removes-need-for` caaccteom.cbl (no equivalent needed — replaced by REST API + web UI)
